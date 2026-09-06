/**
 * Relaunch one market on the new factory generation, as a single sequence that
 * cannot be left half done.
 *
 *   node scripts/relaunch-market.mjs --symbol ADEXTO --chain 0g            # dry run
 *   node scripts/relaunch-market.mjs --symbol ADEXTO --chain 0g --broadcast
 *
 * WHY THIS IS ONE SCRIPT AND NOT A CHECKLIST
 *
 * The relaunch is three changes to three different systems: a transaction on chain,
 * an entry in the production registry, and the factory address the site advertises.
 * Two orderings of those are quietly wrong:
 *
 *   1. `checkSymbolAvailable` refuses a ticker that already has a market on the same
 *      chain, with NO exemption for the original creator (registry.ts, the
 *      `sameChain` branch). So the old entry has to come out BEFORE the new one can
 *      be registered. Between those two moments the ticker exists nowhere, and if
 *      the run stops there the market is live on chain and invisible on the site.
 *
 *   2. `audit_consistency.mjs` reads `totalProjectsCount()` from whatever
 *      `NEXT_PUBLIC_CURVE_FACTORY_*` points at. Swapping that to the new factory
 *      before relaunching makes the site point at a factory with zero launches while
 *      its pages still say the market is live.
 *
 * So the order below is deliberate: every reversible step happens BEFORE the single
 * irreversible one, and the registry is backed up immediately before it is touched.
 *
 *   preflight (reads only, refuses early)
 *     -> back up + remove the old registry entry   <- reversible
 *     -> prepare      anchors metadata, returns the opening market cap
 *     -> simulate     deployTrinity staticCall, costs nothing
 *     -> deployTrinity on the NEW factory          <- irreversible, on chain
 *     -> confirm      registers the new market
 *     -> verify       registry, pool, and the market page all agree
 *     -> on failure   restore the backup and say exactly what state things are in
 *
 * The registry edit HAS to come first, and that was measured rather than assumed:
 * `prepare` calls `checkSymbolAvailable` for every target chain and answers 409
 * SYMBOL_UNAVAILABLE when all of them are blocked. With the old entry still present
 * there is exactly one target and it is blocked, so prepare refuses before anything
 * can be anchored. Removing the entry first means that if prepare or the simulation
 * fails, restoring the backup puts the world back exactly as it was — nothing has
 * touched a chain yet.
 *
 * WHAT THIS SCRIPT WILL NOT DO
 *
 * It refuses if anyone other than the creator holds the old token. Relaunching
 * abandons the old market: it stays tradable forever because nothing can be
 * withdrawn from a curve, but it disappears from the site. That is harmless when the
 * creator is the only holder and dishonest when it is not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

const args = process.argv.slice(2);
const flag = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const SYMBOL = flag('symbol').trim().toUpperCase();
const CHAIN_KEY = flag('chain').trim().toLowerCase();
const BROADCAST = args.includes('--broadcast');
const ALLOW_EXTERNAL = args.includes('--allow-external-holders');
const BASE = process.env.RELAUNCH_BASE_URL || 'https://adexto.xyz';

const NETWORKS = {
  '0g': { chainId: 16661, rpc: process.env.OG_RPC_URL || 'https://evmrpc.0g.ai', native: '0G' },
  base: { chainId: 8453, rpc: 'https://mainnet.base.org', native: 'ETH' },
  arbitrum: { chainId: 42161, rpc: 'https://arb1.arbitrum.io/rpc', native: 'ETH' },
  monad: { chainId: 143, rpc: 'https://rpc.monad.xyz', native: 'MON' },
};

if (!SYMBOL || !NETWORKS[CHAIN_KEY]) {
  console.error(
    `Usage: node scripts/relaunch-market.mjs --symbol <TICKER> --chain <${Object.keys(NETWORKS).join('|')}> [--broadcast]`,
  );
  process.exit(1);
}
const net = NETWORKS[CHAIN_KEY];

const PK = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK) {
  console.error('Missing OG_PRIVATE_KEY / PRIVATE_KEY in .env.local');
  process.exit(1);
}

// ── SSH ke registry produksi ────────────────────────────────────────────────
//
// Registry itu berkas runtime di volume Docker, bukan bagian dari repo, jadi tidak
// ada cara membacanya selain dari mesin yang menjalankannya. Jalurnya tetap dan tidak
// menerima masukan pengguna, jadi tidak ada celah injeksi lewat --symbol.
const SSH_KEY = process.env.RELAUNCH_SSH_KEY || '/home/cucu/.ssh/id_ed25519';
const SSH_HOST = process.env.RELAUNCH_SSH_HOST || 'root@168.144.249.185';
const REGISTRY_PATH = '/var/lib/docker/volumes/adexto_adexto-data/_data/projects.json';

const ssh = (remoteCommand) =>
  execFileSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-i', SSH_KEY, SSH_HOST, remoteCommand],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
};
const step = (s) => console.log(`\n${s}`);
const die = (message) => {
  console.error(`\nBERHENTI: ${message}`);
  process.exit(1);
};

const fmt = (v, d = 18) => Number(ethers.formatUnits(v, d)).toLocaleString('en-US', { maximumFractionDigits: 6 });

const FACTORY_ABI = [
  'function VERSION() view returns (string)',
  'function PROTOCOL_FEE_BPS() view returns (uint256)',
  'function protocolTreasury() view returns (address)',
  'function isSymbolAvailable(string) view returns (bool)',
  'function totalProjectsCount() view returns (uint256)',
  'function deployTrinity(string name, string symbol, uint256 initialSupply, address agentIdentity, uint256 virtualNative, uint256 swapFeeBps, uint256 creatorShareBps, uint256 treasuryShareBps, bytes32 metadataRoot, bool bindAgent, uint256 agentId) returns (address token, address curve)',
  'event TrinityProjectDeployed(address indexed token, address indexed curve, address indexed creator, string name, string symbol, uint256 initialSupply, uint256 curveTokens, uint256 virtualNative, uint256 depthFeeBps, uint256 creatorFeeBps, uint256 treasuryBuybackBps, bytes32 metadataRoot)',
];
const ERC20 = ['function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)'];

const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });
const wallet = new ethers.NonceManager(new ethers.Wallet(PK, provider));
const ME = new ethers.Wallet(PK).address;

console.log(`RELAUNCH ${SYMBOL} di ${CHAIN_KEY} (chainId ${net.chainId})`);
console.log(`site     : ${BASE}`);
console.log(`deployer : ${ME}`);
console.log(BROADCAST ? 'mode     : BROADCAST — transaksi nyata akan dikirim' : 'mode     : DRY RUN');

// ══ 1. PREFLIGHT ════════════════════════════════════════════════════════════
step('1) PREFLIGHT — factory baru');
const deployments = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'build', 'deployments.json'), 'utf8'));
const entry = deployments[CHAIN_KEY];
if (!entry) die(`build/deployments.json tidak punya entri untuk "${CHAIN_KEY}". Broadcast factory-nya dulu.`);
if (entry.contract !== 'AdextoFactory') {
  die(
    `build/deployments.json["${CHAIN_KEY}"].contract = "${entry.contract}", bukan "AdextoFactory".\n` +
      'Itu berarti factory 0.11.0 belum di-broadcast ke chain ini.',
  );
}
const NEW_FACTORY = ethers.getAddress(entry.curveFactory);
console.log(`  factory baru : ${NEW_FACTORY}`);

const factory = new ethers.Contract(NEW_FACTORY, FACTORY_ABI, wallet);
const code = await provider.getCode(NEW_FACTORY);
check('factory punya bytecode di chain', code !== '0x', `${(code.length - 2) / 2} B`);
const version = await factory.VERSION().catch(() => null);
check('VERSION factory = 0.11.0', version === '0.11.0', String(version));
const treasury = await factory.protocolTreasury().catch(() => null);
const expectedTreasury = process.env.PROTOCOL_TREASURY;
check(
  'protocolTreasury = PROTOCOL_TREASURY di .env.local',
  Boolean(treasury && expectedTreasury) &&
    ethers.getAddress(treasury) === ethers.getAddress(expectedTreasury),
  `chain ${treasury} vs env ${expectedTreasury}`,
);
const protocolFeeBps = await factory.PROTOCOL_FEE_BPS().catch(() => null);
check('PROTOCOL_FEE_BPS bukan nol', protocolFeeBps !== null && protocolFeeBps > 0n, `${protocolFeeBps} bps`);
const availableOnChain = await factory.isSymbolAvailable(SYMBOL).catch(() => null);
check(
  `isSymbolAvailable("${SYMBOL}") di factory baru`,
  availableOnChain === true,
  String(availableOnChain),
);

step('2) PREFLIGHT — pasar lama');
let registry;
try {
  registry = JSON.parse(ssh(`cat ${REGISTRY_PATH}`));
} catch (e) {
  die(`registry produksi tidak bisa dibaca lewat SSH: ${e.message}`);
}
check('registry produksi terbaca', Array.isArray(registry), `${registry.length} entri`);

const old = registry.find(
  (r) => String(r.symbol).toUpperCase() === SYMBOL && Number(r.chainId) === net.chainId,
);
if (!old) {
  die(
    `Tidak ada entri ${SYMBOL} di chain ${net.chainId} pada registry produksi.\n` +
      'Ini skrip RELAUNCH; untuk peluncuran baru pakai studio.',
  );
}
console.log(`  token lama : ${old.tokenAddress}`);
console.log(`  kurva lama : ${old.poolAddress}`);
check(
  'creator pasar lama = deployer skrip ini',
  String(old.creator).toLowerCase() === ME.toLowerCase(),
  `${old.creator}`,
);

/**
 * Pemegang selain creator. Ini gerbang yang paling penting di seluruh skrip.
 *
 * Meluncurkan ulang meninggalkan pasar lama: ia tetap bisa diperdagangkan selamanya
 * karena tidak ada jalan menarik apa pun dari kurva, tetapi ia hilang dari situs.
 * Itu tidak merugikan siapa pun kalau hanya creator yang memegang tokennya, dan
 * menjadi tidak jujur kalau ada orang lain.
 */
