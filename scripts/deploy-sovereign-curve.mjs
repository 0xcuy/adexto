/**
 * Broadcast AdextoFactory (VERSION 0.11.0), which deploys AdextoCurve markets.
 *
 * Dry run first (no transaction, no gas):
 *   node scripts/deploy-sovereign-curve.mjs --chain 0g
 *
 * Real broadcast (spends gas):
 *   node scripts/deploy-sovereign-curve.mjs --chain 0g --broadcast
 *
 * Supported --chain: 0g | arbitrum | base | monad | devchain
 *
 * REQUIRES A PROTOCOL TREASURY, and refuses to run without one:
 *
 *   PROTOCOL_TREASURY=0x…   in .env.local, or --treasury 0x…
 *
 * `AdextoFactory`'s constructor takes that address and stores it `immutable`; each
 * curve it deploys stores it `immutable` too. There is no setter in either
 * contract, on purpose — a setter would make them owned, which is the opposite of
 * what /security claims about them. So the address baked in here is where every
 * protocol fee from every market this factory ever creates will go, forever. A
 * typo cannot be corrected; it can only be abandoned by deploying a new factory
 * and relaunching every market on it.
 *
 * That is why the checks below are refusals rather than warnings. Previous
 * versions of this script deployed `AdextoCurveFactory` with NO constructor
 * arguments at all, so running it unchanged against the new artifact would revert
 * on `zero protocol treasury` — the good case. The bad case is passing an address
 * that is merely wrong, which succeeds silently.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const NETWORKS = {
  // Mainnets
  "0g": { chainId: 16661, rpc: process.env.OG_RPC_URL || "https://evmrpc.0g.ai", explorer: "https://chainscan.0g.ai", native: "0G" },
  arbitrum: { chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io", native: "ETH" },
  base: { chainId: 8453, rpc: "https://mainnet.base.org", explorer: "https://basescan.org", native: "ETH" },
  monad: { chainId: 143, rpc: "https://rpc.monad.xyz", explorer: "https://monadvision.com", native: "MON" },

  // Testnets — prove the flow on the real remote EVM before spending mainnet gas.
  "0g-testnet": {
    chainId: 16602,
    rpc: process.env.OG_TESTNET_RPC_URL || "https://evmrpc-testnet.0g.ai",
    explorer: "https://chainscan-newton.0g.ai",
    native: "0G",
  },
  "arbitrum-sepolia": {
    chainId: 421614,
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    native: "ETH",
  },
  "base-sepolia": { chainId: 84532, rpc: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org", native: "ETH" },
  "monad-testnet": { chainId: 10143, rpc: "https://testnet-rpc.monad.xyz", explorer: "", native: "MON" },

  devchain: { chainId: 31337, rpc: "http://127.0.0.1:8545", explorer: "", native: "ETH" },
};

const args = process.argv.slice(2);
const chainKey = (args[args.indexOf("--chain") + 1] || "").toLowerCase();
const BROADCAST = args.includes("--broadcast");
const net = NETWORKS[chainKey];
// RPC publik kadang 503 (sepolia.base.org pernah begitu berulang). Satu env
// override menghindari harus menyunting skrip demi penyedia yang sedang rewel.
if (net && process.env.DEPLOY_RPC) net.rpc = process.env.DEPLOY_RPC;

if (!net) {
  console.error(`Usage: node scripts/deploy-sovereign-curve.mjs --chain <${Object.keys(NETWORKS).join("|")}> [--broadcast]`);
  process.exit(1);
}

const IS_TESTNET = chainKey.includes("testnet") || chainKey.includes("sepolia");
const PK = chainKey === "devchain"
  ? process.env.DEVCHAIN_PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  : process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;

if (!PK) {
  console.error("Missing OG_PRIVATE_KEY / PRIVATE_KEY in .env.local");
  process.exit(1);
}

const CONTRACT_NAME = "AdextoFactory";
const artifactPath = path.join(process.cwd(), "build", "artifacts", `${CONTRACT_NAME}.json`);
if (!fs.existsSync(artifactPath)) {
  console.error("Artifact missing. Run: node scripts/compile-contracts.mjs --via-ir");
  process.exit(1);
}
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

/**
 * The constructor signature is READ FROM THE ARTIFACT rather than assumed.
 *
 * This script used to call `factory.deploy()` with no arguments, which was correct
 * for the previous factory and silently wrong for this one. Deriving the arity here
 * means the next constructor change fails loudly at this line instead of producing
 * a deployment whose immutables are not what anyone intended.
 */
