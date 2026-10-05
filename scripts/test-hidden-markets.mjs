/**
 * Proof that a hidden market (src/config/hidden-markets.ts) leaves every public list and nothing else.
 *
 * Registry is written to a temporary ADEXTO_DATA_DIR, so real data is never touched.
 *
 * Usage: node --experimental-transform-types --import ./scripts/node-alias-hook.mjs scripts/test-hidden-markets.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adexto-hidden-markets-"));
process.env.ADEXTO_DATA_DIR = dir;

const registry = await import("../src/lib/registry.ts");
const { isHiddenMarket, HIDDEN_MARKETS } = await import("../src/config/hidden-markets.ts");
const { publicOperatedAgents, OPERATED_AGENTS } = await import("../src/lib/agent-identities.ts");

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

let nonce = 0;
const addr = (p) => "0x" + p.toString(16).padStart(40, "0");
const hash = () => "0x" + (++nonce).toString(16).padStart(64, "0");
const AGENT_A = "0x42478Ed9A429eC320d243469Fa5d6595BCc8daa5";
function launch(symbol, chainId, blockNumber) {
  return registry.registerProject({
    tokenAddress: addr(0xa0000 + ++nonce),
    poolAddress: addr(0xb0000 + nonce),
    creator: AGENT_A,
    name: symbol,
    symbol,
    chainId,
    priceNative: 1e-9,
    supply: 1_000_000_000,
    lpFeeBps: 20,
    treasuryBuybackBps: 10,
    txHash: hash(),
    blockNumber,
    poolLive: true,
  });
}

try {
  check("ARBTTEST on Arbitrum is in the hidden set", HIDDEN_MARKETS.has("42161:ARBTTEST"));
  check("isHiddenMarket is case-insensitive", isHiddenMarket(42161, "arbttest"));
  check("same ticker on another chain is not hidden", !isHiddenMarket(143, "ARBTTEST"));

  launch("LOOP", 42161, 100);
  launch("SAI", 42161, 200);
  const hidden = launch("ARBTTEST", 42161, 999); // newest on its chain

  const all = registry.listProjects();
  const pub = registry.listPublicProjects();
  check("listProjects keeps the hidden market", all.some((p) => p.symbol === "ARBTTEST"));
  check("listPublicProjects drops it", !pub.some((p) => p.symbol === "ARBTTEST"));
  check("listPublicProjects keeps every other market", pub.length === all.length - 1, `${pub.length} vs ${all.length}`);
  check(
    "findProject by ticker + chain still resolves it (token page, /api/pool, x402 buy)",
    registry.findProject("arbttest", 42161)?.tokenAddress === hidden.tokenAddress
  );
  check("findProject by token address still resolves it", registry.findProject(hidden.tokenAddress)?.symbol === "ARBTTEST");
  const avail = registry.checkSymbolAvailable("ARBTTEST", 42161, AGENT_A);
  check("its ticker is still taken on that chain", avail.available === false);
  check(
    "exampleMarkets never picks it, although it is the newest on Arbitrum",
    !registry.exampleMarkets().some((p) => p.symbol === "ARBTTEST")
  );
  check("publicCustomProjectCount excludes it", registry.publicCustomProjectCount() === registry.customProjectCount() - 1);

  const pubAgents = publicOperatedAgents();
  check(
    "no public operated agent is bound to a hidden market",
    pubAgents.every((a) => !a.market || !isHiddenMarket(a.chainId, a.market.symbol))
  );
  const hiddenAgents = OPERATED_AGENTS.filter((a) => a.market && isHiddenMarket(a.chainId, a.market.symbol));
  check("publicOperatedAgents drops exactly the hidden ones", pubAgents.length === OPERATED_AGENTS.length - hiddenAgents.length);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
