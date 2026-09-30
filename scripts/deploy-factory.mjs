/**
 * Deploy the ADEXTO v1 launch factory: AdextoFactory, VERSION "1.0.0".
 *
 * The factory creates every market (one AdextoToken and one AdextoCurve per launch), so it is
 * the only contract ADEXTO deploys per chain. It has no owner, and neither does anything it
 * creates.
 *
 *   node scripts/compile-contracts.mjs --via-ir                  # writes build/artifacts/
 *   node scripts/deploy-factory.mjs --chain arbitrum             # dry run: no transaction, no gas
 *   node scripts/deploy-factory.mjs --chain arbitrum --broadcast # spends gas
 *
 * Mainnets: 0g | base | arbitrum | monad | robinhood
 * Testnets: 0g-testnet | base-sepolia | arbitrum-sepolia | monad-testnet
 * Local:    devchain (chain 31337 on :8545)
 *
 * Reads .env.local: OG_PRIVATE_KEY or PRIVATE_KEY, and PROTOCOL_TREASURY (or --treasury 0x…).
 * DEPLOY_RPC overrides the RPC of the selected chain.
 *
 * WHAT CANNOT BE CHANGED AFTER A BROADCAST
 * Both constructor arguments are permanent:
 *   - `protocolTreasury` is immutable in the factory and in every curve it creates. There is no
 *     setter, because a setter needs an owner and these contracts have none.
 *   - the reserved tickers (scripts/reserved-symbols.json) are written once, in the
 *     constructor. No function releases one, so a typo locks that name on this factory forever.
 * That is why the checks below refuse instead of warning.
 *
 * WHAT THE DRY RUN PROVES BEFORE ANY GAS IS SPENT
 *   1. The artifact was compiled from the source files as they are now (the keccak256 of every
 *      source is in the solc metadata), with solc 0.8.37, EVM cancun, 200 optimizer runs and
 *      via-IR, and the source declares VERSION "1.0.0". On a mainnet those files must also be
 *      committed and pushed, so the recorded commit is the public source of the deployment.
 *   2. The Foundry fixture reserves exactly the base list broadcast here.
 *   3. The chain executes the post-London opcodes the bytecode contains (PUSH0 and MCOPY).
 *   4. Simulating the creation returns the artifact's runtime code, with the treasury in its
 *      immutable slot.
 *   5. The deployer can pay for it, including the L1 data fee on Base.
 *
 * After a broadcast the same facts are read back from the chain. The deployment is written to
 * build/deployments.json as soon as it has a receipt, and marked `checks: "passed"` only when
 * every read-back holds.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const ROOT = process.cwd();
const CONTRACT_NAME = "AdextoFactory";
const EXPECTED_VERSION = "1.0.0";
const EXPECTED_COMPILER = "0.8.37";
const EXPECTED_EVM = "cancun";
const EXPECTED_RUNS = 200;
/** Headroom over eth_estimateGas. Unused gas is refunded everywhere except Monad, which charges the limit. */
const GAS_MARGIN_PCT = 10n;
/** A ticker nobody reserves. If the factory reports even this one as taken, the read-back is broken. */
const CONTROL_SYMBOL = "V1CONTROL";
/**
 * Creation code that stores 0x2a, copies it with MCOPY and returns the copy. It also uses PUSH0.
 * Run through eth_call it proves the chain executes both, and it cannot change any state.
 */
const OPCODE_PROBE = "0x602a5f5260205f60205e60206020f3";
/** Opcodes newer than London that this script knows how to probe. Anything else refuses. */
const PROBED_OPCODES = new Set(["PUSH0", "MCOPY"]);
const POST_LONDON_OPCODES = {
  0x5f: "PUSH0",
  0x5e: "MCOPY",
  0x5c: "TLOAD",
  0x5d: "TSTORE",
  0x49: "BLOBHASH",
  0x4a: "BLOBBASEFEE",
};
/** OP Stack GasPriceOracle predeploy, which prices the L1 data fee on Base. */
const OP_GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";

