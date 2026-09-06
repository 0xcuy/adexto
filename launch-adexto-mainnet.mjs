/**
 * PELUNCURAN $ADEXTO di 0G MAINNET. PERMANEN.
 *
 * Menempuh jalur yang SAMA dengan studio, lewat /api/deploy, bukan memanggil kontrak
 * langsung. Alasannya: dengan memanggil kontrak langsung, dua hal tidak ikut terlatih dan
 * tidak ikut terjadi — penambatan metadata ke 0G DA (tahap prepare) dan pendaftaran di
 * registry situs (tahap confirm). Keduanya bagian dari peluncuran, bukan hiasan.
 *
 * Urutannya:
 *   1. tandatangani attestation EIP-191 (format persis seperti studio);
 *   2. POST prepare  -> memeriksa ticker terpesan, menambatkan metadata ke 0G DA,
 *                       mengembalikan attestationRoot dan virtualNative per chain;
 *   3. staticCall    -> memastikan tidak akan revert sebelum gas terbayar;
 *   4. kirim tx      -> deployTrinity dengan bindAgent ke agent ERC-8004 3545431;
 *   5. POST confirm  -> membaca receipt on-chain, lalu mendaftarkan pasarnya.
 *
 * Butuh DRY=0 untuk benar-benar mengirim. Tanpa itu berhenti sesudah langkah 3.
 */
import { ethers } from "ethers";

const DRY = process.env.DRY !== "0";
const BASE = process.env.BASE_URL || "https://adexto.xyz";
const RPC = process.env.OG_RPC_URL || "https://evmrpc.0g.ai";
const PK = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK) throw new Error("Butuh OG_PRIVATE_KEY / PRIVATE_KEY");

const FACTORY = "0xaA85bc0cceB35B524b6BB730612540Fb88df0f8e";
const CHAIN_ID = 16661;
const CHAIN_KEY = "0G";
const SYMBOL = "ADEXTO";
const NAME = "ADEXTO";
const SUPPLY = 1_000_000_000;
const AGENT_ID = 3545431n;
const SWAP_FEE = 0.3;
const CREATOR_CUT = 0.1;
const TREASURY_CUT = 0.05;

const ABI = [
  "function deployTrinity(string name, string symbol, uint256 initialSupply, address agentIdentity, uint256 virtualNative, uint256 swapFeeBps, uint256 creatorShareBps, uint256 treasuryShareBps, bytes32 metadataRoot, bool bindAgent, uint256 agentId) returns (address token, address curve)",
  "event TrinityProjectDeployed(address indexed token, address indexed curve, address indexed creator, string name, string symbol, uint256 initialSupply, uint256 curveTokens, uint256 virtualNative, uint256 depthFeeBps, uint256 creatorFeeBps, uint256 treasuryBuybackBps, bytes32 teeAttestationRoot)",
  "event AgentBound(address indexed token, uint256 indexed agentId, address indexed agentRegistry, address owner)",
];

const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
const wallet = new ethers.Wallet(PK, provider);
const factory = new ethers.Contract(FACTORY, ABI, wallet);
const iface = new ethers.Interface(ABI);

const bal = await provider.getBalance(wallet.address);
console.log(`  mode        : ${DRY ? "DRY RUN — tidak mengirim transaksi" : "EKSEKUSI — PERMANEN"}`);
console.log(`  deployer    : ${wallet.address}`);
console.log(`  saldo       : ${ethers.formatEther(bal)} 0G`);
console.log(`  chain       : 0G Mainnet (${CHAIN_ID})`);
console.log(`  ticker      : $${SYMBOL}   suplai ${SUPPLY.toLocaleString("id-ID")}`);
console.log(`  agent       : ERC-8004 #${AGENT_ID} (bindAgent=true)`);

// ── 1. attestation ─────────────────────────────────────────────────────────
const message =
  `ADEXTO launch attestation\n` +
  `Deployer: ${wallet.address}\n` +
  `Ticker: ${SYMBOL}\n` +
  `Timestamp: ${Date.now()}`;
const signature = await wallet.signMessage(message);
console.log(`\n  1) attestation ditandatangani (${signature.slice(0, 14)}…)`);

