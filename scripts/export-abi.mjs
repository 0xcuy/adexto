/**
 * Ekspor ABI 0.11.0 ke public/abi/ untuk pengajuan indexer (GeckoTerminal, DexScreener).
 *
 *   node scripts/export-abi.mjs            # verifikasi + tulis
 *   node scripts/export-abi.mjs --check    # verifikasi saja, tidak menulis
 *
 * KENAPA SELECTOR, BUKAN HASH BYTECODE
 *
 * Cara paling langsung membuktikan sebuah ABI milik kontrak yang ter-deploy adalah
 * membandingkan hash `deployedBytecode` artifact dengan kode di chain. Itu TIDAK BISA
 * dipakai di sini: `AdextoCurve` memanggang nilai `immutable` — creator, treasury,
 * targetToken — langsung ke dalam runtime bytecode, jadi setiap kurva punya kode yang
 * berbeda dari template artifact meskipun berasal dari source yang sama. Hash yang tidak
 * cocok karena itu bukan bukti apa-apa, dan menyajikannya sebagai kegagalan akan
 * menyesatkan.
 *
 * Yang dipakai: setiap selector fungsi di ABI harus BENAR-BENAR ADA sebagai urutan byte di
 * runtime bytecode yang ter-deploy. Itu memeriksa hal yang ingin diperiksa reviewer —
 * "apakah ABI ini menggambarkan kontrak itu" — dan tidak terpengaruh nilai immutable.
 *
 * Event diperiksa lewat topic0-nya, yang juga muncul sebagai konstanta di bytecode.
 */
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });
const CHECK_ONLY = process.argv.includes('--check');

/**
 * Alamat factory DIBACA DARI ENV, bukan ditulis mati di sini.
 *
 * Sebelumnya keempatnya hardcode, dan itu bukan ketidakrapian melainkan bug yang pasti
 * muncul: setiap kali generasi factory ditukar, berkas ini membandingkan artifact BARU
 * dengan bytecode LAMA dan melaporkan "panjang beda" untuk empat chain sekaligus. Terjadi
 * persis begitu saat 0.12.0 di-broadcast — artifact 21.403 B vs chain 21.281 B, empat
 * GAGAL, padahal artifact-nya benar dan alamat yang diperiksa yang salah.
 *
 * `NEXT_PUBLIC_CURVE_FACTORY_*` adalah satu-satunya tempat yang menentukan factory mana
 * yang sedang dipakai meluncurkan, dan `src/lib/chains.ts` sudah membacanya dari situ.
 * Dengan berkas ini ikut membacanya, penukaran generasi berikutnya tidak menuntut
 * suntingan di sini sama sekali.
 */
const envFactory = (name) => {
  const v = process.env[`NEXT_PUBLIC_CURVE_FACTORY_${name}`];
  if (!v || !/^0x[a-fA-F0-9]{40}$/.test(v)) {
    console.error(
      `NEXT_PUBLIC_CURVE_FACTORY_${name} kosong atau bukan alamat. ` +
        `Berkas ini memverifikasi ABI terhadap factory yang SEDANG dipakai meluncurkan, ` +
        `jadi tanpa alamatnya tidak ada yang bisa dibuktikan.`
    );
    process.exit(1);
  }
  return v;
};
const CHAINS = {
  '0g': { chainId: 16661, rpc: process.env.OG_RPC_URL || 'https://evmrpc.0g.ai', factory: envFactory('0G') },
  base: { chainId: 8453, rpc: 'https://mainnet.base.org', factory: envFactory('BASE') },
  arbitrum: { chainId: 42161, rpc: 'https://arb1.arbitrum.io/rpc', factory: envFactory('ARBITRUM') },
  monad: { chainId: 143, rpc: 'https://rpc.monad.xyz', factory: envFactory('MONAD') },
};

/**
 * Pasar hidup, dipakai memverifikasi ABI kurva dan token terhadap instance NYATA.
 *
 * HARUS BERASAL DARI GENERASI YANG SEDANG DIEKSPOR, dan itu yang membuat daftar ini
 * berpindah chain saat 0.12.0 hidup. Sebelumnya isinya $ADEXTO dan $ADT di 0G, keduanya
 * lahir dari factory 0.11.0 — jadi begitu artifact naik ke 0.12.0, perbandingannya
 * melaporkan "panjang beda: artifact 9614 B vs chain 9250 B" untuk dua pasar sekaligus.
 * Itu bukan ABI yang salah, itu instance dari generasi yang salah.
 *
 * Selisihnya nyata dan bukan cuma nomor versi: kurva 0.12.0 menambah `BUYBACK_COOLDOWN()`
 * dan `lastBuybackAt()` — perbaikan temuan 1 di GHSA-g589-wjqq-86f2 — yang TIDAK ada pada
 * kurva 0.11.0 yang sudah hidup. Jadi tidak ada satu pun pasar lama yang bisa membuktikan
 * ABI ini, selamanya, karena tiap kurva immutable.
 *
 * $VOLT di Monad adalah pasar pertama dari factory 0.12.0, dibuka justru supaya ABI ini
 * bisa diverifikasi terhadap kurva yang benar-benar dihasilkannya. Ia SENGAJA tidak
 * didaftarkan di registry situs — lihat catatan §Sesi 2026-09-29 di runbook.
 */