const ctor = artifact.abi.find((f) => f.type === "constructor");
const ctorInputs = ctor?.inputs ?? [];
if (ctorInputs.length !== 1 || ctorInputs[0].type !== "address") {
  console.error(
    `Unexpected ${CONTRACT_NAME} constructor: expected exactly one address (the protocol treasury), got ` +
      `[${ctorInputs.map((i) => `${i.type} ${i.name}`).join(", ")}]. Recompile, or update this script deliberately.`
  );
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(net.rpc);
const wallet = new ethers.Wallet(PK, provider);

/**
 * Protocol treasury: immutable, permanent, and therefore validated hard.
 *
 * The deployer key is rejected explicitly. It is online by definition (it deploys
 * and it places demo trades) and on 0G it is already the `creator` of live markets,
 * so pointing the protocol leg at it would make protocol revenue and creator
 * revenue indistinguishable on-chain for anyone auditing the split.
 */
const treasuryRaw = (args[args.indexOf("--treasury") + 1] || "").startsWith("0x")
  ? args[args.indexOf("--treasury") + 1]
  : process.env.PROTOCOL_TREASURY || "";

if (!treasuryRaw) {
  console.error(
    "Missing protocol treasury. Set PROTOCOL_TREASURY in .env.local or pass --treasury 0x…\n" +
      "It is stored immutable in the factory and in every curve the factory deploys, so it cannot be changed later."
  );
  process.exit(1);
}

let PROTOCOL_TREASURY;
try {
  PROTOCOL_TREASURY = ethers.getAddress(treasuryRaw.trim());
} catch {
  console.error(`Protocol treasury is not a valid address: ${treasuryRaw}`);
  process.exit(1);
}

if (PROTOCOL_TREASURY === ethers.ZeroAddress) {
  console.error("Protocol treasury is the zero address. The constructor would revert, and rightly so.");
  process.exit(1);
}

if (PROTOCOL_TREASURY.toLowerCase() === wallet.address.toLowerCase()) {
  console.error(
    `Protocol treasury equals the deployer (${wallet.address}). Refusing.\n` +
      "The deployer is a hot key and is already a market creator, so this would permanently merge\n" +
      "protocol revenue with creator revenue. Use a separate address."
  );
  process.exit(1);
}

/**
 * A contract treasury is allowed but not by accident.
 *
 * `claimProtocolFees()` pushes native with a plain `call`; a contract with no
 * `receive`/`fallback`, or one that runs out of the forwarded gas, makes the claim
 * revert every time and strands the accrued fees permanently. A Safe handles this
 * fine, which is why the flag exists rather than a flat ban.
 */
// Chain dipastikan dulu. Probe `getCode` di bawah hanya bermakna kalau kita benar
// sedang bicara dengan chain yang dimaksud — kalau RPC-nya chain lain, jawabannya
// tentang alamat lain.
const onChain = await provider.getNetwork();
if (Number(onChain.chainId) !== net.chainId) {
  console.error(`RPC chainId mismatch: expected ${net.chainId}, got ${onChain.chainId}`);
  process.exit(1);
}

const treasuryCode = await provider.getCode(PROTOCOL_TREASURY);
const treasuryIsContract = treasuryCode !== "0x";
if (treasuryIsContract && !args.includes("--allow-contract-treasury")) {
  console.error(
    `Protocol treasury ${PROTOCOL_TREASURY} is a contract on ${chainKey} (${(treasuryCode.length - 2) / 2} bytes of code).\n` +
      "If it cannot receive plain native transfers, every claimProtocolFees() call reverts and the fees are stranded forever.\n" +
      "Confirm it accepts native (a Safe does), then re-run with --allow-contract-treasury."
  );
  process.exit(1);
}

const balance = await provider.getBalance(wallet.address);
const feeData = await provider.getFeeData();
const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits("1", "gwei");

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const deployTx = await factory.getDeployTransaction(PROTOCOL_TREASURY);
let gasEstimate;
try {
  gasEstimate = await provider.estimateGas({ from: wallet.address, data: deployTx.data });
} catch (e) {
  console.error(`estimateGas failed: ${e.shortMessage || e.message}`);
  process.exit(1);
}
const cost = gasEstimate * gasPrice;

console.log(`network      : ${chainKey} (chainId ${net.chainId})${IS_TESTNET ? "  [TESTNET — dana uji]" : chainKey === "devchain" ? "  [LOKAL]" : "  [MAINNET — gas nyata]"}`);
console.log(`contract     : ${CONTRACT_NAME}`);
console.log(`deployer     : ${wallet.address}`);
console.log(`treasury     : ${PROTOCOL_TREASURY}${treasuryIsContract ? "  [CONTRACT — allowed by flag]" : "  [EOA]"}`);
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
    `\nDRY RUN — nothing was sent. Re-run with --broadcast to deploy.\n` +
      `If broadcast, ${PROTOCOL_TREASURY} becomes the permanent protocol fee destination on ${chainKey}.`
  );
  process.exit(0);
}

console.log("\nBroadcasting...");
const contract = await factory.deploy(PROTOCOL_TREASURY);
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
 * Read the immutables BACK from the chain instead of trusting the constructor
 * argument we just sent. This is the last moment the value is checkable at all —
 * after this the address is unchangeable, so a mismatch has to surface now, loudly,
 * while the only cost is one wasted deployment.
 */
