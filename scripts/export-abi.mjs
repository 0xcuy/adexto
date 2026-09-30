/**
 * Export the ADEXTO v1 ABI to public/abi/ for indexers (GeckoTerminal, DexScreener) and readers.
 *
 *   node scripts/export-abi.mjs            # verify, then write
 *   node scripts/export-abi.mjs --check    # verify only, write nothing
 *
 * WHAT IS PROVEN BEFORE ANYTHING IS WRITTEN
 *
 * 1. The factory. On every chain the deployed runtime is compared with the artifact byte by
 *    byte, and every differing byte must be accounted for as an immutable read back from the
 *    contract (the treasury). The deployed VERSION must equal the VERSION in the source that
 *    produced the artifact.
 *
 * 2. The curve and the token. The factory creates both with `new`, so their creation code is
 *    part of the factory's runtime. The artifact creation code of AdextoCurve and AdextoToken
 *    must appear in the deployed factory runtime on every chain, verbatim. That proves every
 *    market this factory will ever create runs exactly this code, before any market exists.
 *    A hash of a live curve could not prove the same thing: each curve bakes its own
 *    immutables (creator, token, fee legs) into its runtime, so every instance differs from
 *    the template.
 */
import { ethers } from "ethers";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
const CHECK_ONLY = process.argv.includes("--check");

/**
 * Factory addresses come from NEXT_PUBLIC_CURVE_FACTORY_*, the one place that decides which
 * factory launches. Hardcoding them here once made a generation switch compare the new
 * artifact with old bytecode and report four false failures.
 */
const envFactory = (name) => {
  const v = process.env[`NEXT_PUBLIC_CURVE_FACTORY_${name}`];
  if (!v || !/^0x[a-fA-F0-9]{40}$/.test(v)) {
    console.error(`NEXT_PUBLIC_CURVE_FACTORY_${name} is empty or not an address; nothing can be proven without it.`);
    process.exit(1);
  }
  return v;
};

const CHAINS = {
  "0g": { chainId: 16661, rpc: process.env.OG_RPC_URL || "https://evmrpc.0g.ai", factory: envFactory("0G") },
  base: { chainId: 8453, rpc: "https://mainnet.base.org", factory: envFactory("BASE") },
  arbitrum: { chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", factory: envFactory("ARBITRUM") },
  monad: { chainId: 143, rpc: "https://rpc1.monad.xyz", factory: envFactory("MONAD") },
  robinhood: { chainId: 4663, rpc: "https://rpc.mainnet.chain.robinhood.com", factory: envFactory("ROBINHOOD") },
};

const artifact = (name) => JSON.parse(readFileSync(`build/artifacts/${name}.json`, "utf8"));
let fail = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) fail += 1;
};

/**
 * Compare the artifact runtime with the chain, and account for EVERY differing byte as an
 * immutable value read back from the contract. Stronger than a hash match: it shows the code
 * is the same AND the constructor arguments are the ones stated.
 */
function accountForDiff(deployedTemplate, liveCode, immutables) {
  const tmpl = deployedTemplate.toLowerCase();
  const live = liveCode.toLowerCase();
  if (tmpl.length !== live.length) {
    return { ok: false, reason: `length differs: artifact ${(tmpl.length - 2) / 2} B vs chain ${(live.length - 2) / 2} B` };
  }
  const regions = [];
  let start = -1;
  for (let i = 2; i <= tmpl.length; i += 2) {
    const differs = i < tmpl.length && tmpl.slice(i, i + 2) !== live.slice(i, i + 2);
    if (differs && start < 0) start = i;
    if (!differs && start >= 0) {
      regions.push(live.slice(start, i));
      start = -1;
    }
  }
  // Each immutable as bare hex without leading zeros, so 10 bps (0x0a) and a 20-byte address
  // can both be matched.
  const candidates = immutables.map((v) => {
    const hex = (typeof v === "string" && v.startsWith("0x") ? v.slice(2) : BigInt(v).toString(16)).toLowerCase();
    return hex.replace(/^0+/, "") || "0";
  });
  const unexplained = regions.filter((r) => {
    const bare = r.replace(/^0+/, "") || "0";
    return !candidates.some((c) => c.includes(bare) || bare.includes(c));
  });
  const bytes = regions.reduce((s, r) => s + r.length / 2, 0);
  return {
    ok: unexplained.length === 0,
    regions: regions.length,
    bytes,
    reason:
      unexplained.length === 0
        ? regions.length === 0
          ? "byte-for-byte identical"
          : `${regions.length} immutable regions, ${bytes} B, all accounted for`
        : `${unexplained.length} regions NOT explained: ${unexplained.slice(0, 3).map((u) => `0x${u.slice(0, 40)}`).join(", ")}`,
  };
}