const NETWORKS = {
  // Mainnets
  "0g": {
    chainId: 16661,
    rpc: process.env.OG_RPC_URL || "https://evmrpc.0g.ai",
    explorer: "https://chainscan.0g.ai",
    native: "0G",
  },
  base: { chainId: 8453, rpc: "https://mainnet.base.org", explorer: "https://basescan.org", native: "ETH", opStack: true },
  arbitrum: { chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io", native: "ETH" },
  monad: {
    chainId: 143,
    rpc: "https://rpc.monad.xyz",
    explorer: "https://monadscan.com",
    native: "MON",
    chargesGasLimit: true,
  },
  robinhood: {
    chainId: 4663,
    rpc: process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    native: "ETH",
  },

  // Testnets: prove the flow on a real remote EVM before spending mainnet gas.
  "0g-testnet": {
    chainId: 16602,
    rpc: process.env.OG_TESTNET_RPC_URL || "https://evmrpc-testnet.0g.ai",
    explorer: "https://chainscan-newton.0g.ai",
    native: "0G",
    testnet: true,
  },
  "base-sepolia": {
    chainId: 84532,
    rpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    native: "ETH",
    opStack: true,
    testnet: true,
  },
  "arbitrum-sepolia": {
    chainId: 421614,
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    native: "ETH",
    testnet: true,
  },
  "monad-testnet": {
    chainId: 10143,
    rpc: "https://testnet-rpc.monad.xyz",
    explorer: "",
    native: "MON",
    chargesGasLimit: true,
    testnet: true,
  },

  devchain: { chainId: 31337, rpc: "http://127.0.0.1:8545", explorer: "", native: "ETH", local: true },
};

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
if (!net) {
  fail(`Usage: node scripts/deploy-factory.mjs --chain <${Object.keys(NETWORKS).join("|")}> [--broadcast]`);
}
// Public RPCs sometimes return 503 for minutes at a time; this avoids editing the script for it.
if (process.env.DEPLOY_RPC) net.rpc = process.env.DEPLOY_RPC;
const IS_MAINNET = !net.testnet && !net.local;

// ─── 1. The artifact is the source tree, compiled with the pinned settings ────────────────────

const artifactPath = path.join(ROOT, "build", "artifacts", `${CONTRACT_NAME}.json`);
if (!fs.existsSync(artifactPath)) fail("Artifact missing. Run: node scripts/compile-contracts.mjs --via-ir");
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
if (!artifact.metadata || !artifact.immutableReferences) {
  fail("Artifact has no metadata or immutableReferences. Recompile: node scripts/compile-contracts.mjs --via-ir");
}
const metadata = JSON.parse(artifact.metadata);
const settings = metadata.settings ?? {};

if (!String(metadata.compiler?.version).startsWith(`${EXPECTED_COMPILER}+`)) {
  fail(`Artifact was compiled with solc ${metadata.compiler?.version}, expected ${EXPECTED_COMPILER}.`);
}
if (settings.evmVersion !== EXPECTED_EVM) fail(`Artifact targets EVM ${settings.evmVersion}, expected ${EXPECTED_EVM}.`);
if (settings.optimizer?.enabled !== true || settings.optimizer?.runs !== EXPECTED_RUNS) {
  fail(`Artifact optimizer is ${JSON.stringify(settings.optimizer)}, expected enabled with ${EXPECTED_RUNS} runs.`);
}
if (settings.viaIR !== true) fail("Artifact was compiled without via-IR. Recompile with --via-ir.");

/**
 * The keccak256 the compiler recorded for every source must equal the file on disk. A stale
 * artifact would otherwise deploy code that no longer matches the source anyone can read, and
 * verification would fail only after the address exists.
 */
const sourceFiles = Object.keys(metadata.sources ?? {});
for (const source of sourceFiles) {
  const onDisk = source.startsWith("@") ? path.join(ROOT, "node_modules", source) : path.join(ROOT, source);
  if (!fs.existsSync(onDisk)) fail(`Source ${source} from the artifact metadata is missing on disk.`);
  const actual = ethers.keccak256(fs.readFileSync(onDisk));
  if (actual !== metadata.sources[source].keccak256) {
    fail(`${source} changed after the artifact was compiled. Recompile: node scripts/compile-contracts.mjs --via-ir`);
  }
}

for (const file of ["contracts/AdextoFactory.sol", "contracts/AdextoCurve.sol"]) {
  const declared = fs.readFileSync(path.join(ROOT, file), "utf8").match(/string public constant VERSION = "([^"]+)";/);
  if (declared?.[1] !== EXPECTED_VERSION) {
    fail(`${file} declares VERSION ${declared?.[1] ?? "(none)"}, expected ${EXPECTED_VERSION}.`);
  }
}