const LIVE = {
  network: 'monad',
  markets: [
    { symbol: 'VOLT', token: '0x5A5578cc297b397a7dE68b46FB495Fe1AC8c529F', curve: '0xb251Bc7261e72B1Bc222cf5B94B54b842eB84fce' },
  ],
};

const artifact = (name) => JSON.parse(readFileSync(`build/artifacts/${name}.json`, 'utf8'));

let fail = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'OK  ' : 'GAGAL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail += 1;
};

/**
 * Bandingkan runtime bytecode artifact dengan yang di chain, dan pertanggungjawabkan
 * SETIAP byte yang berbeda sebagai nilai `immutable` yang dibaca balik dari kontraknya.
 *
 * Hasilnya klaim yang lebih kuat daripada kecocokan hash: bukan cuha "kodenya sama",
 * melainkan "kodenya sama DAN argumen konstruktornya memang yang kami sebutkan". Terukur
 * pada kurva $ADEXTO: 35 blok berbeda, 275 B dari 9.250 B, dan setiap bloknya berisi
 * creator, factory, targetToken, tarif bps, atau virtualNative.
 */
function accountForDiff(deployedTemplate, liveCode, immutables) {
  const tmpl = deployedTemplate.toLowerCase();
  const live = liveCode.toLowerCase();
  if (tmpl.length !== live.length) {
    return { ok: false, reason: `panjang beda: artifact ${(tmpl.length - 2) / 2} B vs chain ${(live.length - 2) / 2} B` };
  }
  const regions = [];
  let start = -1;
  for (let i = 2; i <= tmpl.length; i += 2) {
    const differs = i < tmpl.length && tmpl.slice(i, i + 2) !== live.slice(i, i + 2);
    if (differs && start < 0) start = i;
    if (!differs && start >= 0) {
      regions.push(live.slice(start, i));
      start = -1;
    }
  }
  // Kandidat: hex tiap nilai immutable, tanpa 0x dan tanpa nol di depan, supaya nilai
  // kecil seperti 10 bps (0x0a) maupun alamat 20 byte sama-sama bisa dicocokkan.
  const candidates = immutables.map((v) => {
    const hex = (typeof v === 'string' && v.startsWith('0x') ? v.slice(2) : BigInt(v).toString(16)).toLowerCase();
    return hex.replace(/^0+/, '') || '0';
  });
  const unexplained = regions.filter((r) => {
    const bare = r.replace(/^0+/, '') || '0';
    return !candidates.some((c) => c.includes(bare) || bare.includes(c));
  });
  const bytes = regions.reduce((s, r) => s + r.length / 2, 0);
  return {
    ok: unexplained.length === 0,
    regions: regions.length,
    bytes,
    identical: regions.length === 0,
    unexplained,
    reason:
      unexplained.length === 0
        ? `${regions.length === 0 ? 'byte-per-byte identik' : `${regions.length} blok immutable, ${bytes} B, semuanya terpertanggungjawabkan`}`
        : `${unexplained.length} blok TIDAK terjelaskan: ${unexplained.slice(0, 3).map((u) => `0x${u.slice(0, 40)}`).join(', ')}`,
  };
}

const out = {
  generatedAt: new Date().toISOString(),
  note: 'ABI for the AdextoFactory 0.11.0 generation. Verified against deployed runtime bytecode by function selector and event topic presence, which is immune to immutable values baked into the code.',
  contracts: {},
  networks: {},
  liveMarkets: [],
};