const oldToken = new ethers.Contract(old.tokenAddress, ERC20, provider);
const [oldSupply, inOldCurve, inCreator] = await Promise.all([
  oldToken.totalSupply(),
  oldToken.balanceOf(old.poolAddress),
  oldToken.balanceOf(old.creator),
]);
const externallyHeld = oldSupply - inOldCurve - inCreator;
console.log(
  `  supply ${fmt(oldSupply)} = kurva ${fmt(inOldCurve)} + creator ${fmt(inCreator)} + pihak lain ${fmt(externallyHeld)}`,
);
if (externallyHeld > 0n) {
  if (!ALLOW_EXTERNAL) {
    die(
      `Ada ${fmt(externallyHeld)} ${SYMBOL} dipegang pihak selain creator.\n` +
        'Meluncurkan ulang akan menghilangkan pasar mereka dari situs sementara token mereka tetap ada.\n' +
        'Kalau itu benar-benar yang kamu mau, jalankan lagi dengan --allow-external-holders.',
    );
  }
  console.log(`  PERINGATAN: ${fmt(externallyHeld)} ${SYMBOL} di pihak lain, dilanjutkan atas permintaan flag.`);
} else {
  check('tidak ada pemegang selain creator', true, 'relaunch tidak merugikan siapa pun');
}