/**
 * The constructor shape is read from the ABI rather than assumed, so the next constructor change
 * fails here instead of producing a deployment whose immutables nobody intended.
 */
const ctorInputs = artifact.abi.find((f) => f.type === "constructor")?.inputs ?? [];
if (ctorInputs.length !== 2 || ctorInputs[0].type !== "address" || ctorInputs[1].type !== "string[]") {
  fail(
    `Unexpected ${CONTRACT_NAME} constructor: expected (address, string[]), got ` +
      `[${ctorInputs.map((i) => `${i.type} ${i.name}`).join(", ")}]. Update this script deliberately.`,
  );
}

/**
 * The factory has exactly one immutable, `protocolTreasury`. The read-back below compares it
 * with the treasury sent, so a second immutable must be handled here before it can ship.
 */
const immutableIds = Object.keys(artifact.immutableReferences);
if (immutableIds.length !== 1) {
  fail(`Expected one immutable (protocolTreasury), the artifact has ${immutableIds.length}. Update this script.`);
}
const immutableRanges = artifact.immutableReferences[immutableIds[0]];

// ─── 2. The reserved tickers ──────────────────────────────────────────────────────────────────

/**
 * Why reserve at all: `symbolRegistry` belongs to one factory, so a new factory starts with an
 * empty book, and every name an earlier generation used is claimable again. `deployTrinity` has
 * no access control, so an off-chain list only stops a listing on the site, not a launch.
 *
 * `base` goes to every chain: ADEXTO's six live markets (they stay on the 0.11.0 factories, and
 * reserving them here stops a lookalike on v1) and ten major asset names. `perChain` entries
 * are appended on their chain only. On Robinhood Chain that is USDG and the tokenized stocks.
 */
const reservedFile = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "reserved-symbols.json"), "utf8"));
const BASE_RESERVED = reservedFile.base ?? [];
const CHAIN_RESERVED = reservedFile.perChain?.[chainKey]?.symbols ?? [];
const RESERVED_SYMBOLS = [...BASE_RESERVED, ...CHAIN_RESERVED];

// The factory accepts 1 to 12 bytes; anything else could never be launched, so it is a typo.
const malformed = RESERVED_SYMBOLS.filter((s) => typeof s !== "string" || !/^[A-Z0-9]{1,12}$/.test(s));
if (malformed.length > 0) fail(`Malformed reserved tickers (expected A-Z and 0-9, 1 to 12 characters): ${malformed.join(", ")}`);
const duplicates = RESERVED_SYMBOLS.filter((s, i) => RESERVED_SYMBOLS.indexOf(s) !== i);
if (duplicates.length > 0) fail(`Duplicate reserved tickers: ${[...new Set(duplicates)].join(", ")}`);
if (BASE_RESERVED.length === 0) fail("scripts/reserved-symbols.json has an empty base list.");

/**
 * The Foundry suite deploys the factory with `reservedSymbols()` from the fixture. If that list
 * drifts from the one broadcast here, the tests prove protection for a list nobody deployed.
 */
const fixtureSource = fs.readFileSync(path.join(ROOT, "test", "AdextoCurveFixture.sol"), "utf8");
const fixtureBody = fixtureSource.match(/function reservedSymbols\(\)[\s\S]*?\n    \}/)?.[0] ?? "";
const fixtureSize = Number(fixtureBody.match(/new string\[\]\((\d+)\)/)?.[1] ?? -1);
const fixtureList = [...fixtureBody.matchAll(/list\[(\d+)\] = "([^"]*)";/g)]
  .sort((a, b) => Number(a[1]) - Number(b[1]))
  .map((m) => m[2]);
if (fixtureSize !== BASE_RESERVED.length || fixtureList.join(",") !== BASE_RESERVED.join(",")) {
  fail(
    "test/AdextoCurveFixture.sol reservedSymbols() differs from the base list in scripts/reserved-symbols.json.\n" +
      `  fixture: ${fixtureList.join(", ")}\n  base   : ${BASE_RESERVED.join(", ")}`,
  );
}

const coder = ethers.AbiCoder.defaultAbiCoder();
const RESERVED_HASH = ethers.keccak256(coder.encode(["string[]"], [RESERVED_SYMBOLS]));

// ─── 3. The source is committed and public (mainnet broadcasts) ──────────────────────────────

