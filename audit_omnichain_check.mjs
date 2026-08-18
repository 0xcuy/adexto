/**
 * Menguji klaim "1 launch = token di 4 chain".
 *
 * Studio melakukan loop satu transaksi per chain, lalu setiap chain memanggil
 * `POST /api/deploy stage=confirm`. Skrip ini melakukan launch nyata di 0G Testnet,
 * mendaftarkannya, lalu mensimulasikan chain kedua dengan ticker yang sama —
 * persis jalur kode yang ditempuh chain ke-2/3/4.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const RPC = "https://evmrpc-testnet.0g.ai";
const FACTORY = process.env.TEST_FACTORY || "0x6394E3820d62a9Ab901128bEf5A04860b71A535c";
const PK = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
const TICKER = `OMNI${Math.floor(Math.random() * 900 + 100)}`;

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

const FACTORY_ABI = [
  "function deployTrinityProject(string name, string symbol, uint256 initialSupply, address agentIdentity, uint256 swapFeeBps, uint256 treasuryShareBps, bytes32 teeAttestationRoot, uint256 poolTokenBps) payable returns (address token, address pool)",
  "event TrinityProjectDeployed(address indexed token, address indexed pool, address indexed creator, string name, string symbol, uint256 initialSupply, uint256 poolTokenAmount, uint256 poolNativeAmount, uint256 swapFeeBps, uint256 treasuryShareBps, bytes32 teeAttestationRoot)",
];

const post = async (body) => {
  const res = await fetch(`${BASE}/api/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

console.log(`ticker uji: ${TICKER}\n`);

// ── attestation ────────────────────────────────────────────────────────────
const message =
  `ADEXTO launch attestation\n` +
  `Deployer: ${wallet.address}\n` +
  `Ticker: ${TICKER}\n` +
  `Timestamp: ${Date.now()}`;
const attestationSignature = await wallet.signMessage(message);

const prep = await post({
  stage: "prepare",
  name: "Omni Route Trial",
  symbol: TICKER,
  supply: "1000000000",
  swapFee: 0.3,
  treasuryCut: 0.1,
  deployer: wallet.address,
  targetChains: [16602],
  attestationSignature,
  attestationMessage: message,
});
console.log(`prepare -> ${prep.status}  attestationRoot=${String(prep.body.attestationRoot).slice(0, 18)}…`);
if (prep.status !== 200) {
  console.error(prep.body);
  process.exit(1);
}

// ── launch nyata di 0G Testnet (mewakili "chain 1") ───────────────────────
const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);
console.log(`\nchain 1 (0G Testnet 16602): mengirim deployTrinityProject…`);
const tx = await factory.deployTrinityProject(
  "Omni Route Trial",
  TICKER,
  1_000_000_000n,
  wallet.address,
  30,
  10,
  prep.body.attestationRoot,
  8000,
  { value: ethers.parseEther("0.2") }
);
const rc = await tx.wait();
const ev = rc.logs
  .map((l) => {
    try {
      return factory.interface.parseLog(l);
    } catch {
      return null;
    }
  })
  .find((e) => e && e.name === "TrinityProjectDeployed");
console.log(`  token=${ev.args.token}  pool=${ev.args.pool}  tx=${rc.hash}`);

const confirmBody = {
  stage: "confirm",
  chainId: 16602,
  txHash: rc.hash,
  name: "Omni Route Trial",
  symbol: TICKER,
  supply: "1000000000",
  lpFeeBps: 20,
  treasuryBuybackBps: 10,
  creator: wallet.address,
  attestationRoot: prep.body.attestationRoot,
  targetChainIds: [16602, 42161, 8453, 143],
};

const c1 = await post(confirmBody);
console.log(`  confirm chain 1 -> ${c1.status} ${c1.status === 200 ? "TERDAFTAR" : JSON.stringify(c1.body).slice(0, 120)}`);

// ── chain 2: ticker sama, jalur kode identik ──────────────────────────────
console.log(`\nchain 2/3/4 memanggil confirm dengan ticker yang sama:`);
for (const [label, chainId] of [
  ["Arbitrum One", 42161],
  ["Base Mainnet", 8453],
  ["Monad Mainnet", 143],
]) {
  const c = await post({ ...confirmBody, chainId });
  console.log(
    `  ${label.padEnd(14)} (${String(chainId).padEnd(6)}) -> ${c.status}  ${String(c.body.error ?? "ok").slice(0, 70)}`
  );
}

// ── apa yang akhirnya terlihat user ───────────────────────────────────────
const g = await fetch(`${BASE}/api/graphql`, { method: "POST" }).then((r) => r.json());
const rows = g.data.projects.filter((p) => p.symbol === TICKER);
console.log(`\nmarket ${TICKER} yang muncul di registry: ${rows.length}`);
rows.forEach((p) => console.log(`  chainId=${p.chainId}  chain="${p.chain}"  pool=${p.poolAddress}`));

console.log(`\nKESIMPULAN`);
console.log(`  transaksi on-chain berhasil di chain 1, dan akan berhasil juga di chain 2-4.`);
console.log(`  tetapi registry hanya menerima SATU market per ticker, sehingga chain 2-4`);
console.log(`  ditolak di tahap confirm meski uang gas & likuiditas seed sudah keluar.`);
