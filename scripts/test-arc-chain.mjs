/**
 * Proof that Arc (5042) stays out of every list and every sentence until its factory env is set,
 * and joins all of them once it is. Also checks that "arc" inside ordinary words ("PARCEL",
 * "search") never resolves to Arc.
 *
 * The chain config is read from env at import time, so each mode runs in its own child process
 * with the five production factories set to placeholder addresses.
 *
 * Usage: node --experimental-transform-types --import ./scripts/node-alias-hook.mjs scripts/test-arc-chain.mjs
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const PLACEHOLDER = (n) => "0x" + n.toString(16).padStart(40, "0");
const PRODUCTION_FACTORIES = {
  NEXT_PUBLIC_CURVE_FACTORY_0G: PLACEHOLDER(0x1001),
  NEXT_PUBLIC_CURVE_FACTORY_ARBITRUM: PLACEHOLDER(0x1002),
  NEXT_PUBLIC_CURVE_FACTORY_BASE: PLACEHOLDER(0x1003),
  NEXT_PUBLIC_CURVE_FACTORY_MONAD: PLACEHOLDER(0x1004),
  NEXT_PUBLIC_CURVE_FACTORY_ROBINHOOD: PLACEHOLDER(0x1005),
};
const ARC_FACTORY = "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D";

const mode = process.env.ARC_TEST_MODE;
if (!mode) {
  let failed = 0;
  for (const m of ["hidden", "live"]) {
    console.log(`\n── Arc ${m} ──`);
    const env = { ...process.env, ...PRODUCTION_FACTORIES, ARC_TEST_MODE: m, NEXT_PUBLIC_CURVE_FACTORY_ARC: m === "live" ? ARC_FACTORY : "" };
    delete env.NEXT_PUBLIC_DEVCHAIN_RPC;
    delete env.NEXT_PUBLIC_CHAIN_OVERRIDES;
    const r = spawnSync(process.execPath, [...process.execArgv, SELF], { env, stdio: "inherit" });
    if (r.status !== 0) failed++;
  }
  process.exit(failed ? 1 : 0);
}

const chains = await import("../src/lib/chains.ts");
const { LAUNCH_SENTENCE, LAUNCH_BADGE } = await import("../src/lib/launch-state.ts");
const { ARC_LIVE } = await import("../src/config/arc-disclosure.ts");
const { isHiddenMarket } = await import("../src/config/hidden-markets.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (label, actual, expected) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

const { CHAINS, CHAIN_LIST, LAUNCH_CHAIN_LIST, LAUNCH_CHAIN_COUNT_WORD } = chains;
const live = mode === "live";

// Resolution that must hold in both modes.
eq("chainFromId(5042) is Arc", chains.chainFromId(5042)?.key, "Arc");
eq("resolveChain(5042) is Arc", chains.resolveChain(5042)?.key, "Arc");
eq('resolveChain("Arc (5042)") is Arc', chains.resolveChain("Arc (5042)")?.key, "Arc");
eq('resolveChain("Arc") is Arc', chains.resolveChain("Arc")?.key, "Arc");
eq('resolveChain("arc mainnet") is Arc', chains.resolveChain("arc mainnet")?.key, "Arc");
eq('resolveChain("Parcel Market") is not Arc', chains.resolveChain("Parcel Market")?.key ?? null, null);
eq('resolveChain("PARCEL") is not Arc', chains.resolveChain("PARCEL")?.key ?? null, null);
eq('resolveChain("search") is not Arc', chains.resolveChain("search")?.key ?? null, null);
eq('resolveChain("PARCEL on Monad") is Monad', chains.resolveChain("PARCEL on Monad")?.key, "Monad");
eq('resolveChainSet("PARCEL on Monad") is Monad only', chains.resolveChainSet("PARCEL on Monad").map((c) => c.key), ["Monad"]);
eq("Arc native symbol", CHAINS.Arc.nativeSymbol, "USDC");
eq("Arc input assets", chains.inputAssetsFor(CHAINS.Arc), ["USDC"]);
eq("USDC native logo", chains.nativeAssetLogo("USDC"), "/brand/usdc.svg");
eq("Arc chain mark", chains.chainMark(CHAINS.Arc), "/brand/arc.svg");
eq(
  "Arc NFT URL uses the Blockscout shape",
  chains.explorerNftUrl(CHAINS.Arc, "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", "7"),
  "https://explorer.arc.io/token/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/instance/7"
);
eq("Arc logs read through Pinax", chains.logReadProvider(CHAINS.Arc)._getConnection().url, "https://arc.rpc.pinax.network");
eq("Arc eth_call stays on the official RPC", chains.readProvider(CHAINS.Arc)._getConnection().url, "https://rpc.mainnet.arc.io");
check("5042:ARCTEST is hidden", isHiddenMarket(5042, "arctest"));
check("Monad stays the default chain", chains.DEFAULT_CHAIN.key === "Monad");

if (!live) {
  eq("CHAIN_LIST without Arc", CHAIN_LIST.map((c) => c.key), ["Monad", "Arbitrum", "Robinhood", "Base", "0G"]);
  eq("Arc cannot launch", CHAINS.Arc.dexLive, false);
  eq("five launch chains", LAUNCH_CHAIN_COUNT_WORD, "five");
  eq("name list unchanged", chains.chainNameList(), "Monad, Arbitrum One, Robinhood Chain, Base and 0G");
  eq("short name list unchanged", chains.chainNameList(undefined, "or", { short: true }), "Monad, Arbitrum, Robinhood Chain, Base or 0G");
  eq("MCP chainId text unchanged", chains.chainIdList(), "143 Monad, 42161 Arbitrum One, 4663 Robinhood Chain, 8453 Base, 16661 0G");
  eq("A2A chainId text unchanged", chains.chainIdList(undefined, " | "), "143 Monad | 42161 Arbitrum One | 4663 Robinhood Chain | 8453 Base | 16661 0G");
  eq('resolveChainSet ignores a hidden Arc', chains.resolveChainSet("Omnichain (Monad + Arc)").map((c) => c.key), ["Monad"]);
  check("LAUNCH_SENTENCE says five", LAUNCH_SENTENCE.includes("live on five mainnets"), LAUNCH_SENTENCE);
  eq("LAUNCH_BADGE says 5", LAUNCH_BADGE, "broadcast to 5 mainnets");
  eq("Arc disclosure hidden", ARC_LIVE, false);
} else {
  eq("CHAIN_LIST with Arc before 0G", CHAIN_LIST.map((c) => c.key), ["Monad", "Arbitrum", "Robinhood", "Base", "Arc", "0G"]);
  eq("Arc can launch", CHAINS.Arc.dexLive, true);
  eq("six launch chains", LAUNCH_CHAIN_COUNT_WORD, "six");
  eq("launch list", LAUNCH_CHAIN_LIST.map((c) => c.chainId), [143, 42161, 4663, 8453, 5042, 16661]);
  eq("name list with Arc", chains.chainNameList(), "Monad, Arbitrum One, Robinhood Chain, Base, Arc and 0G");
  eq("MCP chainId text with Arc", chains.chainIdList(), "143 Monad, 42161 Arbitrum One, 4663 Robinhood Chain, 8453 Base, 5042 Arc, 16661 0G");
  eq('resolveChainSet includes a live Arc', chains.resolveChainSet("Omnichain (Monad + Arc)").map((c) => c.key), ["Monad", "Arc"]);
  eq('resolveChainSet still ignores "PARCEL"', chains.resolveChainSet("PARCEL").map((c) => c.key), []);
  check("LAUNCH_SENTENCE says six", LAUNCH_SENTENCE.includes("live on six mainnets"), LAUNCH_SENTENCE);
  eq("LAUNCH_BADGE says 6", LAUNCH_BADGE, "broadcast to 6 mainnets");
  eq("Arc disclosure shown", ARC_LIVE, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