/**
 * A mainnet factory is verified against a public commit, so the commit recorded with it has to
 * contain exactly what was compiled. A dry run only reports; a broadcast refuses.
 */
const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: ROOT, encoding: "utf8" }).trim();
const SOURCE_COMMIT = git("rev-parse", "HEAD");
const sourceProblems = [];
{
  const tracked = [...sourceFiles.filter((f) => !f.startsWith("@")), "scripts/reserved-symbols.json", "test/AdextoCurveFixture.sol"];
  const dirty = git("status", "--porcelain", "--", ...tracked);
  if (dirty) sourceProblems.push(`uncommitted changes in deployed sources or the reserved list:\n${dirty}`);
  try {
    git("merge-base", "--is-ancestor", "HEAD", "origin/main");
  } catch {
    if (!args.includes("--allow-unpushed")) sourceProblems.push(`HEAD ${SOURCE_COMMIT.slice(0, 7)} is not on origin/main`);
  }
}
if (IS_MAINNET && BROADCAST && sourceProblems.length > 0) {
  fail(`Refusing a mainnet broadcast from a source that is not public:\n  - ${sourceProblems.join("\n  - ")}\nCommit and push first.`);
}

// ─── 4. Key, chain and treasury ──────────────────────────────────────────────────────────────

const PK = net.local
  ? process.env.DEVCHAIN_PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  : process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK) fail("Missing OG_PRIVATE_KEY / PRIVATE_KEY in .env.local");

/**
 * Static network, so ethers never re-detects it mid-run on a load-balanced RPC; the explicit
 * eth_chainId check below is what proves the RPC is the intended chain. No batching, because
 * some public RPCs reject or throttle JSON-RPC batches.
 */
const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true, batchMaxCount: 1 });
const wallet = new ethers.Wallet(PK, provider);

// The chain comes first: every read below is only meaningful on the intended chain.
const rpcChainId = Number(await provider.send("eth_chainId", []));
if (rpcChainId !== net.chainId) fail(`RPC chainId mismatch: expected ${net.chainId}, got ${rpcChainId}`);

const treasuryRaw = (argValue("--treasury").startsWith("0x") ? argValue("--treasury") : process.env.PROTOCOL_TREASURY) || "";
if (!treasuryRaw) {
  fail(
    "Missing protocol treasury. Set PROTOCOL_TREASURY in .env.local or pass --treasury 0x…\n" +
      "It is stored immutable in the factory and in every curve it creates.",
  );
}
let PROTOCOL_TREASURY;
try {
  PROTOCOL_TREASURY = ethers.getAddress(treasuryRaw.trim());
} catch {
  fail(`Protocol treasury is not a valid address: ${treasuryRaw}`);
}
if (PROTOCOL_TREASURY === ethers.ZeroAddress) fail("Protocol treasury is the zero address; the constructor would revert.");
/**
 * The deployer is a hot key and already the creator of live markets. As the treasury it would
 * merge protocol revenue with creator revenue on-chain, permanently.
 */
if (PROTOCOL_TREASURY === wallet.address) fail(`Protocol treasury equals the deployer (${wallet.address}). Use a separate address.`);

const deploymentsFile = path.join(ROOT, "build", "deployments.json");
const deployments = fs.existsSync(deploymentsFile) ? JSON.parse(fs.readFileSync(deploymentsFile, "utf8")) : {};
const previous = deployments[chainKey];
// Every generation on a chain has paid the same treasury. A different one is a changed .env.local
// until someone says otherwise.
if (previous?.protocolTreasury && ethers.getAddress(previous.protocolTreasury) !== PROTOCOL_TREASURY && !args.includes("--new-treasury")) {
  fail(
    `Treasury ${PROTOCOL_TREASURY} differs from the one the previous factory on ${chainKey} pays ` +
      `(${previous.protocolTreasury}). Re-run with --new-treasury if that is intended.`,
  );
}

/**
 * A contract treasury is allowed, but not by accident: `claimProtocolFees()` pushes native with a
 * plain call, so a contract that cannot receive it strands every fee. A Safe receives fine.
 */
const treasuryCode = await provider.getCode(PROTOCOL_TREASURY);
const treasuryIsContract = treasuryCode !== "0x";
if (treasuryIsContract && !args.includes("--allow-contract-treasury")) {
  fail(
    `Protocol treasury ${PROTOCOL_TREASURY} is a contract on ${chainKey}. If it cannot receive plain native ` +
      "transfers, every claimProtocolFees() reverts. Confirm it can, then re-run with --allow-contract-treasury.",
  );
}

