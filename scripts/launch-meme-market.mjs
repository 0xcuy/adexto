/**
 * Buka satu pasar meme di Base atau Arbitrum. PERMANEN.
 *
 *   node scripts/launch-meme-market.mjs --chain base                # dry run
 *   node scripts/launch-meme-market.mjs --chain base --broadcast    # mengirim tx
 *
 * KENAPA LEWAT /api/deploy DAN BUKAN MEMANGGIL KONTRAK LANGSUNG
 *
 * Sama alasannya dengan `launch-adexto-mainnet.mjs`: memanggil `deployTrinity` langsung
 * memang membuat pasarnya ada di chain, tetapi dua bagian peluncuran tidak ikut terjadi —
 * penambatan metadata ke 0G DA (tahap prepare) dan pendaftaran di registry situs (tahap
 * confirm). Pasar yang ada di chain tapi tidak ada di registry tidak akan muncul di
 * explorer, tidak dilayani gerbang x402, dan tidak terlihat oleh alat MCP, karena
 * ketiganya membaca registry yang sama.
 *
 * BASE_URL MENUNJUK PRODUKSI, dan itu wajib. Registry adalah berkas di VPS; mendaftar ke
 * localhost akan menulis ke registry lokal yang lalu tertimpa rsync pada deploy berikutnya.
 *
 * TANPA PENGIKATAN ERC-8004, dan itu keputusan sadar. Kami memiliki agent #10251 di Monad;
 * di Base dan Arbitrum tidak ada yang sudah dimiliki, dan `deployTrinity` merevert bila
 * `ownerOf(agentId)` bukan pemanggil. Menyetel `bindAgent: true` di sini hanya akan
 * membuang gas pada transaksi yang dijamin gagal.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const BROADCAST = argv.includes("--broadcast");
const which = (flag("chain") || "").toLowerCase();

const BASE_URL = process.env.BASE_URL || "https://adexto.xyz";
const PK = process.env.PRIVATE_KEY || process.env.OG_PRIVATE_KEY;
if (!PK) throw new Error("Butuh PRIVATE_KEY / OG_PRIVATE_KEY di .env.local");

/**
 * Satu entri per pasar. `subject` HANYA untuk generator logo — ia menggambarkan wujud yang
 * digambar, sebab nama token saja bukan petunjuk visual: model tidak tahu "Wombo" itu
 * wombat.
 *
 * `persona` masuk ke prompt sistem agent pasar ini. Ditulis sebagai apa yang agent itu
 * BENAR-BENAR lakukan — menjawab pertanyaan tentang kurvanya — bukan bawaan registry
 * ("Autonomous 24/7 quant market maker and liquidity rebalancer"), yang menjanjikan
 * strategi yang tidak dieksekusi kode mana pun.
 */
const MARKETS = {
  base: {
    chainKey: "Base",
    chainId: 8453,
    rpc: "https://mainnet.base.org",
    factory: "0x216E7880D64D94335B583c539802d3e61958d4A2",
    symbol: "BLOOP",
    name: "Bloop",
    category: "meme",
    subject: "a chubby round blue blob sea creature with tiny fins",
    persona:
      "Market agent for $BLOOP on Base. Answers questions about this curve — price, depth, fee split, swap history — and says so when something cannot be read from the contract.",
  },
  arbitrum: {
    chainKey: "Arbitrum",
    chainId: 42161,
    /**
     * `arb1.arbitrum.io/rpc`, RPC yang SAMA dengan yang dipakai aplikasi
     * (`src/config/contracts.ts`). Bukan `arbitrum-one-rpc.publicnode.com`.
     *
     * Diukur dengan cara yang mahal: publicnode melayani `staticCall` dan `estimateGas`
     * dengan baik, jadi dry run lulus sepenuhnya — lalu menolak `tx.wait()` dengan
     * "Archive requests require a personal token" (HTTP 403) SESUDAH transaksinya
     * tersiar. Hasilnya keadaan paling merepotkan yang mungkin: pasar hidup di chain dan
     * tidak terdaftar di situs, dengan txHash-nya ikut hilang bersama galatnya.
     *
     * Pelajarannya bukan "publicnode buruk" — melainkan bahwa skrip yang menyiarkan
     * transaksi harus memakai endpoint yang sama dengan yang sudah dipercaya aplikasi,
     * sebab hanya endpoint itu yang jalur bacanya sudah terbukti utuh.
     */
    rpc: "https://arb1.arbitrum.io/rpc",
    factory: "0xE17f1027FC5f294327D701829baeD9d6519e922C",
    symbol: "WOMBO",
    name: "Wombo",
    category: "meme",
    subject: "a chunky round wombat with a big flat nose",
    persona:
      "Market agent for $WOMBO on Arbitrum. Answers questions about this curve — price, depth, fee split, swap history — and says so when something cannot be read from the contract.",
  },
};

