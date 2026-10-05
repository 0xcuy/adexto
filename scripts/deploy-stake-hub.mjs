/**
 * Deploy AdextoStakeHub, one per chain: the stake contract for every ADEXTO market on that chain
 * that does not have its own AdextoAgentStake.
 *
 *   node scripts/compile-contracts.mjs --via-ir
 *   node scripts/deploy-stake-hub.mjs --chain monad               # dry run, nothing sent
 *   node scripts/deploy-stake-hub.mjs --chain monad --broadcast
 *
 * WHAT IS FIXED AT CONSTRUCTION, AND WHERE IT COMES FROM
 *
 * The constructor takes two lists, and neither can ever change afterwards:
 *   - the ADEXTO factories whose tokens may be staked: on each chain, the v1 factory (every new
 *     launch) and the 0.11.0 factory where the earlier live markets trade. 0.12.0 is left out on
 *     purpose: it was retired after two days and holds no listed market;
 *   - the tokens that already have their own AdextoAgentStake ($ADEXTO on 0G, $SAI on Arbitrum
 *     One, Robinhood Chain and Monad), so no market ever has two stake contracts.
 *
 * WHAT IS CHECKED BEFORE ANYTHING IS SENT
 *   - the artifact is the source on disk (solc metadata keccak), compiled with solc 0.8.37,
 *     EVM cancun, 200 runs, via-IR, and the source declares VERSION 1.0.0;
 *   - a mainnet broadcast comes from a committed source that is on origin/main, so the commit
 *     recorded with the deployment is public;
 *   - the RPC answers the expected chain id, and the chain executes PUSH0 and MCOPY;
 *   - every factory has code and reports the expected VERSION;
 *   - every excluded token really is bound to the dedicated stake contract the app lists for it
 *     (`stakeToken()` reads back the token), and was made by one of the factories;
 *   - every live market on this chain in src/config/onchain-launches.json that is not excluded
 *     was made by one of the factories, i.e. will be stakeable here;
 *   - a simulated creation returns exactly the artifact's runtime;
 *   - the deployer can pay (Monad charges the whole gas limit).
 * After the broadcast: the runtime, VERSION, the divisor, both lists, and eligibility of every
 * market are read back from the chain, with a control address that must be refused.
 *
 * Output: build/deployments.json → <chain>.stakeHub (merged, the rest of the entry is kept), and
 * the line for src/config/stake-hubs.ts. Verify afterwards with scripts/verify-sourcify.mjs.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const ROOT = process.cwd();
const CONTRACT = "AdextoStakeHub";
const SOURCE = "contracts/AdextoStakeHub.sol";
const EXPECTED_VERSION = "1.0.0";
const GAS_MARGIN_PCT = 10n;
const OPCODE_PROBE = "0x602a5f5260205f60205e60206020f3";
const POST_LONDON = { 0x5f: "PUSH0", 0x5e: "MCOPY", 0x5c: "TLOAD", 0x5d: "TSTORE", 0x49: "BLOBHASH", 0x4a: "BLOBBASEFEE" };
const PROBED = new Set(["PUSH0", "MCOPY"]);

/**
 * Factories and dedicated stakes per chain. Addresses are the ones in src/config/contracts.ts,
 * src/config/factory-deployments.json, src/config/market-stakes.ts and .env.local
 * (NEXT_PUBLIC_AGENT_STAKE_0G), and every one is re-checked on chain below.
 */