// ─── 5. The chain runs this bytecode ─────────────────────────────────────────────────────────

/** Linear disassembly that skips PUSH immediates, with the trailing CBOR metadata removed. */
function postLondonOpcodes(hex) {
  const code = hex.replace(/^0x/, "");
  const cborLength = parseInt(code.slice(-4), 16);
  const body = code.slice(0, code.length - 4 - cborLength * 2);
  const found = new Set();
  for (let i = 0; i < body.length / 2; ) {
    const op = parseInt(body.slice(i * 2, i * 2 + 2), 16);
    if (POST_LONDON_OPCODES[op]) found.add(POST_LONDON_OPCODES[op]);
    i += op >= 0x60 && op <= 0x7f ? 1 + (op - 0x5f) : 1;
  }
  return found;
}
const usedOpcodes = new Set();
for (const name of ["AdextoFactory", "AdextoToken", "AdextoCurve"]) {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "artifacts", `${name}.json`), "utf8"));
  for (const op of postLondonOpcodes(a.deployedBytecode)) usedOpcodes.add(op);
}
const unprobed = [...usedOpcodes].filter((op) => !PROBED_OPCODES.has(op));
if (unprobed.length > 0) fail(`The bytecode uses ${unprobed.join(", ")}, which this script does not probe. Extend OPCODE_PROBE first.`);

try {
  const probe = await provider.call({ data: OPCODE_PROBE });
  if (BigInt(probe) !== 0x2an) fail(`Opcode probe returned ${probe}, expected 0x…2a.`);
} catch (e) {
  fail(`${chainKey} did not execute PUSH0/MCOPY (${(e.shortMessage ?? e.message).slice(0, 160)}). Do not deploy cancun bytecode here.`);
}

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const deployTx = await factory.getDeployTransaction(PROTOCOL_TREASURY, RESERVED_SYMBOLS);
const CONSTRUCTOR_ARGS = coder.encode(["address", "string[]"], [PROTOCOL_TREASURY, RESERVED_SYMBOLS]);
if (deployTx.data !== artifact.bytecode + CONSTRUCTOR_ARGS.slice(2)) fail("Deploy data is not bytecode + constructor args.");

/** Runtime code with the immutable ranges zeroed, as solc leaves them in the artifact. */
function masked(hex) {
  const bytes = ethers.getBytes(hex);
  for (const { start, length } of immutableRanges) bytes.fill(0, start, start + length);
  return ethers.hexlify(bytes);
}
/** The value in every immutable range must be the treasury, left-padded to 32 bytes. */
function immutableHoldsTreasury(hex) {
  const bytes = ethers.getBytes(hex);
  const expected = ethers.zeroPadValue(PROTOCOL_TREASURY, 32).toLowerCase();
  return immutableRanges.every(({ start, length }) => ethers.hexlify(bytes.slice(start, start + length)) === expected);
}
function checkRuntime(code, label) {
  if (!code || code === "0x") return `${label}: no runtime code`;
  if (masked(code) !== artifact.deployedBytecode.toLowerCase()) return `${label}: runtime code differs from the artifact`;
  if (!immutableHoldsTreasury(code)) return `${label}: the immutable slot does not hold ${PROTOCOL_TREASURY}`;
  return null;
}

let gasEstimate;
try {
  gasEstimate = await provider.estimateGas({ from: wallet.address, data: deployTx.data });
} catch (e) {
  fail(`estimateGas failed: ${e.shortMessage || e.message}`);
}
const gasLimit = (gasEstimate * (100n + GAS_MARGIN_PCT)) / 100n;

let simulatedRuntime;
try {
  simulatedRuntime = await provider.call({ from: wallet.address, data: deployTx.data, gasLimit });
} catch (e) {
  fail(`Simulating the creation failed: ${(e.shortMessage ?? e.message).slice(0, 160)}`);
}
const simulationProblem = checkRuntime(simulatedRuntime, "simulation");
if (simulationProblem) fail(`${simulationProblem}. Nothing was sent.`);

// ─── 6. The deployer can pay ─────────────────────────────────────────────────────────────────