// ── 2. prepare ─────────────────────────────────────────────────────────────
const prepRes = await fetch(`${BASE}/api/deploy`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    stage: "prepare",
    symbol: SYMBOL,
    name: NAME,
    supply: String(SUPPLY),
    targetChains: [CHAIN_KEY],
    deployer: wallet.address,
    swapFee: SWAP_FEE,
    creatorCut: CREATOR_CUT,
    treasuryBuybackBps: Math.round(TREASURY_CUT * 100),
    persona: "Autonomous 24/7 quant market maker and liquidity rebalancer.",
    category: "defi",
    attestationSignature: signature,
    attestationMessage: message,
  }),
});
const prep = await prepRes.json();
if (!prepRes.ok) {
  console.error(`\n  PREPARE GAGAL ${prepRes.status}: ${prep.error} ${prep.code ?? ""}`);
  process.exit(1);
}
const target = (prep.deployTargets ?? []).find((t) => t.chainId === CHAIN_ID);
if (!target) {
  console.error(`\n  PREPARE tidak mengembalikan target 0G. unavailable=${JSON.stringify(prep.unavailableChains)}`);
  process.exit(1);
}
console.log(`  2) prepare OK`);
console.log(`       attestationRoot : ${prep.attestationRoot}`);
console.log(`       0G DA tx        : ${prep.daStorageTx ?? "(tidak ada)"}  ok=${prep.daStorageOk}`);
console.log(`       virtualNative   : ${target.virtualNative} 0G`);
console.log(`       harga buka      : ${target.openingPriceNative} 0G/token  (cap $${prep.openingMarketCapUsd})`);
console.log(`       lpFeeBps=${prep.lpFeeBps}  treasuryBuybackBps=${prep.treasuryBuybackBps}`);

// ── 3. staticCall ──────────────────────────────────────────────────────────
const args = [
  NAME,
  SYMBOL,
  BigInt(SUPPLY),
  wallet.address,
  ethers.parseEther(String(target.virtualNative)),
  BigInt(Math.round(SWAP_FEE * 100)),
  BigInt(Math.round(CREATOR_CUT * 100)),
  BigInt(prep.treasuryBuybackBps),
  prep.attestationRoot,
  true,
  AGENT_ID,
];
const sim = await factory.deployTrinity.staticCall(...args);
console.log(`  3) staticCall OK — token ${sim[0]}  curve ${sim[1]}`);

const gas = await factory.deployTrinity.estimateGas(...args);
const fee = await provider.getFeeData();
const cost = gas * (fee.gasPrice ?? 0n);
console.log(`       gas ${gas} @ ${ethers.formatUnits(fee.gasPrice ?? 0n, "gwei")} gwei = ${ethers.formatEther(cost)} 0G`);

if (DRY) {
  console.log(`\n  DRY RUN berhenti di sini. Jalankan dengan DRY=0 untuk mengirim.`);
  process.exit(0);
}

// ── 4. kirim ───────────────────────────────────────────────────────────────
console.log(`\n  4) mengirim deployTrinity…`);
const tx = await factory.deployTrinity(...args);
console.log(`       txHash: ${tx.hash}`);
const receipt = await tx.wait();
if (!receipt || receipt.status !== 1) {
  console.error(`       REVERT. status=${receipt?.status}`);
  process.exit(1);
}
console.log(`       mined di blok ${receipt.blockNumber}, gas terpakai ${receipt.gasUsed}`);

let token = null, curve = null, bound = null;
for (const log of receipt.logs) {
  try {
    const p = iface.parseLog({ topics: [...log.topics], data: log.data });
    if (p?.name === "TrinityProjectDeployed") { token = p.args.token; curve = p.args.curve; }
    if (p?.name === "AgentBound") bound = { agentId: p.args.agentId, registry: p.args.agentRegistry };
  } catch {}
}
console.log(`       token : ${token}`);
console.log(`       curve : ${curve}`);
console.log(`       AgentBound: ${bound ? `agent #${bound.agentId} via ${bound.registry}` : "TIDAK ADA EVENT — periksa!"}`);

// ── 5. confirm ─────────────────────────────────────────────────────────────
const confRes = await fetch(`${BASE}/api/deploy`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    stage: "confirm",
    txHash: tx.hash,
    chainId: CHAIN_ID,
    symbol: SYMBOL,
    name: NAME,
    creator: wallet.address,
    supply: String(SUPPLY),
    lpFeeBps: prep.lpFeeBps,
    treasuryBuybackBps: prep.treasuryBuybackBps,
    targetChainIds: [CHAIN_ID],
    attestationRoot: prep.attestationRoot,
    daStorageTx: prep.daStorageTx,
    persona: "Autonomous 24/7 quant market maker and liquidity rebalancer.",
    category: "defi",
  }),
});
const conf = await confRes.json();
if (!confRes.ok) {
  console.error(`\n  CONFIRM GAGAL ${confRes.status}: ${conf.error} ${conf.code ?? ""}`);
  console.error(`  Token SUDAH ada on-chain di ${token} — hanya pendaftarannya yang gagal.`);
  process.exit(1);
}
console.log(`\n  5) confirm OK — terdaftar`);
console.log(`       slug        : ${conf.project?.slug}`);
console.log(`       poolLive    : ${conf.project?.poolLive}`);
console.log(`       priceNative : ${conf.project?.priceNative}`);
console.log(`\n  SELESAI. https://adexto.xyz/token/${conf.project?.slug ?? SYMBOL.toLowerCase()}?chain=${CHAIN_ID}`);