const NETWORKS = {
  monad: {
    chainId: 143,
    rpc: "https://rpc.monad.xyz",
    explorer: "https://monadscan.com",
    chargesGasLimit: true,
    factories: [
      { address: "0x3dFcBEd7dd889F465cC9f75c430B43Ef873b6056", version: "1.0.0" },
      { address: "0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3", version: "0.11.0" },
    ],
    ownStake: [{ symbol: "SAI", token: "0xD873B033e2dffbF7E3107CD61E7156cE23B39f20", stake: "0xAadb44692dC4c9A1759361ea973B83aa7f36700e" }],
  },
  arbitrum: {
    chainId: 42161,
    rpc: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    factories: [
      { address: "0x79DF3671e7e7456832C84a34c2bC0DB7871C0E0E", version: "1.0.0" },
      { address: "0xE17f1027FC5f294327D701829baeD9d6519e922C", version: "0.11.0" },
    ],
    ownStake: [{ symbol: "SAI", token: "0xC4b5eA97bd4e3f8Bc047fFCc74Ca9c2B6b426cb3", stake: "0x2fc2A49ea2e4357541Dda9488DCeadCD0c43B508" }],
  },
  base: {
    chainId: 8453,
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    factories: [
      { address: "0xF5f904ca7763Fc6755bbCe5466a9DBd4C15c2708", version: "1.0.0" },
      { address: "0x216E7880D64D94335B583c539802d3e61958d4A2", version: "0.11.0" },
    ],
    ownStake: [],
  },
  "0g": {
    chainId: 16661,
    rpc: process.env.OG_RPC_URL || "https://evmrpc.0g.ai",
    explorer: "https://chainscan.0g.ai",
    factories: [
      { address: "0xEBbE0fB112859b57A0ad1afbeD4978e43dC96c5D", version: "1.0.0" },
      { address: "0x51c4168226463F7e5A141e1c6D30520734BC840a", version: "0.11.0" },
    ],
    ownStake: [{ symbol: "ADEXTO", token: "0xA1358C17004469C7CA5365AbafD294F9b2c11DF7", stake: "0x5b44AEA7AC49C7a6DA8f700D991852A2970b9231" }],
  },
  robinhood: {
    chainId: 4663,
    rpc: process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    factories: [{ address: "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D", version: "1.0.0" }],
    ownStake: [{ symbol: "SAI", token: "0x4C63223B883B3096bC1Bd24087b56951D1dAC82d", stake: "0x01b250a2db25561dB185f4628B93C72048D8bc1B" }],
  },
  /**
   * Arc: the factory address is PREDICTED (deployer nonce 0 on 5042, checked 2026-10-06), the same
   * address as on Robinhood. It is only valid once `deploy-factory.mjs --chain arc` has broadcast at
   * that nonce; until then the on-chain checks below refuse, which is the intended order.
   * The broadcast sends `maxFeePerGas` from getFeeData (2 × base fee + tip, ~40 gwei), above Arc's
   * 20 gwei mempool floor.
   */
  arc: {
    chainId: 5042,
    rpc: process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
    factories: [{ address: "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D", version: "1.0.0" }],
    ownStake: [],
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] ?? "" : "";
};
const chainKey = argValue("--chain").toLowerCase();
const BROADCAST = args.includes("--broadcast");
const net = NETWORKS[chainKey];
if (!net) fail(`Usage: node scripts/deploy-stake-hub.mjs --chain <${Object.keys(NETWORKS).join("|")}> [--broadcast]`);
if (process.env.DEPLOY_RPC) net.rpc = process.env.DEPLOY_RPC;

// ─── 1. The artifact is the source on disk ────────────────────────────────────────────────────

const artifactPath = path.join(ROOT, "build", "artifacts", `${CONTRACT}.json`);
if (!fs.existsSync(artifactPath)) fail("Artifact missing. Run: node scripts/compile-contracts.mjs --via-ir");
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
if (!artifact.metadata) fail("Artifact has no metadata. Recompile with --via-ir.");
const metadata = JSON.parse(artifact.metadata);
const settings = metadata.settings ?? {};
if (!String(metadata.compiler?.version).startsWith("0.8.37+")) fail(`Compiled with solc ${metadata.compiler?.version}, expected 0.8.37.`);
if (settings.evmVersion !== "cancun") fail(`EVM ${settings.evmVersion}, expected cancun.`);
if (settings.optimizer?.enabled !== true || settings.optimizer?.runs !== 200) fail("Optimizer must be enabled with 200 runs.");
if (settings.viaIR !== true) fail("Compiled without via-IR. Recompile with --via-ir.");
for (const source of Object.keys(metadata.sources ?? {})) {
  const onDisk = source.startsWith("@") ? path.join(ROOT, "node_modules", source) : path.join(ROOT, source);
  if (!fs.existsSync(onDisk)) fail(`Source ${source} is missing on disk.`);
  if (ethers.keccak256(fs.readFileSync(onDisk)) !== metadata.sources[source].keccak256) {
    fail(`${source} changed after compilation. Recompile: node scripts/compile-contracts.mjs --via-ir`);
  }
}
const declared = fs.readFileSync(path.join(ROOT, SOURCE), "utf8").match(/string public constant VERSION = "([^"]+)";/)?.[1];
if (declared !== EXPECTED_VERSION) fail(`${SOURCE} declares VERSION ${declared}, expected ${EXPECTED_VERSION}.`);
const ctor = artifact.abi.find((f) => f.type === "constructor")?.inputs ?? [];
if (ctor.length !== 2 || ctor[0].type !== "address[]" || ctor[1].type !== "address[]") {
  fail(`Unexpected constructor (${ctor.map((i) => i.type).join(", ")}). Update this script deliberately.`);
}
if (Object.keys(artifact.immutableReferences ?? {}).length !== 0) fail("The hub is expected to have no immutables.");

