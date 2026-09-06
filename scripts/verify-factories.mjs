// Verifikasi keempat factory yang sedang dipakai, terhadap chain.
//
//   node scripts/verify-factories.mjs
//
// Dijalankan sesudah setiap broadcast, dan berguna kapan pun sesudahnya: semua yang
// diperiksa di sini immutable, jadi jawaban yang berubah berarti env-nya menunjuk
// kontrak lain — bukan kontraknya yang berubah.
//
// Yang diperiksa, dan kenapa masing-masing penting:
//   - VERSION, protocolTreasury, PROTOCOL_FEE_BPS  -> immutable, tidak bisa dikoreksi
//   - hash runtime bytecode  -> /security menyatakan "byte-identical di keempat
//     chain". Immutable TERSIMPAN DI DALAM runtime bytecode, jadi klaim itu hanya
//     benar kalau treasury-nya sama di keempat chain. Ini yang membuktikannya.
//   - totalProjectsCount  -> harus 0, factory-nya memang baru
//   - isSymbolAvailable  -> registry symbol-nya kosong, jadi ADEXTO/ADT bisa dipakai
import fs from 'node:fs';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

const CHAINS = {
  '0g': { chainId: 16661, rpc: process.env.OG_RPC_URL || 'https://evmrpc.0g.ai' },
  base: { chainId: 8453, rpc: 'https://mainnet.base.org' },
  arbitrum: { chainId: 42161, rpc: 'https://arb1.arbitrum.io/rpc' },
  monad: { chainId: 143, rpc: 'https://rpc.monad.xyz' },
};

const ABI = [
  'function VERSION() view returns (string)',
  'function PROTOCOL_FEE_BPS() view returns (uint256)',
  'function protocolTreasury() view returns (address)',
  'function totalProjectsCount() view returns (uint256)',
  'function isSymbolAvailable(string) view returns (bool)',
  'function AGENT_REGISTRY() view returns (address)',
];

const deployments = JSON.parse(fs.readFileSync('build/deployments.json', 'utf8'));
const artifact = JSON.parse(fs.readFileSync('build/artifacts/AdextoFactory.json', 'utf8'));

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
};

const hashes = new Map();
const EXPECTED_TREASURY = ethers.getAddress(process.env.PROTOCOL_TREASURY);

for (const [key, c] of Object.entries(CHAINS)) {
  const entry = deployments[key];
  console.log(`\n══ ${key} (${c.chainId}) ══`);
  if (!entry || entry.contract !== 'AdextoFactory') {
    check(`${key}: deployments.json mencatat AdextoFactory`, false, entry?.contract ?? 'tidak ada');
    continue;
  }
  const addr = ethers.getAddress(entry.curveFactory);
  console.log(`  address  : ${addr}`);
  console.log(`  block    : ${entry.blockNumber}  tx ${entry.txHash}`);

  const p = new ethers.JsonRpcProvider(c.rpc, c.chainId, { staticNetwork: true });
  const f = new ethers.Contract(addr, ABI, p);

  const code = await p.getCode(addr);
  const runtimeBytes = (code.length - 2) / 2;
  const hash = ethers.keccak256(code);
  console.log(`  runtime  : ${runtimeBytes} B  keccak ${hash.slice(0, 18)}…`);
  hashes.set(key, hash);

  const [version, feeBps, treasury, count, registry] = await Promise.all([
    f.VERSION(),
    f.PROTOCOL_FEE_BPS(),
    f.protocolTreasury(),
    f.totalProjectsCount(),
    f.AGENT_REGISTRY().catch(() => null),
  ]);

  check(`${key}: VERSION = 0.11.0`, version === '0.11.0', version);
  check(`${key}: PROTOCOL_FEE_BPS = 10`, feeBps === 10n, `${feeBps}`);
  check(
    `${key}: protocolTreasury = env`,
    ethers.getAddress(treasury) === EXPECTED_TREASURY,
    treasury,
  );
  check(`${key}: totalProjectsCount = 0`, count === 0n, `${count}`);
  check(`${key}: ERC-8004 registry terbaca`, Boolean(registry), registry ?? 'null');
  for (const sym of ['ADEXTO', 'ADT']) {
    check(`${key}: isSymbolAvailable("${sym}")`, (await f.isSymbolAvailable(sym)) === true);
  }

  // Factory yang digantikan harus tetap tercatat, dan harus benar-benar 0.10.0.
  const prev = (entry.supersededCurveFactories ?? []).at(-1);
  check(`${key}: factory digantikan tercatat`, Boolean(prev?.curveFactory), prev?.curveFactory ?? 'tidak ada');
  if (prev?.curveFactory) {
    const prevVersion = await new ethers.Contract(prev.curveFactory, ABI, p).VERSION().catch(() => null);
    check(`${key}: factory digantikan menjawab 0.10.0`, prevVersion === '0.10.0', String(prevVersion));
  }
}

console.log('\n══ runtime bytecode identik di keempat chain? ══');
const unique = new Set(hashes.values());
for (const [k, h] of hashes) console.log(`  ${k.padEnd(9)} ${h}`);
check(
  'keempat runtime bytecode punya hash yang SAMA',
  unique.size === 1,
  `${unique.size} hash berbeda dari ${hashes.size} chain`,
);
if (unique.size === 1) {
  console.log(
    '  -> klaim /security "byte-identical di keempat chain" masih benar, dan itu\n' +
      '     hanya mungkin karena protocolTreasury yang sama dipakai di keempatnya:\n' +
      '     nilai immutable tersimpan DI DALAM runtime bytecode.',
  );
}

// Bandingkan juga dengan artefak lokal, supaya sumber = chain.
const localRuntime = artifact.deployedBytecode ?? artifact.runtimeBytecode ?? null;
if (localRuntime) {
  console.log(
    `\n  artefak lokal deployedBytecode: ${(localRuntime.length - 2) / 2} B` +
      ` (tanpa immutable terisi, jadi TIDAK akan sama dengan chain — itu wajar)`,
  );
}

console.log(failures === 0 ? '\nSEMUA CEK LULUS' : `\n${failures} CEK GAGAL`);
process.exit(failures === 0 ? 0 : 1);