const balance = await provider.getBalance(ME);
console.log(`  saldo deployer: ${fmt(balance)} ${net.native}`);

if (failures > 0) die(`${failures} pemeriksaan preflight gagal. Tidak ada yang diubah.`);

// ── Fee pasar lama, dibaca sebelum apa pun disentuh ─────────────────────────
//
// Dipertahankan PERSIS, supaya satu-satunya perbedaan pada pasar baru adalah kaki
// protokol yang ditambahkan factory — bukan diam-diam juga mengubah tarif creator.
const oldDepthBps = Number(old.lpFeeBps);
const oldTreasuryBps = Number(old.treasuryBuybackBps);
const oldCurve = new ethers.Contract(
  old.poolAddress,
  ['function creatorFeeBps() view returns (uint256)'],
  provider,
);
const oldCreatorBps = Number(await oldCurve.creatorFeeBps().catch(() => 10n));
const swapFeePct = (oldDepthBps + oldCreatorBps + oldTreasuryBps) / 100;
console.log(
  `  fee dipertahankan: depth ${oldDepthBps} + creator ${oldCreatorBps} + buyback ${oldTreasuryBps} = ${
    oldDepthBps + oldCreatorBps + oldTreasuryBps
  } bps (${swapFeePct.toFixed(2)}%)`,
);
console.log(
  `  kaki protokol ditambahkan factory: +${protocolFeeBps} bps -> trader membayar ${(
    (oldDepthBps + oldCreatorBps + oldTreasuryBps + Number(protocolFeeBps)) /
    100
  ).toFixed(2)}%`,
);