const balance = await provider.getBalance(wallet.address);
const feeData = await provider.getFeeData();
const nonceLatest = await provider.getTransactionCount(wallet.address, "latest");
// Not every RPC serves the pending tag; without it this check is skipped, not failed.
const noncePending = await provider.getTransactionCount(wallet.address, "pending").catch(() => null);
// A pending transaction from the deployer would take this nonce, or be replaced by it.
if (noncePending !== null && noncePending !== nonceLatest) {
  fail(`The deployer has a pending transaction (nonce ${nonceLatest} latest, ${noncePending} pending). Wait for it.`);
}
const PREDICTED_ADDRESS = ethers.getCreateAddress({ from: wallet.address, nonce: nonceLatest });

const gasPrice = feeData.gasPrice ?? ethers.parseUnits("1", "gwei");
const maxFeePerGas = feeData.maxFeePerGas ?? gasPrice;

let l1Fee = 0n;
if (net.opStack) {
  const unsigned = ethers.Transaction.from({
    type: 2,
    chainId: net.chainId,
    nonce: nonceLatest,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
    to: null,
    value: 0n,
    data: deployTx.data,
  }).unsignedSerialized;
  const oracle = new ethers.Contract(OP_GAS_PRICE_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], provider);
  l1Fee = await oracle.getL1Fee(unsigned);
}
// Monad charges the gas limit, not the gas used.
const expectedCost = (net.chargesGasLimit ? gasLimit : gasEstimate) * gasPrice + l1Fee;
const maxCost = gasLimit * maxFeePerGas + l1Fee;

const label = net.local ? "[local]" : net.testnet ? "[testnet]" : "[MAINNET: real gas]";
const fmt = (wei) => `${ethers.formatEther(wei)} ${net.native}`;
console.log(`network      : ${chainKey} (chainId ${net.chainId})  ${label}`);
console.log(`contract     : ${CONTRACT_NAME} ${EXPECTED_VERSION}, solc ${metadata.compiler.version}, evm ${settings.evmVersion}, via-IR`);
console.log(`source       : ${SOURCE_COMMIT}  (${sourceFiles.length} files match the artifact)`);
console.log(`deployer     : ${wallet.address}  (nonce ${nonceLatest}, factory would be ${PREDICTED_ADDRESS})`);
console.log(`treasury     : ${PROTOCOL_TREASURY}${treasuryIsContract ? "  [contract, allowed by flag]" : "  [EOA]"}`);
console.log(`bytecode     : ${((artifact.bytecode.length - 2) / 2 / 1024).toFixed(2)} KiB init, ${((artifact.deployedBytecode.length - 2) / 2 / 1024).toFixed(2)} KiB runtime`);
console.log(`opcodes      : ${[...usedOpcodes].join(", ")} used; probe executed on ${chainKey}`);
console.log(`simulation   : creation returns the artifact runtime, treasury in the immutable slot`);
/**
 * Printed in full, never as a count. The list is permanent, so every name has to be readable
 * here, while a typo still costs nothing.
 */
console.log(
  `reserved     : ${RESERVED_SYMBOLS.length} tickers (${BASE_RESERVED.length} base` +
    `${CHAIN_RESERVED.length ? ` + ${CHAIN_RESERVED.length} ${chainKey}` : ""}), keccak ${RESERVED_HASH}`,
);
for (let i = 0; i < RESERVED_SYMBOLS.length; i += 16) console.log(`               ${RESERVED_SYMBOLS.slice(i, i + 16).join(" ")}`);
console.log(`gas          : ${gasEstimate} estimated, limit ${gasLimit}`);
console.log(`gas price    : ${ethers.formatUnits(gasPrice, "gwei")} gwei (max fee ${ethers.formatUnits(maxFeePerGas, "gwei")} gwei)`);
if (net.opStack) console.log(`L1 data fee  : ${fmt(l1Fee)}`);
console.log(`cost         : ~${fmt(expectedCost)} expected, ${fmt(maxCost)} at most`);
console.log(`balance      : ${fmt(balance)}`);

if (balance < maxCost) fail(`Insufficient balance: the transaction can cost up to ${fmt(maxCost)}.`);