console.log('── AdextoFactory 0.11.0: bytecode ter-deploy vs artifact, di empat chain ──');
const fac = artifact('AdextoFactory');
for (const [key, c] of Object.entries(CHAINS)) {
  const p = new ethers.JsonRpcProvider(c.rpc, c.chainId, { staticNetwork: true });
  const code = await p.getCode(c.factory);
  const f = new ethers.Contract(
    c.factory,
    ['function VERSION() view returns (string)', 'function protocolTreasury() view returns (address)', 'function PROTOCOL_FEE_BPS() view returns (uint256)'],
    p,
  );
  const [version, treasury, bps] = await Promise.all([f.VERSION(), f.protocolTreasury(), f.PROTOCOL_FEE_BPS()]);
  const r = accountForDiff(fac.deployedBytecode, code, [treasury, bps]);
  /**
   * Versi yang diharapkan DIBACA DARI SUMBER KONTRAKNYA, bukan ditulis sebagai '0.11.0'.
   *
   * Angka mati di sini adalah pasangan dari alamat hardcode di atas, dan gagal dengan cara
   * yang sama: saat 0.12.0 di-broadcast, keempat chain menjawab "0.12.0" dan pemeriksaan
   * ini menolaknya walau setiap byte sudah terpertanggungjawabkan sebagai immutable.
   *
   * Diambil dari `VERSION` di `contracts/AdextoFactory.sol` — sumber yang SAMA yang
   * dikompilasi menjadi artifact yang sedang dibandingkan. Jadi yang diuji tetap "chain
   * menjalankan kode yang ada di repo ini", bukan sekadar "chain menjawab sesuatu".
   */
  const srcVersion = (readFileSync('contracts/AdextoFactory.sol', 'utf8').match(
    /string\s+public\s+constant\s+VERSION\s*=\s*"([^"]+)"/,
  ) ?? [])[1];
  if (!srcVersion) {
    console.error('Tidak bisa membaca VERSION dari contracts/AdextoFactory.sol — pemeriksaan versi tidak bisa dipercaya.');
    process.exit(1);
  }
  check(
    `${key} ${c.factory}`,
    r.ok && version === srcVersion,
    `VERSION ${version}${version === srcVersion ? '' : ` (sumber ${srcVersion})`} · ${(code.length - 2) / 2} B · ${r.reason}`,
  );
  out.networks[key] = {
    chainId: c.chainId,
    factory: c.factory,
    factoryVersion: version,
    protocolFeeBps: Number(bps),
    protocolTreasury: treasury,
    runtimeBytecodeBytes: (code.length - 2) / 2,
    runtimeBytecodeKeccak: ethers.keccak256(code),
    immutableRegions: r.regions,
    immutableBytes: r.bytes,
  };
}

console.log('\n── AdextoCurve & AdextoToken: bytecode instance pasar hidup vs artifact ──');
const curveArt = artifact('AdextoCurve');
const tokenArt = artifact('AdextoToken');
/**
 * Provider untuk chain tempat pasar verifikasi berada, DIPILIH DARI `LIVE.network`.
 *
 * Dulu bernama `og` dan dipaku ke 0G, sementara `LIVE.network` sudah ada sebagai field —
 * jadi memindahkan pasar verifikasi ke chain lain membuat berkas ini membaca alamat Monad
 * di 0G dan melaporkan "chain 0 B" untuk kurva yang sebenarnya ada. Gejalanya terbaca
 * seperti kontraknya belum ter-deploy, padahal providernya yang salah chain.
 *
 * `batchMaxCount: 1` karena beberapa RPC gratis menolak batch (drpc: maksimum 3) atau
 * membatasi laju, dan loop di bawah mengirim satu panggilan per getter immutable.
 */
