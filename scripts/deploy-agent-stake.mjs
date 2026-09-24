/**
 * Broadcast AdextoAgentStake — kontrak yang memegang stake pembuka jatah Agent Compute.
 *
 * Dry run dulu (tidak ada transaksi, tidak ada gas):
 *   node scripts/deploy-agent-stake.mjs --chain 0g
 *
 * Broadcast sungguhan (memakai gas):
 *   node scripts/deploy-agent-stake.mjs --chain 0g --broadcast
 *
 * KENAPA SKRIPNYA MENOLAK BANYAK HAL
 *
 * Dua argumen konstruktornya `immutable`: token yang di-stake dan stake minimum. Tidak ada setter,
 * tidak ada owner, tidak ada jalur upgrade — itu memang klaim halaman /agent-compute. Artinya
 * alamat token yang salah tidak bisa dikoreksi, hanya bisa ditinggalkan dengan men-deploy ulang,
 * dan siapa pun yang sudah stake ke kontrak yang salah harus menariknya sendiri.
 *
 * Jadi tokennya tidak cuma diterima, tapi DIPERIKSA ke chain: ada kodenya, `symbol()` cocok, dan
 * `decimals()` dibaca dari kontraknya alih-alih diasumsikan 18. Stake minimum dihitung dari
 * `MIN_STAKE_ADEXTO` di src/config/agent-compute.ts supaya angka di kontrak dan angka di UI tidak
 * bisa berpisah tanpa ada yang menyunting satu berkas yang sama.
 *
 * MODE GLADI: --token 0x… --allow-foreign-token
 *
 * Dipakai untuk membuktikan jalur "stake → tingkatan → kunci" tanpa membelanjakan $ADEXTO
 * sungguhan: deploy satu pasangan token-mainan + stake, stake token-mainan itu, jalankan alur
 * penuh, lalu tinggalkan. Dalam mode ini skrip TIDAK menulis build/deployments.json, karena entri
 * di sana dibaca orang lain sebagai alamat produksi.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const NETWORKS = {
  "0g": { chainId: 16661, rpc: process.env.OG_RPC_URL || "https://evmrpc.0g.ai", explorer: "https://chainscan.0g.ai", native: "0G" },
  "0g-testnet": {
    chainId: 16602,
    rpc: process.env.OG_TESTNET_RPC_URL || "https://evmrpc-testnet.0g.ai",
    explorer: "https://chainscan-newton.0g.ai",
    native: "0G",
  },
  devchain: { chainId: 31337, rpc: "http://127.0.0.1:8545", explorer: "", native: "ETH" },
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const chainKey = (flag("--chain") || "").toLowerCase();
const BROADCAST = args.includes("--broadcast");
const net = NETWORKS[chainKey];
if (!net) {
  console.error(`Usage: node scripts/deploy-agent-stake.mjs --chain <${Object.keys(NETWORKS).join("|")}> [--broadcast]`);
  process.exit(1);
}
if (process.env.DEPLOY_RPC) net.rpc = process.env.DEPLOY_RPC;

const PK =
  chainKey === "devchain"
    ? process.env.DEVCHAIN_PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    : process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK) {
  console.error("Missing OG_PRIVATE_KEY / PRIVATE_KEY in .env.local");
  process.exit(1);
}

// ─── kebijakan dibaca dari config, bukan diulang di sini ──────────────────────
const cfgSrc = fs.readFileSync(path.join(process.cwd(), "src/config/agent-compute.ts"), "utf8");
const readNum = (re, label) => {
  const m = cfgSrc.match(re);
  if (!m) {
    console.error(`Could not read ${label} from src/config/agent-compute.ts`);
    process.exit(1);
  }
  return Number(m[1].replace(/_/g, ""));
};
const MIN_STAKE_WHOLE = readNum(/MIN_STAKE_ADEXTO\s*=\s*([\d_]+)/, "MIN_STAKE_ADEXTO");
const CONFIG_TOKEN = (cfgSrc.match(/STAKE_TOKEN = \{[\s\S]*?address:\s*"(0x[a-fA-F0-9]{40})"/) || [])[1];
const CONFIG_SYMBOL = (cfgSrc.match(/STAKE_TOKEN = \{[\s\S]*?symbol:\s*"([^"]+)"/) || [])[1];
const CONFIG_CHAIN = readNum(/STAKE_TOKEN = \{[\s\S]*?chainId:\s*(\d+)/, "STAKE_TOKEN.chainId");
if (!CONFIG_TOKEN) {
  console.error("Could not read STAKE_TOKEN.address from src/config/agent-compute.ts");
  process.exit(1);
}

const tokenOverride = flag("--token");
const REHEARSAL = Boolean(tokenOverride);
if (REHEARSAL && !args.includes("--allow-foreign-token")) {
  console.error(
    `--token was passed (${tokenOverride}) but it is not ${CONFIG_TOKEN} from the config.\n` +
      "The token binding is immutable, so this is only ever right for a rehearsal deployment.\n" +
      "Re-run with --allow-foreign-token if that is what you mean. Nothing will be written to build/deployments.json."
  );
  process.exit(1);
}
let TOKEN;
try {
  TOKEN = ethers.getAddress((tokenOverride || CONFIG_TOKEN).trim());
} catch {
  console.error(`Not a valid token address: ${tokenOverride || CONFIG_TOKEN}`);
  process.exit(1);
}

const CONTRACT_NAME = "AdextoAgentStake";
const artifactPath = path.join(process.cwd(), "build", "artifacts", `${CONTRACT_NAME}.json`);
if (!fs.existsSync(artifactPath)) {
  console.error("Artifact missing. Run: node scripts/compile-contracts.mjs --via-ir");
  process.exit(1);
}
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

/**
 * Bentuk konstruktor DIBACA dari artifact, bukan diasumsikan. Kalau argumennya berubah nanti,
 * baris ini gagal keras di sini alih-alih menghasilkan deployment yang immutable-nya bukan yang
 * dimaksud siapa pun.
 */