if (!BROADCAST) {
  if (IS_MAINNET && sourceProblems.length > 0) {
    console.log(`\nA broadcast would refuse until this is fixed:\n  - ${sourceProblems.join("\n  - ")}`);
  }
  console.log(
    `\nDRY RUN: nothing was sent. Re-run with --broadcast to deploy.\n` +
      `If broadcast, ${PROTOCOL_TREASURY} becomes the permanent protocol fee destination on ${chainKey}, ` +
      `and the ${RESERVED_SYMBOLS.length} tickers above can never be launched on this factory.`,
  );
  process.exit(0);
}

// ─── 7. Broadcast, record, read back ─────────────────────────────────────────────────────────

console.log("\nBroadcasting...");
const contract = await factory.deploy(PROTOCOL_TREASURY, RESERVED_SYMBOLS, { gasLimit, nonce: nonceLatest });
const tx = contract.deploymentTransaction();
console.log(`tx: ${tx.hash}`);
/**
 * The receipt is polled rather than awaited with `tx.wait()`. The 0G RPC answers
 * `no matching receipts found` for transactions that are already in a block, and `tx.wait()`
 * turns that into a thrown error, which would report a successful deployment as a failure
 * and skip recording it.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let receipt = null;
for (const started = Date.now(); !receipt && Date.now() - started < 10 * 60_000; ) {
  try {
    receipt = await provider.getTransactionReceipt(tx.hash);
  } catch {
    receipt = null;
  }
  if (!receipt) await sleep(3000);
}
if (!receipt) {
  fail(
    `No receipt for ${tx.hash} after 10 minutes. It may still be mined; if it is, the factory is at ` +
      `${PREDICTED_ADDRESS}. Check the explorer before anything else, and do not deploy again yet.`,
  );
}
if (receipt.status !== 1) fail(`Deployment transaction ${tx.hash} failed (status ${receipt.status}).`);
const address = ethers.getAddress(receipt.contractAddress);
if (address !== PREDICTED_ADDRESS) console.log(`note: deployed at ${address}, not the predicted ${PREDICTED_ADDRESS}`);

console.log(`\n${CONTRACT_NAME} deployed`);
console.log(`  address : ${address}`);
console.log(`  block   : ${receipt.blockNumber}`);
console.log(`  gasUsed : ${receipt.gasUsed}`);
if (net.explorer) console.log(`  explorer: ${net.explorer}/address/${address}`);

/**
 * Recorded as soon as a receipt exists, before any read-back. The 0.12.0 factory on 0G
 * (0x06C80fD2) was deployed correctly and never recorded, because a check crashed first.
 * Earlier factories on the chain stay on record: their markets trade forever, and the subgraph
 * start blocks and source verification still point at them.
 */
const superseded =
  previous?.curveFactory && previous.curveFactory !== address
    ? [
        ...(previous.supersededCurveFactories ?? []),
        {
          contract: previous.contract ?? null,
          version: previous.version ?? null,
          curveFactory: previous.curveFactory,
          txHash: previous.txHash ?? null,
          blockNumber: previous.blockNumber ?? null,
          startBlock: previous.startBlock ?? null,
          deployedAt: previous.deployedAt ?? null,
        },
      ]
    : previous?.supersededCurveFactories ?? [];
function record(checks) {
  deployments[chainKey] = {
    chainId: net.chainId,
    contract: CONTRACT_NAME,
    version: EXPECTED_VERSION,
    curveFactory: address,
    protocolTreasury: PROTOCOL_TREASURY,
    deployer: wallet.address,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    // Subgraphs and indexers start here; guessing lower means scanning millions of empty blocks.
    startBlock: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    deployedAt: new Date().toISOString(),
    sourceCommit: SOURCE_COMMIT,
    compiler: metadata.compiler.version,
    evmVersion: settings.evmVersion,
    reservedCount: RESERVED_SYMBOLS.length,
    reservedHash: RESERVED_HASH,
    // What an explorer's verification form asks for, without the 0x.
    constructorArgs: CONSTRUCTOR_ARGS.slice(2),
    checks,
    ...(superseded.length > 0 ? { supersededCurveFactories: superseded } : {}),
  };
  fs.mkdirSync(path.dirname(deploymentsFile), { recursive: true });
  fs.writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2));
}
record("pending");

/**
 * A read failure is never counted as a pass or a fail. Counting it as a fail would send someone
 * to redeploy a correct factory; ignoring it would pass a broken one. The address is on record
 * either way, so it can be checked against another RPC.
 */
