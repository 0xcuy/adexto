/**
 * Broadcast AdextoTrinityFactoryV2 (which ships the executable SovereignHook AMM).
 *
 * Dry run first (no transaction, no gas):
 *   node scripts/deploy-sovereign-dex.mjs --chain 0g
 *
 * Real broadcast (spends gas):
 *   node scripts/deploy-sovereign-dex.mjs --chain 0g --broadcast
 *
 * Supported --chain: 0g | arbitrum | base | monad | devchain
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

if (!net) {
  console.error(`Usage: node scripts/deploy-sovereign-dex.mjs --chain <${Object.keys(NETWORKS).join("|")}> [--broadcast]`);
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

const artifactPath = path.join(process.cwd(), "build", "artifacts", "AdextoTrinityFactoryV2.json");
if (!fs.existsSync(artifactPath)) {
  console.error("Artifact missing. Run: node scripts/compile-contracts.mjs --via-ir");
  process.exit(1);
}
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

const provider = new ethers.JsonRpcProvider(net.rpc);
const wallet = new ethers.Wallet(PK, provider);

const onChain = await provider.getNetwork();
if (Number(onChain.chainId) !== net.chainId) {
  console.error(`RPC chainId mismatch: expected ${net.chainId}, got ${onChain.chainId}`);
  process.exit(1);
}

const balance = await provider.getBalance(wallet.address);
const feeData = await provider.getFeeData();
const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits("1", "gwei");

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const deployTx = await factory.getDeployTransaction();
let gasEstimate;
try {
  gasEstimate = await provider.estimateGas({ from: wallet.address, data: deployTx.data });
} catch (e) {
  console.error(`estimateGas failed: ${e.shortMessage || e.message}`);
  process.exit(1);
}
const cost = gasEstimate * gasPrice;

console.log(`network      : ${chainKey} (chainId ${net.chainId})${IS_TESTNET ? "  [TESTNET — dana uji]" : chainKey === "devchain" ? "  [LOKAL]" : "  [MAINNET — gas nyata]"}`);
console.log(`deployer     : ${wallet.address}`);
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
  console.log("\nDRY RUN — nothing was sent. Re-run with --broadcast to deploy.");
  process.exit(0);
}

console.log("\nBroadcasting...");
const contract = await factory.deploy();
const tx = contract.deploymentTransaction();
console.log(`tx: ${tx.hash}`);
await contract.waitForDeployment();
const address = await contract.getAddress();
const receipt = await provider.getTransactionReceipt(tx.hash);

console.log(`\nAdextoTrinityFactoryV2 deployed`);
console.log(`  address : ${address}`);
console.log(`  block   : ${receipt.blockNumber}`);
console.log(`  gasUsed : ${receipt.gasUsed}`);
if (net.explorer) console.log(`  explorer: ${net.explorer}/address/${address}`);

const outFile = path.join(process.cwd(), "build", "deployments.json");
const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
existing[chainKey] = {
  chainId: net.chainId,
  factoryV2: address,
  deployer: wallet.address,
  txHash: tx.hash,
  blockNumber: receipt.blockNumber,
  deployedAt: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(existing, null, 2));
console.log(`\nSaved to build/deployments.json`);
console.log(`Next: set factoryV2Address for "${chainKey}" in src/config/contracts.ts`);