const ctor = artifact.abi.find((f) => f.type === "constructor");
const ctorInputs = ctor?.inputs ?? [];
const shapeOk =
  ctorInputs.length === 2 && ctorInputs[0].type === "address" && ctorInputs[1].type === "uint256";
if (!shapeOk) {
  console.error(
    `Unexpected ${CONTRACT_NAME} constructor: expected (address token, uint256 minimumStake), got ` +
      `[${ctorInputs.map((i) => `${i.type} ${i.name}`).join(", ")}]. Recompile, or update this script deliberately.`
  );
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(net.rpc);
const wallet = new ethers.Wallet(PK, provider);

// Chain dipastikan dulu: setiap probe di bawah hanya bermakna kalau kita benar bicara dengan
// chain yang dimaksud.
const onChain = await provider.getNetwork();
if (Number(onChain.chainId) !== net.chainId) {
  console.error(`RPC chainId mismatch: expected ${net.chainId}, got ${onChain.chainId}`);
  process.exit(1);
}
if (!REHEARSAL && chainKey === "0g" && CONFIG_CHAIN !== net.chainId) {
  console.error(`Config binds STAKE_TOKEN to chain ${CONFIG_CHAIN}, deploying to ${net.chainId}. Refusing.`);
  process.exit(1);
}

// ─── token diperiksa ke chain ─────────────────────────────────────────────────
const code = await provider.getCode(TOKEN);
if (code === "0x") {
  console.error(`Token ${TOKEN} has no code on ${chainKey}. A stake bound to a non-contract can never be unstaked.`);
  process.exit(1);
}
const erc20 = new ethers.Contract(
  TOKEN,
  ["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"],
  provider
);
let symbol, decimals, totalSupply;
try {
  [symbol, decimals, totalSupply] = await Promise.all([erc20.symbol(), erc20.decimals(), erc20.totalSupply()]);
} catch (e) {
  console.error(`Token ${TOKEN} does not answer symbol/decimals/totalSupply: ${e.shortMessage || e.message}`);
  process.exit(1);
}
if (!REHEARSAL && symbol !== CONFIG_SYMBOL) {
  console.error(`Token symbol mismatch: chain says "${symbol}", config says "${CONFIG_SYMBOL}". Refusing.`);
  process.exit(1);
}

const MIN_STAKE = ethers.parseUnits(String(MIN_STAKE_WHOLE), Number(decimals));

const balance = await provider.getBalance(wallet.address);
const feeData = await provider.getFeeData();
const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits("1", "gwei");
const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const deployTx = await factory.getDeployTransaction(TOKEN, MIN_STAKE);
let gasEstimate;
try {
  gasEstimate = await provider.estimateGas({ from: wallet.address, data: deployTx.data });
} catch (e) {
  console.error(`estimateGas failed: ${e.shortMessage || e.message}`);
  process.exit(1);
}
const cost = gasEstimate * gasPrice;

console.log(`network      : ${chainKey} (chainId ${net.chainId})${chainKey === "0g" ? "  [MAINNET — gas nyata]" : ""}`);
console.log(`contract     : ${CONTRACT_NAME}${REHEARSAL ? "  [GLADI — token bukan dari config]" : ""}`);
console.log(`deployer     : ${wallet.address}`);
console.log(`stake token  : ${TOKEN}  ${symbol} · ${decimals} desimal · supply ${ethers.formatUnits(totalSupply, decimals)}`);
console.log(`min stake    : ${MIN_STAKE_WHOLE} ${symbol}  (${MIN_STAKE} raw)`);
console.log(`balance      : ${ethers.formatEther(balance)} ${net.native}`);
console.log(`bytecode     : ${(artifact.bytecode.length / 2 / 1024).toFixed(2)} KiB`);
console.log(`gas estimate : ${gasEstimate}`);
console.log(`gas price    : ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
console.log(`max cost     : ~${ethers.formatEther(cost)} ${net.native}`);

if (balance < cost) {
  console.error(`\nInsufficient balance: need ~${ethers.formatEther(cost)} ${net.native}`);
  process.exit(1);
}
if (!BROADCAST) {
  console.log(
    `\nDRY RUN — tidak ada yang dikirim. Jalankan ulang dengan --broadcast untuk deploy.\n` +
      `Kalau di-broadcast, ${TOKEN} menjadi token stake permanen kontrak ini dan ${MIN_STAKE_WHOLE} ${symbol} menjadi minimum permanennya.`
  );
  process.exit(0);
}

console.log("\nBroadcasting...");
const contract = await factory.deploy(TOKEN, MIN_STAKE);
const tx = contract.deploymentTransaction();
console.log(`tx: ${tx.hash}`);
await contract.waitForDeployment();
const address = await contract.getAddress();
const receipt = await provider.getTransactionReceipt(tx.hash);

console.log(`\n${CONTRACT_NAME} deployed`);
console.log(`  address : ${address}`);
console.log(`  block   : ${receipt.blockNumber}`);
console.log(`  gasUsed : ${receipt.gasUsed}`);
if (net.explorer) console.log(`  explorer: ${net.explorer}/address/${address}`);

/**
 * Immutable dibaca BALIK dari chain alih-alih mempercayai argumen yang baru kita kirim. Ini
 * kesempatan terakhir nilainya masih bisa diperiksa; sesudah ini alamatnya tidak bisa diubah, jadi
 * ketidakcocokan harus muncul sekarang, keras, sementara biayanya baru satu deployment terbuang.
 */
const deployed = new ethers.Contract(
  address,
  [
    "function stakeToken() view returns (address)",
    "function minStake() view returns (uint256)",
    "function totalStaked() view returns (uint256)",
    "function stakerCount() view returns (uint256)",
    "function stakedOf(address) view returns (uint256)",
    "function isActive(address) view returns (bool)",
    "function accounting() view returns (uint256 held, uint256 accounted, uint256 surplus)",
  ],
  provider
);
const [onToken, onMin, onTotal, onCount, onSelf, onActive, acct] = await Promise.all([
  deployed.stakeToken(),
  deployed.minStake(),
  deployed.totalStaked(),
  deployed.stakerCount(),
  deployed.stakedOf(wallet.address),
  deployed.isActive(wallet.address),
  deployed.accounting(),
]);
console.log(`  stakeToken : ${onToken}`);
console.log(`  minStake   : ${onMin} (${ethers.formatUnits(onMin, decimals)} ${symbol})`);
console.log(`  totalStaked: ${onTotal} · stakers ${onCount}`);
console.log(`  deployer   : stakedOf ${onSelf} · isActive ${onActive}`);
console.log(`  accounting : held ${acct[0]} · accounted ${acct[1]} · surplus ${acct[2]}`);

let bad = false;
if (ethers.getAddress(onToken) !== TOKEN) {
  console.error(`\nTOKEN MISMATCH. Sent ${TOKEN}, chain reports ${onToken}.`);
  bad = true;
}
if (onMin !== MIN_STAKE) {
  console.error(`\nMIN STAKE MISMATCH. Sent ${MIN_STAKE}, chain reports ${onMin}.`);
  bad = true;
}
if (onTotal !== 0n || onCount !== 0n || onSelf !== 0n || onActive !== false) {
  console.error("\nFresh deployment is not empty. Something is wrong; do not use this address.");
  bad = true;
}
if (bad) {
  console.error("Do NOT put this address into NEXT_PUBLIC_AGENT_STAKE_0G. Deploy again.");
  process.exit(1);
}

if (REHEARSAL) {
  console.log(
    `\nGLADI — build/deployments.json TIDAK disentuh, dan alamat ini tidak boleh masuk env produksi.\n` +
      `Pakai untuk menguji alur, lalu tinggalkan.`
  );
  console.log(`\n  AGENT_STAKE_REHEARSAL=${address}`);
  process.exit(0);
}

const outFile = path.join(process.cwd(), "build", "deployments.json");
const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
existing[chainKey] = {
  ...(existing[chainKey] || {}),
  agentStake: address,
  agentStakeBlock: receipt.blockNumber,
  agentStakeToken: TOKEN,
  agentStakeMin: MIN_STAKE.toString(),
};
fs.writeFileSync(outFile, JSON.stringify(existing, null, 2));
console.log(`\nWrote build/deployments.json → ${chainKey}.agentStake`);
console.log(`\nNext: set this in .env.local AND as a docker build arg (it is read by a client component):`);
console.log(`\n  NEXT_PUBLIC_AGENT_STAKE_0G=${address}`);