// ─── 2. The source is committed and public ───────────────────────────────────────────────────

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
const SOURCE_COMMIT = git("rev-parse", "HEAD");
const sourceProblems = [];
if (git("status", "--porcelain", "--", SOURCE)) sourceProblems.push(`${SOURCE} has uncommitted changes`);
try {
  git("merge-base", "--is-ancestor", "HEAD", "origin/main");
} catch {
  sourceProblems.push(`HEAD ${SOURCE_COMMIT.slice(0, 7)} is not on origin/main`);
}
if (BROADCAST && sourceProblems.length) fail(`Refusing a mainnet broadcast from a source that is not public:\n  - ${sourceProblems.join("\n  - ")}`);

// ─── 3. Chain, factories, exclusions, markets ─────────────────────────────────────────────────

const PK = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK) fail("Missing OG_PRIVATE_KEY / PRIVATE_KEY in .env.local");
const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true, batchMaxCount: 1 });
const wallet = new ethers.Wallet(PK, provider);
const liveChainId = Number(await provider.send("eth_chainId", []));
if (liveChainId !== net.chainId) fail(`RPC answers chain ${liveChainId}, expected ${net.chainId}.`);

const FACTORY_ABI = ["function VERSION() view returns (string)", "function curveOf(address) view returns (address)"];
for (const f of net.factories) {
  if ((await provider.getCode(f.address)) === "0x") fail(`Factory ${f.address} has no code on ${chainKey}.`);
  const v = await new ethers.Contract(f.address, FACTORY_ABI, provider).VERSION();
  if (v !== f.version) fail(`Factory ${f.address} reports VERSION ${v}, expected ${f.version}.`);
  await sleep(150);
}
async function madeBy(token) {
  for (const f of net.factories) {
    const c = await new ethers.Contract(f.address, FACTORY_ABI, provider).curveOf(token);
    await sleep(120);
    if (c !== ethers.ZeroAddress) return { factory: f, curve: c };
  }
  return null;
}
for (const o of net.ownStake) {
  const bound = await new ethers.Contract(o.stake, ["function stakeToken() view returns (address)"], provider).stakeToken();
  if (ethers.getAddress(bound) !== ethers.getAddress(o.token)) fail(`Dedicated stake ${o.stake} is bound to ${bound}, not $${o.symbol} ${o.token}.`);
  if (!(await madeBy(o.token))) fail(`$${o.symbol} ${o.token} was not made by any listed factory.`);
}
const excluded = new Set(net.ownStake.map((o) => ethers.getAddress(o.token)));
const launches = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "config", "onchain-launches.json"), "utf8")).launches;
const candidates = launches.filter((l) => l.status === "live" && Number(l.chainId) === net.chainId && !excluded.has(ethers.getAddress(l.token)));
for (const c of candidates) {
  const m = await madeBy(c.token);
  if (!m) fail(`Live market $${c.symbol} ${c.token} was not made by any listed factory: it would not be stakeable.`);
  c.via = `${m.factory.version} curve ${m.curve}`;
}

// ─── 4. The chain runs this bytecode, and the creation is simulated ───────────────────────────