const M = MARKETS[which];
if (!M) throw new Error(`--chain harus salah satu: ${Object.keys(MARKETS).join(", ")}`);

const SUPPLY = 1_000_000_000;
const SWAP_FEE = 0.3;
const CREATOR_CUT = 0.1;
const TREASURY_CUT = 0.05;

const ABI = [
  "function deployTrinity(string name, string symbol, uint256 initialSupply, address agentIdentity, uint256 virtualNative, uint256 swapFeeBps, uint256 creatorShareBps, uint256 treasuryShareBps, bytes32 metadataRoot, bool bindAgent, uint256 agentId) returns (address token, address curve)",
  "event TrinityProjectDeployed(address indexed token, address indexed curve, address indexed creator, string name, string symbol, uint256 initialSupply, uint256 curveTokens, uint256 virtualNative, uint256 depthFeeBps, uint256 creatorFeeBps, uint256 treasuryBuybackBps, bytes32 teeAttestationRoot)",
  "function VERSION() view returns (string)",
];

const provider = new ethers.JsonRpcProvider(M.rpc, M.chainId, { staticNetwork: true });
const wallet = new ethers.Wallet(PK, provider);
const factory = new ethers.Contract(M.factory, ABI, wallet);
const iface = new ethers.Interface(ABI);

const [bal, ver] = await Promise.all([provider.getBalance(wallet.address), factory.VERSION()]);
console.log(`  mode      : ${BROADCAST ? "SIARAN — PERMANEN" : "DRY RUN — tidak mengirim"}`);
console.log(`  chain     : ${M.chainKey} (${M.chainId})`);
console.log(`  factory   : ${M.factory}  VERSION=${ver}`);
console.log(`  deployer  : ${wallet.address}`);
console.log(`  saldo     : ${ethers.formatEther(bal)} ETH`);
console.log(`  ticker    : $${M.symbol} "${M.name}"  kategori=${M.category}  suplai ${SUPPLY.toLocaleString("en-US")}`);
console.log(`  agent     : bindAgent=false (tidak ada agent ERC-8004 yang kami miliki di chain ini)`);

// ── 1. logo ────────────────────────────────────────────────────────────────
// Digenerate LEBIH DULU: kalau generator gagal, lebih baik berhenti sekarang daripada
// sesudah gas terbayar dan pasarnya terdaftar dengan /logo.svg generik.
console.log(`\n  1) membuat logo…`);
const logoRes = await fetch(`${BASE_URL}/api/generate-logo`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tokenName: M.name, tokenSymbol: M.symbol, subject: M.subject }),
  signal: AbortSignal.timeout(120000),
});
const logo = await logoRes.json();
if (!logo.generated || !String(logo.imageUrl || "").startsWith("data:image/png")) {
  console.error(`     GAGAL: generated=${logo.generated} source=${logo.source} note=${logo.note ?? "-"}`);
  console.error(`     Berhenti. Pasar tidak boleh terdaftar dengan logo cadangan berisi huruf.`);
  process.exit(1);
}
console.log(`     ${logo.model} ${logo.size}, ${(logo.imageUrl.length / 1024).toFixed(0)} KB`);

// ── 2. attestation ─────────────────────────────────────────────────────────
const message =
  `ADEXTO launch attestation\n` +
  `Deployer: ${wallet.address}\n` +
  `Ticker: ${M.symbol}\n` +
  `Timestamp: ${Date.now()}`;
const signature = await wallet.signMessage(message);
console.log(`  2) attestation ditandatangani (${signature.slice(0, 14)}…)`);

// ── 3. prepare ─────────────────────────────────────────────────────────────
const prepRes = await fetch(`${BASE_URL}/api/deploy`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    stage: "prepare",
    symbol: M.symbol,
    name: M.name,
    supply: String(SUPPLY),
    targetChains: [M.chainKey],
    deployer: wallet.address,
    swapFee: SWAP_FEE,
    creatorCut: CREATOR_CUT,
    treasuryBuybackBps: Math.round(TREASURY_CUT * 100),
    persona: M.persona,
    category: M.category,
    attestationSignature: signature,
    attestationMessage: message,
  }),
  signal: AbortSignal.timeout(120000),
});
const prep = await prepRes.json();
if (!prepRes.ok) {
  console.error(`\n  PREPARE GAGAL ${prepRes.status}: ${prep.error} ${prep.code ?? ""}`);
  process.exit(1);
}
const target = (prep.deployTargets ?? []).find((t) => t.chainId === M.chainId);
if (!target) {
  console.error(`\n  PREPARE tidak mengembalikan target ${M.chainKey}. unavailable=${JSON.stringify(prep.unavailableChains)}`);
  process.exit(1);
}
console.log(`  3) prepare OK`);
console.log(`     attestationRoot : ${prep.attestationRoot}`);
console.log(`     0G DA tx        : ${prep.daStorageTx ?? "(tidak ada)"}  ok=${prep.daStorageOk}`);
console.log(`     virtualNative   : ${target.virtualNative} ETH`);
console.log(`     harga buka      : ${target.openingPriceNative} ETH/token  (cap $${prep.openingMarketCapUsd})`);