const deployed = new ethers.Contract(
  address,
  [
    "function VERSION() view returns (string)",
    "function protocolTreasury() view returns (address)",
    "function PROTOCOL_FEE_BPS() view returns (uint256)",
  ],
  provider
);
const [onChainVersion, onChainTreasury, onChainFeeBps] = await Promise.all([
  deployed.VERSION(),
  deployed.protocolTreasury(),
  deployed.PROTOCOL_FEE_BPS(),
]);
console.log(`  VERSION : ${onChainVersion}`);
console.log(`  treasury: ${onChainTreasury}`);
console.log(`  protocol fee: ${onChainFeeBps} bps (${(Number(onChainFeeBps) / 100).toFixed(2)}%, charged on top)`);

if (ethers.getAddress(onChainTreasury) !== PROTOCOL_TREASURY) {
  console.error(
    `\nTREASURY MISMATCH. Sent ${PROTOCOL_TREASURY}, chain reports ${onChainTreasury}.\n` +
      "Do NOT put this factory into NEXT_PUBLIC_CURVE_FACTORY_*. Deploy again."
  );
  process.exit(1);
}

const outFile = path.join(process.cwd(), "build", "deployments.json");
const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
/**
 * Kunci `curveFactory`, BUKAN `factoryV2`.
 *
 * Skrip ini men-deploy AdextoCurveFactory tetapi menulis alamatnya di bawah
 * kunci `factoryV2` — generasi yang berbeda, yang mewajibkan seed native. Jadi
 * `build/deployments.json` menamai setiap alamat kurva sebagai pool berseed.
 * Runbook §4b sudah memuat peringatan tentang salah-nama-field yang pernah
 * menyesatkan ("`/api/deploy` mengembalikan `factoryV2`, bukan
 * `factoryV2Address`"); ini kemunculan berikutnya dari kesalahan yang sama.
 *
 * `startBlock` ditambahkan karena subgraph membutuhkannya, dan blok deploy adalah
 * satu-satunya tempat nilai itu diketahui dengan pasti. Tanpa itu, manifest
 * subgraph harus menebak — dan menebak terlalu rendah berarti memindai jutaan
 * blok kosong di setiap chain.
 */
/**
 * Alamat factory sebelumnya DIPERTAHANKAN, tidak ditimpa.
 *
 * Sampai 0.11.0 setiap chain hanya punya satu factory, jadi menulis ulang kunci
 * chain-nya tidak menghilangkan apa pun. Sekarang tidak lagi: enam pasar di 0G
 * dibuat oleh factory 0.10.0 dan bytecode-nya tidak bisa diubah, jadi alamat itu
 * tetap harus bisa ditemukan — untuk verifikasi source-vs-chain, untuk startBlock
 * subgraph yang sudah mengindeksnya, dan supaya tidak ada yang menyimpulkan pasar
 * lama tidak pernah ada karena catatannya hilang.
 */
const previous = existing[chainKey];
const superseded = previous?.curveFactory && previous.curveFactory !== address
  ? [
      ...(previous.supersededCurveFactories ?? []),
      {
        contract: previous.contract ?? "AdextoCurveFactory",
        curveFactory: previous.curveFactory,
        txHash: previous.txHash ?? null,
        blockNumber: previous.blockNumber ?? null,
        startBlock: previous.startBlock ?? null,
        deployedAt: previous.deployedAt ?? null,
      },
    ]
  : previous?.supersededCurveFactories ?? [];

existing[chainKey] = {
  chainId: net.chainId,
  contract: CONTRACT_NAME,
  version: onChainVersion,
  curveFactory: address,
  protocolTreasury: PROTOCOL_TREASURY,
  protocolFeeBps: Number(onChainFeeBps),
  deployer: wallet.address,
  txHash: tx.hash,
  blockNumber: receipt.blockNumber,
  startBlock: receipt.blockNumber,
  deployedAt: new Date().toISOString(),
  ...(superseded.length > 0 ? { supersededCurveFactories: superseded } : {}),
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(existing, null, 2));
console.log(`\nSaved to build/deployments.json`);

/**
 * Urutannya disebutkan di sini karena inilah tempat orang membacanya.
 *
 * `audit_consistency.mjs` membaca `totalProjectsCount()` dari
 * `NEXT_PUBLIC_CURVE_FACTORY_*`. Menukar env ke factory baru SEBELUM meluncurkan
 * ulang berarti situs menunjuk factory dengan nol peluncuran sementara halamannya
 * masih menyatakan $ADEXTO hidup. Jadi tukar-env dan relaunch adalah satu urutan,
 * bukan dua pekerjaan terpisah.
 */
const ENV_KEY = `NEXT_PUBLIC_CURVE_FACTORY_${chainKey.toUpperCase().replace(/-/g, "_")}`;
console.log(`\nNext, as ONE sequence — do not stop halfway:`);
console.log(`  1. remove the old ticker's registry entry (checkSymbolAvailable blocks a live symbol on the same chain)`);
console.log(`  2. set ${ENV_KEY}=${address} in .env.local`);
console.log(`  3. relaunch the market through the new factory`);
console.log(`  4. rebuild, then verify the market page resolves and the terminal shows fills`);
if (superseded.length > 0) {
  console.log(
    `\nSuperseded factory kept on record: ${superseded[superseded.length - 1].curveFactory}\n` +
      `Its markets stay tradable forever and keep charging their original fee legs, which do not include a protocol fee.`
  );
}