const runtimeBytes = Buffer.from(artifact.deployedBytecode.slice(2), "hex");
const metaLen = (runtimeBytes[runtimeBytes.length - 2] << 8) | runtimeBytes[runtimeBytes.length - 1];
const codeEnd = runtimeBytes.length - 2 - metaLen;
const used = new Set();
for (let i = 0; i < codeEnd; i++) {
  const op = runtimeBytes[i];
  if (op >= 0x60 && op <= 0x7f) {
    i += op - 0x5f;
    continue;
  }
  if (POST_LONDON[op]) used.add(POST_LONDON[op]);
}
const unprobed = [...used].filter((o) => !PROBED.has(o));
if (unprobed.length) fail(`The runtime uses ${unprobed.join(", ")}, which this script cannot probe.`);
try {
  const r = await provider.call({ data: OPCODE_PROBE });
  if (BigInt(r) !== 0x2an) fail(`Opcode probe returned ${r}, expected 0x2a.`);
} catch (e) {
  fail(`${chainKey} did not execute PUSH0/MCOPY: ${(e.shortMessage ?? e.message).slice(0, 160)}`);
}

const FACTORIES = net.factories.map((f) => ethers.getAddress(f.address));
const OWN = net.ownStake.map((o) => ethers.getAddress(o.token));
const coder = ethers.AbiCoder.defaultAbiCoder();
const CONSTRUCTOR_ARGS = coder.encode(["address[]", "address[]"], [FACTORIES, OWN]);
const deployData = artifact.bytecode + CONSTRUCTOR_ARGS.slice(2);
const simulated = await provider.call({ from: wallet.address, data: deployData });
if (simulated.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) fail("The simulated creation did not return the artifact's runtime. Nothing was sent.");

// ─── 5. The deployer can pay ──────────────────────────────────────────────────────────────────

const estimate = await provider.estimateGas({ from: wallet.address, data: deployData });
const gasLimit = (estimate * (100n + GAS_MARGIN_PCT)) / 100n;
const fee = await provider.getFeeData();
const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
const maxCost = gasLimit * price;
const balance = await provider.getBalance(wallet.address);
const nonce = await provider.getTransactionCount(wallet.address, "latest");
const pending = await provider.getTransactionCount(wallet.address, "pending");
if (pending !== nonce) fail(`The deployer has ${pending - nonce} pending transaction(s). Wait for them first.`);
const predicted = ethers.getCreateAddress({ from: wallet.address, nonce });

console.log(`network      : ${chainKey} (${net.chainId})`);
console.log(`source       : ${SOURCE} @ ${SOURCE_COMMIT.slice(0, 7)}${sourceProblems.length ? `  (not publishable: ${sourceProblems.join("; ")})` : ""}`);
console.log(`runtime      : ${runtimeBytes.length} bytes · opcodes ${[...used].join(", ") || "none newer than London"}`);
console.log(`factories    : ${net.factories.map((f) => `${f.address} (${f.version})`).join(", ")}`);
console.log(`own stake    : ${net.ownStake.map((o) => `$${o.symbol} ${o.token} → ${o.stake}`).join(", ") || "none"}`);
console.log(`stakeable now: ${candidates.map((c) => `$${c.symbol} (${c.via})`).join(", ") || "no live market yet; every new launch"}`);
console.log(`deployer     : ${wallet.address} · nonce ${nonce} · balance ${ethers.formatEther(balance)}`);
console.log(`address      : ${predicted} (predicted)`);
console.log(`gas          : ${gasLimit} × ${ethers.formatUnits(price, "gwei")} gwei ≈ ${ethers.formatEther(maxCost)}${net.chargesGasLimit ? " (charged in full)" : " (at most)"}`);
if (balance < maxCost) fail("Insufficient balance for the deployment.");
if (!BROADCAST) {
  console.log("\nDRY RUN — nothing sent. Re-run with --broadcast.");
  process.exit(0);
}

// ─── 6. Broadcast, record, read back ─────────────────────────────────────────────────────────