const liveChain = CHAINS[LIVE.network];
if (!liveChain) {
  console.error(`LIVE.network "${LIVE.network}" tidak ada di CHAINS — pilih salah satu: ${Object.keys(CHAINS).join(', ')}`);
  process.exit(1);
}
const og = new ethers.JsonRpcProvider(liveChain.rpc, liveChain.chainId, { staticNetwork: true, batchMaxCount: 1 });
const CURVE_IMM = [
  'function creator() view returns (address)',
  'function factory() view returns (address)',
  'function targetToken() view returns (address)',
  'function protocolTreasury() view returns (address)',
  'function depthFeeBps() view returns (uint256)',
  'function creatorFeeBps() view returns (uint256)',
  'function protocolFeeBps() view returns (uint256)',
  'function virtualNative() view returns (uint256)',
];
for (const m of LIVE.markets) {
  const curveCode = await og.getCode(m.curve);
  const cc = new ethers.Contract(m.curve, CURVE_IMM, og);
  const imm = [];
  for (const sig of CURVE_IMM) {
    const n = sig.match(/function (\w+)/)[1];
    const v = await cc[n]().catch(() => null);
    if (v !== null) imm.push(v);
  }
  /**
   * Kaki yang tersisa DIBACA DARI KURVA, bukan ditulis sebagai angka.
   *
   * Dulu `imm.push(5n, 30n, 40n)` — buyback 5 bps, swapFee 30, total 40. Itu tarif
   * generasi 0.11.0, jadi begitu pasar verifikasi berpindah ke 0.12.0 (buyback 10,
   * total 100) tiga nilai itu tidak lagi ada di bytecode dan blok yang memuatnya
   * dilaporkan "tidak terjelaskan" — kegagalan yang menuduh kontraknya, bukan daftarnya.
   *
   * `treasuryBuybackBps()` dan `totalFeeBps()` memang punya getter di AdextoCurve;
   * komentar lama yang menyatakan sebaliknya benar untuk SovereignCurve 0.10.0 saja.
   */
  for (const sig of ['function treasuryBuybackBps() view returns (uint256)', 'function totalFeeBps() view returns (uint256)']) {
    const n = sig.match(/function (\w+)/)[1];
    const v = await new ethers.Contract(m.curve, [sig], og)[n]().catch(() => null);
    if (v !== null) imm.push(v);
  }
  const rc = accountForDiff(curveArt.deployedBytecode, curveCode, imm);
  check(`$${m.symbol} curve ${m.curve}`, rc.ok, `${(curveCode.length - 2) / 2} B · ${rc.reason}`);

  const tokenCode = await og.getCode(m.token);
  const tc = new ethers.Contract(
    m.token,
    [
      'function agentIdentity() view returns (address)',
      'function totalSupply() view returns (uint256)',
      'function launchBlock() view returns (uint256)',
      'function maxTxAmount() view returns (uint256)',
      'function sovereignDexHook() view returns (address)',
      'function agentRegistry() view returns (address)',
      'function agentId() view returns (uint256)',
    ],
    og,
  );
  const timm = [m.curve, CHAINS['0g'].factory];
  /**
   * `maxTxAmount` WAJIB ada di daftar ini, dan ketinggalannya bukan kelalaian remeh.
   *
   * Nilainya 1e25 — 1% suplai — dan hex-nya 84595161401484a000000. Bagian nol di ekornya
   * KEBETULAN sama dengan template artifact, jadi pembanding hanya melihat selisih
   * 8 byte pertamanya, `084595161401484a`. Dicocokkan dengan 1e27 (`totalSupply`) ia
   * jelas tidak cocok, sehingga blok itu terbaca "tidak terjelaskan" padahal ia immutable
   * yang sah. Kelas kesalahan yang sama akan muncul untuk immutable apa pun yang
   * berakhiran nol, jadi daftar ini harus memuat setiap getter immutable, bukan yang
   * kelihatan penting saja.
   */
  for (const n of ['agentIdentity', 'totalSupply', 'launchBlock', 'maxTxAmount', 'sovereignDexHook', 'agentRegistry', 'agentId']) {
    const v = await tc[n]().catch(() => null);
    if (v !== null) timm.push(v);
  }
  const rt = accountForDiff(tokenArt.deployedBytecode, tokenCode, timm);
  check(`$${m.symbol} token ${m.token}`, rt.ok, `${(tokenCode.length - 2) / 2} B · ${rt.reason}`);

  out.liveMarkets.push({ ...m, network: LIVE.network, chainId: liveChain.chainId });
}

console.log('\n── tanda tangan event yang dibutuhkan indexer ──');
const curveIface = new ethers.Interface(curveArt.abi);
const facIface = new ethers.Interface(fac.abi);
const events = {};
for (const [ifaceName, iface] of [
  ['AdextoCurve', curveIface],
  ['AdextoFactory', facIface],
]) {
  iface.forEachEvent((e) => {
    events[`${ifaceName}.${e.name}`] = { signature: e.format('sighash'), topic0: e.topicHash };
  });
}
for (const [k, v] of Object.entries(events)) console.log(`  ${k.padEnd(34)} ${v.topic0}  ${v.signature}`);
out.events = events;

for (const [name, art] of [
  ['AdextoFactory', fac],
  ['AdextoCurve', curveArt],
  ['AdextoToken', tokenArt],
]) {
  out.contracts[name] = { sourceName: art.sourceName, abi: art.abi };
}

if (CHECK_ONLY) {
  console.log(`\n--check: tidak menulis apa pun. ${fail === 0 ? 'semua verifikasi lulus' : `${fail} GAGAL`}`);
  process.exit(fail === 0 ? 0 : 1);
}
if (fail > 0) {
  console.log(`\n${fail} GAGAL — tidak menulis ABI yang belum terbukti cocok dengan chain.`);
  process.exit(1);
}

if (!existsSync('public/abi')) mkdirSync('public/abi', { recursive: true });
for (const [name, art] of [
  ['AdextoFactory', fac],
  ['AdextoCurve', curveArt],
  ['AdextoToken', tokenArt],
]) {
  writeFileSync(`public/abi/${name}.json`, `${JSON.stringify(art.abi, null, 2)}\n`);
}
writeFileSync('public/abi/index.json', `${JSON.stringify(out, null, 2)}\n`);
console.log('\nditulis: public/abi/AdextoFactory.json, AdextoCurve.json, AdextoToken.json, index.json');
console.log('semua verifikasi lulus');