// ── 4. simulasi ────────────────────────────────────────────────────────────
// `initialSupply` dalam TOKEN UTUH, bukan wei. Mengirim wei membuat factory merevert
// dengan "Factory: bad supply" — kesalahan yang sudah pernah terjadi.
const args = [
  M.name,
  M.symbol,
  BigInt(SUPPLY),
  wallet.address,
  ethers.parseEther(String(target.virtualNative)),
  BigInt(Math.round(SWAP_FEE * 100)),
  BigInt(Math.round(CREATOR_CUT * 100)),
  BigInt(prep.treasuryBuybackBps),
  prep.attestationRoot,
  false,
  0n,
];
const sim = await factory.deployTrinity.staticCall(...args);
const gas = await factory.deployTrinity.estimateGas(...args);
const fee = await provider.getFeeData();
const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
const cost = gas * gasPrice;
console.log(`  4) staticCall OK — token ${sim[0]}  curve ${sim[1]}`);
console.log(`     gas ${gas} @ ${Number(ethers.formatUnits(gasPrice, "gwei")).toFixed(4)} gwei = ${ethers.formatEther(cost)} ETH`);
if (bal < cost * 2n) {
  console.error(`     SALDO TIPIS: ${ethers.formatEther(bal)} ETH vs biaya ${ethers.formatEther(cost)} ETH`);
  process.exit(1);
}

if (!BROADCAST) {
  console.log(`\n  DRY RUN berhenti di sini. Tambahkan --broadcast untuk mengirim.`);
  process.exit(0);
}

// ── 5. kirim ───────────────────────────────────────────────────────────────
console.log(`\n  5) mengirim deployTrinity…`);
const tx = await factory.deployTrinity(...args);
console.log(`     txHash: ${tx.hash}`);
const receipt = await tx.wait();
if (!receipt || receipt.status !== 1) {
  console.error(`     REVERT. status=${receipt?.status}`);
  process.exit(1);
}
let token = null;
let curve = null;
for (const log of receipt.logs) {
  try {
    const p = iface.parseLog({ topics: [...log.topics], data: log.data });
    if (p?.name === "TrinityProjectDeployed") {
      token = p.args.token;
      curve = p.args.curve;
    }
  } catch {}
}
console.log(`     blok ${receipt.blockNumber}, gas terpakai ${receipt.gasUsed}`);
console.log(`     token : ${token}`);
console.log(`     curve : ${curve}`);

// ── 6. confirm ─────────────────────────────────────────────────────────────
const confRes = await fetch(`${BASE_URL}/api/deploy`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    stage: "confirm",
    txHash: tx.hash,
    chainId: M.chainId,
    symbol: M.symbol,
    name: M.name,
    creator: wallet.address,
    supply: String(SUPPLY),
    lpFeeBps: prep.lpFeeBps,
    treasuryBuybackBps: prep.treasuryBuybackBps,
    targetChainIds: [M.chainId],
    attestationRoot: prep.attestationRoot,
    daStorageTx: prep.daStorageTx,
    persona: M.persona,
    category: M.category,
    image: logo.imageUrl,
  }),
  signal: AbortSignal.timeout(120000),
});
const conf = await confRes.json();
if (!confRes.ok) {
  console.error(`\n  CONFIRM GAGAL ${confRes.status}: ${conf.error} ${conf.code ?? ""}`);
  console.error(`  Token SUDAH ada di chain pada ${token} — hanya pendaftarannya yang gagal.`);
  process.exit(1);
}
console.log(`\n  6) confirm OK — terdaftar`);
console.log(`     slug     : ${conf.project?.slug}`);
console.log(`     poolLive : ${conf.project?.poolLive}`);
console.log(`     kategori : ${conf.project?.category}`);
console.log(`\n  SELESAI. ${BASE_URL}/token/${conf.project?.slug ?? M.symbol.toLowerCase()}?chain=${M.chainId}`);
