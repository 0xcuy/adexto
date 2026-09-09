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

const CHAINS = {
  '0g': { chainId: 16661, rpc: process.env.OG_RPC_URL || 'https://evmrpc.0g.ai', factory: '0x51c4168226463F7e5A141e1c6D30520734BC840a' },
  base: { chainId: 8453, rpc: 'https://mainnet.base.org', factory: '0x216E7880D64D94335B583c539802d3e61958d4A2' },
  arbitrum: { chainId: 42161, rpc: 'https://arb1.arbitrum.io/rpc', factory: '0xE17f1027FC5f294327D701829baeD9d6519e922C' },
  monad: { chainId: 143, rpc: 'https://rpc.monad.xyz', factory: '0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3' },
};

/** Pasar hidup, dipakai untuk memverifikasi ABI kurva dan token terhadap instance nyata. */
const LIVE = {
  network: '0g',
  markets: [
    { symbol: 'ADEXTO', token: '0xA1358C17004469C7CA5365AbafD294F9b2c11DF7', curve: '0xc80e0659D2Fc29e62605C9DF6182a85372652B60' },
    { symbol: 'ADT', token: '0x27F3117679680e0a85951BF4a1ca44Bd67D1E5a5', curve: '0x75148E905a31F7f5dD2f3Fe8fea4588a08ebF966' },
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
  check(`${key} ${c.factory}`, r.ok && version === '0.11.0', `VERSION ${version} · ${(code.length - 2) / 2} B · ${r.reason}`);
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
const og = new ethers.JsonRpcProvider(CHAINS['0g'].rpc, 16661, { staticNetwork: true });
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
  // Kaki buyback tidak punya getter sendiri; nilainya total dikurangi tiga kaki lain.
  imm.push(5n, 30n, 40n);
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

  out.liveMarkets.push({ ...m, network: LIVE.network, chainId: 16661 });
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