const tx = await wallet.sendTransaction({ data: deployData, gasLimit, nonce });
console.log(`\ntx           : ${tx.hash}`);
let receipt = null;
for (let i = 0; i < 300 && !receipt; i++) {
  await sleep(2000);
  receipt = await provider.getTransactionReceipt(tx.hash).catch(() => null);
}
if (!receipt) fail(`No receipt after 10 minutes for ${tx.hash}. Check it on ${net.explorer}/tx/${tx.hash} before doing anything else.`);
if (receipt.status !== 1) fail(`Deployment reverted: ${net.explorer}/tx/${tx.hash}`);
const address = receipt.contractAddress;
console.log(`address      : ${address} · block ${receipt.blockNumber} · gas ${receipt.gasUsed}`);

const outFile = path.join(ROOT, "build", "deployments.json");
function record(checks) {
  const all = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
  all[chainKey] = all[chainKey] || {};
  all[chainKey].stakeHub = {
    address,
    chainId: net.chainId,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    sourceCommit: SOURCE_COMMIT,
    compiler: metadata.compiler.version,
    factories: FACTORIES,
    ownStakeTokens: OWN,
    constructorArgs: CONSTRUCTOR_ARGS.slice(2),
    checks,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(all, null, 2));
}
record("pending");

let runtime = "0x";
for (let i = 0; i < 10 && runtime === "0x"; i++) {
  if (i) await sleep(1500);
  runtime = await provider.getCode(address).catch(() => "0x");
}
const problems = [];
if (runtime.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) problems.push("runtime differs from the artifact");
const hub = new ethers.Contract(
  address,
  [
    "function VERSION() view returns (string)",
    "function MIN_STAKE_DIVISOR() view returns (uint256)",
    "function factories() view returns (address[])",
    "function tokensWithOwnStake() view returns (address[])",
    "function hasOwnStake(address) view returns (bool)",
    "function isEligible(address) view returns (bool)",
    "function minStakeOf(address) view returns (uint256)",
    "function totalStaked(address) view returns (uint256)",
  ],
  provider
);
const [v, divisor, fs_, own] = await Promise.all([hub.VERSION(), hub.MIN_STAKE_DIVISOR(), hub.factories(), hub.tokensWithOwnStake()]);
if (v !== EXPECTED_VERSION) problems.push(`VERSION ${v}`);
if (divisor !== 100000n) problems.push(`MIN_STAKE_DIVISOR ${divisor}`);
if (fs_.map((a) => ethers.getAddress(a)).join() !== FACTORIES.join()) problems.push("factories differ");
if (own.map((a) => ethers.getAddress(a)).join() !== OWN.join()) problems.push("excluded tokens differ");
for (const o of OWN) {
  await sleep(150);
  if (!(await hub.hasOwnStake(o)) || (await hub.isEligible(o))) problems.push(`${o} is not refused`);
}
for (const c of candidates) {
  await sleep(150);
  const [ok, min] = await Promise.all([hub.isEligible(c.token), hub.minStakeOf(c.token)]);
  const supply = await new ethers.Contract(c.token, ["function totalSupply() view returns (uint256)"], provider).totalSupply();
  if (!ok) problems.push(`$${c.symbol} is not eligible`);
  if (min !== supply / 100000n) problems.push(`$${c.symbol} minimum ${min} is not supply / 100000`);
  console.log(`  $${c.symbol.padEnd(7)} eligible ${ok} · minimum ${ethers.formatUnits(min, 18)}`);
}
const control = ethers.getAddress("0x000000000000000000000000000000000000dEaD");
if (await hub.isEligible(control)) problems.push("control address reads as eligible");
if (problems.length) {
  record(`failed: ${problems.join("; ")}`);
  fail(`READ-BACK FAILED: ${problems.join("; ")}. Do not list ${address} in src/config/stake-hubs.ts.`);
}
record("passed");
console.log(`  read back    : VERSION ${v} · divisor ${divisor} · ${FACTORIES.length} factories · ${OWN.length} excluded · control refused → OK`);
console.log(`\nSaved to build/deployments.json → ${chainKey}.stakeHub`);
console.log(`\nNext:\n  node scripts/verify-sourcify.mjs --chain-id ${net.chainId} --address ${address} --contract ${CONTRACT} --tx ${tx.hash}`);
console.log(`  Add to STAKE_HUBS in src/config/stake-hubs.ts:\n  ${net.chainId}: { address: "${address}", deployBlock: ${receipt.blockNumber}, deployTx: "${tx.hash}" },`);