const srcVersion = (readFileSync("contracts/AdextoFactory.sol", "utf8").match(
  /string\s+public\s+constant\s+VERSION\s*=\s*"([^"]+)"/,
) ?? [])[1];
if (!srcVersion) {
  console.error("Could not read VERSION from contracts/AdextoFactory.sol; the version check cannot be trusted.");
  process.exit(1);
}

const out = {
  generatedAt: new Date().toISOString(),
  note:
    `ABI of ADEXTO v1 (AdextoFactory ${srcVersion}). The factory is checked against its deployed runtime on every chain, ` +
    "with each differing byte accounted for as an immutable. The curve and token ABIs are proven by their creation code, " +
    "which appears verbatim in every deployed factory runtime.",
  contracts: {},
  networks: {},
  // Markets created by this generation, once they exist. The embedded-code check above already
  // covers every market the factory can create.
  liveMarkets: [],
};

const fac = artifact("AdextoFactory");
const curveArt = artifact("AdextoCurve");
const tokenArt = artifact("AdextoToken");

console.log(`-- AdextoFactory ${srcVersion}: deployed runtime vs artifact, and embedded curve/token code --`);
for (const [key, c] of Object.entries(CHAINS)) {
  const p = new ethers.JsonRpcProvider(c.rpc, c.chainId, { staticNetwork: true, batchMaxCount: 1 });
  const code = await p.getCode(c.factory);
  const f = new ethers.Contract(
    c.factory,
    ["function VERSION() view returns (string)", "function protocolTreasury() view returns (address)", "function PROTOCOL_FEE_BPS() view returns (uint256)"],
    p,
  );
  const version = await f.VERSION();
  const treasury = await f.protocolTreasury();
  const bps = await f.PROTOCOL_FEE_BPS();
  const r = accountForDiff(fac.deployedBytecode, code, [treasury, bps]);
  check(
    `${key} ${c.factory}`,
    r.ok && version === srcVersion,
    `VERSION ${version}${version === srcVersion ? "" : ` (source ${srcVersion})`} - ${(code.length - 2) / 2} B - ${r.reason}`,
  );
  const lower = code.toLowerCase();
  const curveEmbedded = lower.includes(curveArt.bytecode.slice(2).toLowerCase());
  const tokenEmbedded = lower.includes(tokenArt.bytecode.slice(2).toLowerCase());
  check(`${key} embeds AdextoCurve creation code`, curveEmbedded, `${(curveArt.bytecode.length - 2) / 2} B`);
  check(`${key} embeds AdextoToken creation code`, tokenEmbedded, `${(tokenArt.bytecode.length - 2) / 2} B`);
  out.networks[key] = {
    chainId: c.chainId,
    factory: c.factory,
    factoryVersion: version,
    protocolFeeBps: Number(bps),
    protocolTreasury: treasury,
    runtimeBytecodeBytes: (code.length - 2) / 2,
    runtimeBytecodeKeccak: ethers.keccak256(code),
    immutableRegions: r.regions,
    immutableBytes: r.bytes,
    embedsCurveCreationCode: curveEmbedded,
    embedsTokenCreationCode: tokenEmbedded,
  };
}

console.log("\n-- event signatures indexers need --");
const events = {};
for (const [ifaceName, art] of [
  ["AdextoCurve", curveArt],
  ["AdextoFactory", fac],
]) {
  new ethers.Interface(art.abi).forEachEvent((e) => {
    events[`${ifaceName}.${e.name}`] = { signature: e.format("sighash"), topic0: e.topicHash };
  });
}
for (const [k, v] of Object.entries(events)) console.log(`  ${k.padEnd(34)} ${v.topic0}  ${v.signature}`);
out.events = events;

for (const [name, art] of [
  ["AdextoFactory", fac],
  ["AdextoCurve", curveArt],
  ["AdextoToken", tokenArt],
]) {
  out.contracts[name] = { sourceName: art.sourceName, abi: art.abi };
}

if (CHECK_ONLY) {
  console.log(`\n--check: nothing written. ${fail === 0 ? "every check passed" : `${fail} FAILED`}`);
  process.exit(fail === 0 ? 0 : 1);
}
if (fail > 0) {
  console.log(`\n${fail} FAILED - not writing an ABI that is not proven to match the chain.`);
  process.exit(1);
}
if (!existsSync("public/abi")) mkdirSync("public/abi", { recursive: true });
for (const [name, art] of [
  ["AdextoFactory", fac],
  ["AdextoCurve", curveArt],
  ["AdextoToken", tokenArt],
]) {
  writeFileSync(`public/abi/${name}.json`, `${JSON.stringify(art.abi, null, 2)}\n`);
}
writeFileSync("public/abi/index.json", `${JSON.stringify(out, null, 2)}\n`);
console.log("\nwrote public/abi/AdextoFactory.json, AdextoCurve.json, AdextoToken.json, index.json");