function unverifiable(what, e) {
  record(`unverifiable: ${what}`);
  fail(
    `CANNOT VERIFY ${what}: ${(e?.shortMessage ?? e?.message ?? String(e)).slice(0, 160)}\n` +
      `The factory at ${address} IS deployed and recorded. Check it against another RPC before using it. Do not deploy again yet.`,
  );
}
function mismatch(what) {
  record(`failed: ${what}`);
  fail(`${what.toUpperCase()}. Do NOT put ${address} into NEXT_PUBLIC_CURVE_FACTORY_*. Constructor state cannot be repaired; deploy again.`);
}

// Load-balanced RPCs can answer from a node that has not seen the block yet.
let runtime = "0x";
for (let attempt = 0; attempt < 10 && runtime === "0x"; attempt++) {
  if (attempt > 0) await sleep(1500);
  try {
    runtime = await provider.getCode(address);
  } catch (e) {
    if (attempt === 9) unverifiable("the runtime code", e);
  }
}
const runtimeProblem = checkRuntime(runtime, "on-chain");
if (runtimeProblem) mismatch(runtimeProblem);

const deployed = new ethers.Contract(
  address,
  [
    "function VERSION() view returns (string)",
    "function protocolTreasury() view returns (address)",
    "function PROTOCOL_FEE_BPS() view returns (uint256)",
    "function isSymbolAvailable(string symbol) view returns (bool)",
  ],
  provider,
);
let onChainVersion, onChainTreasury, onChainFeeBps;
try {
  [onChainVersion, onChainTreasury, onChainFeeBps] = await Promise.all([
    deployed.VERSION(),
    deployed.protocolTreasury(),
    deployed.PROTOCOL_FEE_BPS(),
  ]);
} catch (e) {
  unverifiable("VERSION / protocolTreasury / PROTOCOL_FEE_BPS", e);
}
console.log(`  VERSION : ${onChainVersion}`);
console.log(`  treasury: ${onChainTreasury}`);
console.log(`  protocol fee: ${onChainFeeBps} bps (${(Number(onChainFeeBps) / 100).toFixed(2)}%, carved out of swapFeeBps)`);
if (onChainVersion !== EXPECTED_VERSION) mismatch(`version mismatch: chain reports ${onChainVersion}`);
if (ethers.getAddress(onChainTreasury) !== PROTOCOL_TREASURY) mismatch(`treasury mismatch: chain reports ${onChainTreasury}`);

/**
 * Reservations are read back through `isSymbolAvailable`, the function the Studio and
 * /api/deploy actually use. A constructor can succeed while reserving the wrong list (swapped
 * arguments, an empty array), and none of that reverts.
 *
 * Spaced 150 ms apart: back-to-back eth_calls made a public Base RPC fail the third read with
 * `missing revert data`, which cost one factory before the spacing existed.
 */
const stillFree = [];
for (const sym of [...RESERVED_SYMBOLS, CONTROL_SYMBOL]) {
  await sleep(150);
  let available;
  try {
    available = await deployed.isSymbolAvailable(sym);
  } catch (e) {
    unverifiable(`isSymbolAvailable("${sym}")`, e);
  }
  if (sym === CONTROL_SYMBOL) {
    if (!available) mismatch(`control ticker ${CONTROL_SYMBOL} reads as taken, so the reservation read-back proves nothing`);
  } else if (available) {
    stillFree.push(sym);
  }
}
if (stillFree.length > 0) mismatch(`reservation failed: ${stillFree.length} tickers are still claimable: ${stillFree.join(", ")}`);
console.log(`  reserved: ${RESERVED_SYMBOLS.length}/${RESERVED_SYMBOLS.length} tickers confirmed unclaimable, control ticker free`);

record("passed");
console.log(`\nSaved to build/deployments.json (checks: passed)`);

const ENV_KEY = `NEXT_PUBLIC_CURVE_FACTORY_${chainKey.toUpperCase().replace(/-/g, "_")}`;
console.log(`\nNext:`);
console.log(`  1. Verify the source on Sourcify and on ${net.explorer || "the explorer"} (constructor args are in build/deployments.json).`);
console.log(`  2. Set ${ENV_KEY}=${address} in .env.local and pass it as a Docker build arg.`);
console.log(`     Keep NEXT_PUBLIC_CURVE_FACTORY_PREV_* on the 0.11.0 factory: its markets stay live.`);
console.log(`  3. Rebuild, then run audit_consistency.mjs.`);