const post = async (body) => {
  const res = await fetch(`${BASE}/api/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
};

if (!BROADCAST) {
  console.log(
    `\nDRY RUN — registry tidak disentuh dan tidak ada transaksi yang dikirim.\n` +
      `Semua pemeriksaan preflight lulus. Dengan --broadcast urutannya:\n` +
      `  1. backup registry produksi lalu cabut entri ${SYMBOL} chain ${net.chainId}   [bisa dibatalkan]\n` +
      `  2. prepare: anchor metadata ke 0G DA lewat ${BASE}\n` +
      `  3. simulasi deployTrinity (gratis)\n` +
      `  4. deployTrinity ${SYMBOL} di ${NEW_FACTORY}                                  [TIDAK bisa dibatalkan]\n` +
      `  5. confirm: daftarkan pasar baru\n` +
      `  6. verifikasi registry, /api/pool, dan /token/${String(old.slug || SYMBOL.toLowerCase())}\n` +
      `Kalau langkah 2 atau 3 gagal, registry dipulihkan dan tidak ada apa pun yang berubah.\n` +
      `Pasar lama ${old.tokenAddress} ditinggalkan tetapi tetap bisa diperdagangkan selamanya.`,
  );
  process.exit(0);
}

// ══ 3. REGISTRY — langkah pertama, dan bisa dibatalkan ══════════════════════
step('3) REGISTRY — backup lalu cabut entri lama');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `/root/projects.json.before-${SYMBOL.toLowerCase()}-relaunch-${stamp}`;
ssh(`cp ${REGISTRY_PATH} ${backupPath}`);
console.log(`  backup: ${backupPath}`);

const pruned = registry.filter(
  (r) => !(String(r.symbol).toUpperCase() === SYMBOL && Number(r.chainId) === net.chainId),
);
if (pruned.length !== registry.length - 1) {
  die(`penyaringan registry menghapus ${registry.length - pruned.length} entri, seharusnya tepat 1`);
}

// `cat > berkas` menimpa isinya tanpa membuat berkas baru, jadi pemilik dan mode tetap
// milik uid container (1001). Menulis dengan `scp` akan menjadikannya milik root dan
// container kehilangan izin tulis — registry lalu gagal menyimpan launch berikutnya.
const writeRegistry = (rows) =>
  execFileSync('ssh', ['-o', 'BatchMode=yes', '-i', SSH_KEY, SSH_HOST, `cat > ${REGISTRY_PATH}`], {
    input: JSON.stringify(rows, null, 2) + '\n',
  });

/**
 * Menulis berkasnya TIDAK CUKUP — cache-nya harus dibatalkan juga.
 *
 * `loadCustom()` di registry.ts menyimpan hasil bacaan di
 * `globalThis.__ADEXTO_PROJECT_CACHE__` dan mengembalikannya tanpa menyentuh disk
 * lagi. Jadi mengedit `projects.json` di volume tidak berpengaruh apa pun pada proses
 * yang sedang jalan: percobaan pertama skrip ini mencabut entrinya, lalu `prepare`
 * tetap menjawab 409 "already has a market on 0G" karena entri itu masih ada di
 * memori. Rollback-nya bekerja dan tidak ada yang rusak, tetapi kegagalannya
 * memperlihatkan bahwa langkah ini butuh dua bagian, bukan satu.
 *
 * Restart container adalah pembatalan yang paling jujur di sini: satu-satunya cara
 * lain adalah menambah endpoint yang membuang cache, yaitu menambahkan permukaan
 * tulis ke server demi keperluan operasional sesekali.
 */
const CONTAINER = process.env.RELAUNCH_CONTAINER || 'adexto-production';
const bounceServer = async () => {
  console.log(`  restart ${CONTAINER} untuk membatalkan cache registry di memori`);
  ssh(`docker restart ${CONTAINER}`);
  for (let attempt = 1; attempt <= 40; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(`${BASE}/api/deploy`, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const j = await res.json();
        console.log(`  situs hidup lagi setelah ${attempt * 3}s; terdaftar: ${JSON.stringify(j.registered)}`);
        return j;
      }
    } catch {
      // masih naik
    }
  }
  throw new Error(`${BASE} tidak kembali hidup setelah 120s`);
};

let newToken = null;
let newCurve = null;
const restore = (why, exitCode = 1) => {
  console.error(`\nMEMULIHKAN registry dari backup — ${why}`);
  try {
    ssh(`cat ${backupPath} > ${REGISTRY_PATH}`);
    // Restart-nya sama wajibnya seperti saat mencabut: tanpa itu proses yang jalan
    // tetap menyajikan daftar tanpa entri lama, jadi "dipulihkan" hanya benar di disk.
    ssh(`docker restart ${CONTAINER}`);
    console.error(`Registry dipulihkan dari ${backupPath} dan ${CONTAINER} di-restart.`);
  } catch (e) {
    console.error(
      `GAGAL memulihkan: ${e.message}\n` +
        `Pulihkan manual: cat ${backupPath} > ${REGISTRY_PATH} && docker restart ${CONTAINER}`,
    );
  }
  if (newToken) {
    console.error(
      `\nKEADAAN SEKARANG:\n` +
        `  Pasar BARU sudah ada di chain dan TIDAK terdaftar: token ${newToken}, kurva ${newCurve}\n` +
        `  Pasar LAMA kembali terdaftar seperti sebelumnya.\n` +
        `  Tidak ada dana yang hilang. Untuk melanjutkan, ulangi hanya tahap confirm.`,
    );
  } else {
    console.error(`\nKEADAAN SEKARANG: tidak ada apa pun yang berubah. Belum ada transaksi yang dikirim.`);
  }
  process.exit(exitCode);
};

writeRegistry(pruned);
console.log(`  entri ${SYMBOL} dicabut; registry sekarang ${pruned.length} entri`);
const afterBounce = await bounceServer();
if ((afterBounce.registered ?? []).map((s) => String(s).toUpperCase()).includes(SYMBOL)) {
  restore(
    `setelah restart, ${BASE} MASIH mendaftarkan ${SYMBOL} — ada sumber lain yang belum diketahui`,
  );
}

// ══ 4. PREPARE ══════════════════════════════════════════════════════════════
step('4) PREPARE — anchor metadata lewat situs produksi');
const attestationMessage =
  `ADEXTO launch attestation\n` + `Deployer: ${ME}\n` + `Ticker: ${SYMBOL}\n` + `Timestamp: ${Date.now()}`;
const attestationSignature = await new ethers.Wallet(PK).signMessage(attestationMessage);

const prepare = await post({
  stage: 'prepare',
  name: old.name,
  symbol: SYMBOL,
  supply: String(old.supply),
  swapFee: swapFeePct,
  creatorCut: oldCreatorBps / 100,
  treasuryCut: oldTreasuryBps / 100,
  model: 'glm-5.3',
  persona: old.agentPersona || 'Autonomous AI agent',
  bindAgent: false,
  agentIds: null,
  deployer: ME,
  targetChains: [net.chainId],
  attestationSignature,
  attestationMessage,
});
if (!prepare.ok) {
  restore(`prepare gagal (${prepare.status}): ${prepare.json.error ?? JSON.stringify(prepare.json)}`);
}

const attestationRoot = prepare.json.attestationRoot;
const daStorageTx = prepare.json.daStorageTx ?? null;
const target = (prepare.json.deployTargets ?? []).find((t) => Number(t.chainId) === net.chainId);
if (!target?.virtualNative) restore('prepare tidak mengembalikan virtualNative untuk chain ini');
const virtualNative = ethers.parseEther(String(target.virtualNative));
console.log(`  metadataRoot   : ${attestationRoot}`);
console.log(`  0G DA anchored : ${prepare.json.daStorageOk ? `ya (${daStorageTx})` : 'TIDAK — root = keccak metadata'}`);
console.log(`  virtualNative  : ${ethers.formatEther(virtualNative)} ${net.native}`);
console.log(`  totalPaidBps   : ${prepare.json.totalPaidBps ?? '?'} (server)`);

const launchArgs = [
  old.name,
  SYMBOL,
  BigInt(old.supply),
  ME,
  virtualNative,
  BigInt(oldDepthBps + oldCreatorBps + oldTreasuryBps),
  BigInt(oldCreatorBps),
  BigInt(oldTreasuryBps),
  attestationRoot,
  false,
  0n,
];

step('5) SIMULASI deployTrinity di factory baru');
try {
  await factory.deployTrinity.staticCall(...launchArgs);
  console.log('  PASS  simulasi lolos, transaksi tidak akan revert');
} catch (e) {
  restore(`simulasi deployTrinity revert: ${e.shortMessage || e.message}`);
}

// ══ 6. LANGKAH TAK TERBALIKKAN ══════════════════════════════════════════════
step('6) BROADCAST deployTrinity — ini langkah yang tidak bisa dibatalkan');
const tx = await factory.deployTrinity(...launchArgs);
console.log(`  tx: ${tx.hash}`);
const receipt = await tx.wait();
if (!receipt || receipt.status !== 1) restore(`transaksi revert: ${tx.hash}`);

const iface = new ethers.Interface(FACTORY_ABI);
for (const log of receipt.logs) {
  try {
    const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
    if (parsed?.name === 'TrinityProjectDeployed') {
      newToken = parsed.args.token;
      newCurve = parsed.args.curve;
      break;
    }
  } catch {
    // bukan event factory
  }
}
if (!newToken || !newCurve) restore(`receipt ${tx.hash} tidak memuat TrinityProjectDeployed`);
console.log(`  token baru : ${newToken}`);
console.log(`  kurva baru : ${newCurve}`);
console.log(`  block      : ${receipt.blockNumber}  gasUsed ${receipt.gasUsed}`);

/**
 * Catat pasar yang ditinggalkan SEBELUM registry disentuh.
 *
 * Berkas ini ikut ter-commit, jadi alamat pasar pra-rilis tidak lenyap tanpa jejak
 * begitu ia hilang dari situs. Itu satu-satunya cara pembaca nanti bisa memeriksa
 * bahwa memang pernah ada pasar bernama sama dan apa yang terjadi padanya.
 */
// `src/config/`, BUKAN `build/`. Seluruh `build/` masuk .gitignore, jadi catatan yang
// ditulis di sana tidak pernah sampai ke repo — dan satu-satunya gunanya berkas ini
// adalah menjadi jejak permanen yang bisa dibaca orang lain nanti.
const supersededPath = path.join(process.cwd(), 'src', 'config', 'superseded-markets.json');
const superseded = fs.existsSync(supersededPath)
  ? JSON.parse(fs.readFileSync(supersededPath, 'utf8'))
  : [];
superseded.push({
  symbol: SYMBOL,
  chainId: net.chainId,
  chainKey: CHAIN_KEY,
  reason: 'relaunched on AdextoFactory 0.11.0 to gain the protocol fee leg',
  supersededAt: new Date().toISOString(),
  old: {
    tokenAddress: old.tokenAddress,
    curveAddress: old.poolAddress,
    factory: process.env[`NEXT_PUBLIC_CURVE_FACTORY_${CHAIN_KEY.toUpperCase()}`] ?? null,
    curveVersion: '0.10.0',
    txHash: old.txHash ?? null,
    blockNumber: old.blockNumber ?? null,
    note: 'Still tradable directly against the curve. Nothing can be withdrawn from a curve, so its reserves stay whole; it is simply no longer listed.',
  },
  new: {
    tokenAddress: newToken,
    curveAddress: newCurve,
    factory: NEW_FACTORY,
    curveVersion: '0.11.0',
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
  },
});
fs.writeFileSync(supersededPath, JSON.stringify(superseded, null, 2) + '\n');
console.log(`  dicatat di src/config/superseded-markets.json`);

// ══ 7. CONFIRM ══════════════════════════════════════════════════════════════
step('7) CONFIRM — daftarkan pasar baru');
const confirm = await post({
  stage: 'confirm',
  chainId: net.chainId,
  txHash: tx.hash,
  name: old.name,
  symbol: SYMBOL,
  supply: String(old.supply),
  lpFeeBps: oldDepthBps,
  treasuryBuybackBps: oldTreasuryBps,
  creator: ME,
  persona: old.agentPersona,
  agentModel: old.agentModel,
  image: old.image ?? '/logo.svg',
  attestationRoot,
  daStorageTx,
  targetChainIds: [net.chainId],
});
if (!confirm.ok) restore(`confirm gagal (${confirm.status}): ${confirm.json.error ?? JSON.stringify(confirm.json)}`);
console.log(`  terdaftar: ${confirm.json.project?.tokenAddress} / ${confirm.json.project?.poolAddress}`);

// ══ 8. VERIFIKASI ═══════════════════════════════════════════════════════════
step('8) VERIFIKASI — registry, pool, halaman pasar');
failures = 0;

const after = JSON.parse(ssh(`cat ${REGISTRY_PATH}`));
const fresh = after.find((r) => String(r.symbol).toUpperCase() === SYMBOL && Number(r.chainId) === net.chainId);
check('entri registry ada', Boolean(fresh));
check(
  'entri menunjuk token BARU',
  fresh && ethers.getAddress(fresh.tokenAddress) === ethers.getAddress(newToken),
  fresh?.tokenAddress,
);
check(
  'entri menunjuk kurva BARU',
  fresh && ethers.getAddress(fresh.poolAddress) === ethers.getAddress(newCurve),
  fresh?.poolAddress,
);
check(
  'slug tidak berubah, jadi URL lama tetap hidup',
  fresh && String(fresh.slug) === String(old.slug),
  `${old.slug} -> ${fresh?.slug}`,
);
check(
  `hanya satu entri ${SYMBOL} di chain ${net.chainId}`,
  after.filter((r) => String(r.symbol).toUpperCase() === SYMBOL && Number(r.chainId) === net.chainId).length === 1,
);

const poolRes = await fetch(`${BASE}/api/pool?symbol=${SYMBOL}&chainId=${net.chainId}`, {
  signal: AbortSignal.timeout(60_000),
});
const pool = await poolRes.json().catch(() => ({}));
check('/api/pool menjawab tradable', pool.tradable === true, pool.reason ?? '');
check(
  '/api/pool melaporkan kaki protokol',
  Number(pool.protocolFeeBps) === Number(protocolFeeBps),
  `${pool.protocolFeeBps} bps`,
);
check(
  '/api/pool totalFeeBps = keempat kaki',
  Number(pool.totalFeeBps) === oldDepthBps + oldCreatorBps + oldTreasuryBps + Number(protocolFeeBps),
  `${pool.totalFeeBps} bps`,
);

const slug = String(fresh?.slug ?? SYMBOL.toLowerCase());
const pageRes = await fetch(`${BASE}/token/${slug}?chain=${net.chainId}`, {
  signal: AbortSignal.timeout(60_000),
});
check(`/token/${slug}?chain=${net.chainId} menjawab 200`, pageRes.status === 200, `HTTP ${pageRes.status}`);
const html = await pageRes.text();
check('halaman memuat alamat token BARU', html.includes(newToken.slice(2, 10)), newToken);
check('halaman TIDAK lagi memuat alamat token lama', !html.includes(old.tokenAddress.slice(2, 10)));

if (failures > 0) {
  console.error(
    `\n${failures} verifikasi gagal. Registry TIDAK dipulihkan otomatis karena pasar baru sudah terdaftar —\n` +
      `memulihkannya sekarang akan membuang pendaftaran yang berhasil. Backup tetap ada di ${backupPath}.`,
  );
  process.exit(1);
}

console.log(`\nSELESAI. ${SYMBOL} di ${CHAIN_KEY} sekarang berjalan di kurva 0.11.0.`);
console.log(`  token : ${newToken}`);
console.log(`  kurva : ${newCurve}`);
console.log(`  URL   : ${BASE}/token/${slug}?chain=${net.chainId}  (tidak berubah)`);
console.log(`  lama  : ${old.tokenAddress} — ditinggalkan, tetap bisa diperdagangkan, tercatat di src/config/superseded-markets.json`);
console.log(`  backup registry: ${backupPath}`);
