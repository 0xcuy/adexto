/**
 * Deploy AdextoAgentStake for ONE market launched by the v1 factory, on that market's chain.
 *
 *   node scripts/deploy-market-stake.mjs --chain arbitrum --symbol SAI --min 10000              # dry run
 *   node scripts/deploy-market-stake.mjs --chain arbitrum --symbol SAI --min 10000 --broadcast
 *
 * WHY A SECOND SCRIPT, NOT A FLAG ON deploy-agent-stake.mjs
 *
 * deploy-agent-stake.mjs deploys the Agent Compute stake for $ADEXTO on 0G and reads its policy
 * from src/config/agent-compute.ts. A market stake is a different binding: any v1 market, on its
 * own chain, with its own minimum. Folding both into one script would make every safety check
 * there conditional, and those checks are the reason that script exists.
 *
 * WHAT IS CHECKED BEFORE ANYTHING IS SENT
 *   - the RPC answers the chain id it is supposed to;
 *   - the token is the one the production registry lists for this ticker on THIS chain, and
 *     the v1 factory on this chain created it (curveOf(token) is set), so a stake can never be
 *     bound to a look-alike token;
 *   - symbol() on chain equals --symbol;
 *   - the artifact's constructor is (address token, uint256 minimumStake);
 *   - the deployer can pay the gas.
 * After deployment the immutables are read back from the chain and must equal what was sent.
 *
 * The contract has no owner and no setter, so the token and the minimum are permanent. A wrong
 * deployment can only be abandoned.
 *
 * Output: build/deployments.json → <chainKey>.marketStakes.<SYMBOL>, and the line to paste into
 * src/config/market-stakes.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const NETWORKS = {
  arbitrum: { chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io", factory: "0x79DF3671e7e7456832C84a34c2bC0DB7871C0E0E" },
  robinhood: { chainId: 4663, rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com", factory: "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D" },
  base: { chainId: 8453, rpc: "https://mainnet.base.org", explorer: "https://basescan.org", factory: "0xF5f904ca7763Fc6755bbCe5466a9DBd4C15c2708" },
  monad: { chainId: 143, rpc: "https://rpc.monad.xyz", explorer: "https://monadscan.com", factory: "0x3dFcBEd7dd889F465cC9f75c430B43Ef873b6056" },
  "0g": { chainId: 16661, rpc: "https://evmrpc.0g.ai", explorer: "https://chainscan.0g.ai", factory: "0xEBbE0fB112859b57A0ad1afbeD4978e43dC96c5D" },
};
const SITE = process.env.DEPLOY_SITE || "https://adexto.xyz";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const chainKey = (flag("--chain") || "").toLowerCase();
const SYMBOL = (flag("--symbol") || "").toUpperCase();
const MIN_WHOLE = flag("--min");
const BROADCAST = args.includes("--broadcast");
const net = NETWORKS[chainKey];
if (!net || !SYMBOL || !MIN_WHOLE || !/^\d+$/.test(MIN_WHOLE) || Number(MIN_WHOLE) <= 0) {
  console.error(`Usage: node scripts/deploy-market-stake.mjs --chain <${Object.keys(NETWORKS).join("|")}> --symbol SAI --min 10000 [--broadcast]`);
  process.exit(1);
}
const PK = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK) {
  console.error("Missing OG_PRIVATE_KEY / PRIVATE_KEY in .env.local");
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(path.join("build", "artifacts", "AdextoAgentStake.json"), "utf8"));
const ctor = artifact.abi.find((f) => f.type === "constructor");
if (!(ctor?.inputs?.length === 2 && ctor.inputs[0].type === "address" && ctor.inputs[1].type === "uint256")) {
  console.error("Unexpected AdextoAgentStake constructor. Recompile with node scripts/compile-contracts.mjs --via-ir.");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true, batchMaxCount: 1 });
const wallet = new ethers.Wallet(PK, provider);
const live = await provider.send("eth_chainId", []);
if (Number(live) !== net.chainId) {
  console.error(`RPC chainId mismatch: expected ${net.chainId}, got ${Number(live)}`);
  process.exit(1);
}

// The market, as production lists it for THIS chain.
const pool = await (await fetch(`${SITE}/api/pool?symbol=${SYMBOL}&chainId=${net.chainId}`)).json();
if (!pool?.tokenAddress || Number(pool.chainId) !== net.chainId) {
  console.error(`The registry has no $${SYMBOL} on ${chainKey}: ${JSON.stringify(pool).slice(0, 200)}`);
  process.exit(1);
}
const TOKEN = ethers.getAddress(pool.tokenAddress);
const factory = new ethers.Contract(net.factory, ["function curveOf(address) view returns (address)", "function VERSION() view returns (string)"], provider);
const [curveOf, version] = await Promise.all([factory.curveOf(TOKEN), factory.VERSION()]);
if (curveOf === ethers.ZeroAddress) {
  console.error(`${TOKEN} was not created by the v1 factory ${net.factory}. Refusing.`);
  process.exit(1);
}
const erc20 = new ethers.Contract(TOKEN, ["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"], provider);
const [symbol, decimals, supply] = await Promise.all([erc20.symbol(), erc20.decimals(), erc20.totalSupply()]);
if (symbol !== SYMBOL) {
  console.error(`Token symbol on chain is "${symbol}", not ${SYMBOL}. Refusing.`);
  process.exit(1);
}
const MIN = ethers.parseUnits(MIN_WHOLE, Number(decimals));

const cf = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const deployTx = await cf.getDeployTransaction(TOKEN, MIN);
const gas = await provider.estimateGas({ from: wallet.address, data: deployTx.data });
const fee = await provider.getFeeData();
const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
const balance = await provider.getBalance(wallet.address);

console.log(`network     : ${chainKey} (${net.chainId})  [MAINNET]`);
console.log(`factory     : ${net.factory} (VERSION ${version})`);
console.log(`market      : $${SYMBOL}  token ${TOKEN}  curve ${curveOf}`);
console.log(`supply      : ${ethers.formatUnits(supply, decimals)} ${symbol}`);
console.log(`min stake   : ${MIN_WHOLE} ${symbol}  (${MIN} raw, permanent)`);
console.log(`deployer    : ${wallet.address}  balance ${ethers.formatEther(balance)}`);
console.log(`gas         : ${gas} × ${ethers.formatUnits(price, "gwei")} gwei ≈ ${ethers.formatEther(gas * price)}`);
if (balance < gas * price) {
  console.error("Insufficient balance for the deployment.");
  process.exit(1);
}
if (!BROADCAST) {
  console.log("\nDRY RUN — nothing sent. Re-run with --broadcast.");
  process.exit(0);
}

const contract = await cf.deploy(TOKEN, MIN);
const tx = contract.deploymentTransaction();
console.log(`\ntx          : ${tx.hash}`);
await contract.waitForDeployment();
const address = await contract.getAddress();
const receipt = await provider.getTransactionReceipt(tx.hash);
const deployed = new ethers.Contract(
  address,
  ["function stakeToken() view returns (address)", "function minStake() view returns (uint256)", "function totalStaked() view returns (uint256)", "function stakerCount() view returns (uint256)"],
  provider
);
const [onToken, onMin, onTotal, onCount] = await Promise.all([deployed.stakeToken(), deployed.minStake(), deployed.totalStaked(), deployed.stakerCount()]);
const ok = ethers.getAddress(onToken) === TOKEN && onMin === MIN && onTotal === 0n && onCount === 0n;
console.log(`address     : ${address}  block ${receipt.blockNumber}`);
console.log(`read back   : stakeToken ${onToken} · minStake ${onMin} · totalStaked ${onTotal} · stakers ${onCount} → ${ok ? "OK" : "MISMATCH"}`);
console.log(`explorer    : ${net.explorer}/address/${address}`);
if (!ok) process.exit(1);

const outFile = path.join("build", "deployments.json");
const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
existing[chainKey] = existing[chainKey] || {};
existing[chainKey].marketStakes = {
  ...(existing[chainKey].marketStakes || {}),
  [SYMBOL]: { address, block: receipt.blockNumber, tx: tx.hash, token: TOKEN, minStake: MIN.toString(), decimals: Number(decimals) },
};
fs.writeFileSync(outFile, JSON.stringify(existing, null, 2));
console.log(`\nWrote build/deployments.json → ${chainKey}.marketStakes.${SYMBOL}`);
console.log(`\nAdd to MARKET_STAKES in src/config/market-stakes.ts:\n`);
console.log(
  `  { chainId: ${net.chainId}, symbol: "${SYMBOL}", token: "${TOKEN}", contract: "${address}", ` +
    `minStake: ${MIN_WHOLE}, decimals: ${Number(decimals)}, deployBlock: ${receipt.blockNumber}, deployTx: "${tx.hash}" },`
);
