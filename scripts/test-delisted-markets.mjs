/**
 * Proof that a delisted market (src/config/delisted-markets.ts) stops being served everywhere a single
 * market is looked up, keeps its ticker taken, and gets a removal notice instead of a plain 404.
 * Uses the ADEXTO_DELISTED_MARKETS override on a temporary ADEXTO_DATA_DIR, so real data is never touched.
 *
 * Usage: node --experimental-transform-types --import ./scripts/node-alias-hook.mjs scripts/test-delisted-markets.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adexto-delisted-markets-"));
process.env.ADEXTO_DATA_DIR = dir;

const registry = await import("../src/lib/registry.ts");
const { isDelistedMarket, delistedEntry } = await import("../src/config/delisted-markets.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

let nonce = 0;
const addr = (p) => "0x" + p.toString(16).padStart(40, "0");
const hash = () => "0x" + (++nonce).toString(16).padStart(64, "0");
const CREATOR = "0x3333333333333333333333333333333333333333";
const OTHER = "0x4444444444444444444444444444444444444444";
function launch(symbol, chainId, creator = CREATOR) {
  return registry.registerProject({
    tokenAddress: addr(0xa0000 + ++nonce),
    poolAddress: addr(0xb0000 + nonce),
    creator,
    name: symbol,
    symbol,
    chainId,
    priceNative: 1e-9,
    supply: 1_000_000_000,
    lpFeeBps: 20,
    treasuryBuybackBps: 10,
    txHash: hash(),
    blockNumber: nonce,
    poolLive: true,
  });
}

try {
  launch("GOOD", 143);
  const bad = launch("SCAMX", 143);

  check("not delisted before the override", !isDelistedMarket(143, "SCAMX"));
  process.env.ADEXTO_DELISTED_MARKETS = "143:scamx";
  check("override delists it, case-insensitive", isDelistedMarket(143, "SCAMX") && delistedEntry(143, "scamx") !== null);
  check("the same ticker on another chain is not delisted", !isDelistedMarket(42161, "SCAMX"));

  check("listProjects keeps the row (the ticker stays recorded)", registry.listProjects().some((p) => p.symbol === "SCAMX"));
  check("listServedProjects drops it", !registry.listServedProjects().some((p) => p.symbol === "SCAMX"));
  check("listPublicProjects drops it", !registry.listPublicProjects().some((p) => p.symbol === "SCAMX"));
  check("findProject by ticker + chain no longer resolves it (/api/pool, x402, MCP, A2A)", registry.findProject("scamx", 143) === null);
  check("findProject by token address no longer resolves it", registry.findProject(bad.tokenAddress) === null);
  check("findProjectGroup no longer includes it", registry.findProjectGroup("scamx").length === 0);
  const notice = registry.findDelisted("scamx", 143);
  check("findDelisted returns the record and a reason for the page", notice?.project.tokenAddress === bad.tokenAddress && Boolean(notice?.reason));
  check("findDelisted by address works too", registry.findDelisted(bad.tokenAddress)?.project.symbol === "SCAMX");
  check("findDelisted is null for a served market", registry.findDelisted("good", 143) === null);
  check("its ticker stays taken on that chain", registry.checkSymbolAvailable("SCAMX", 143, OTHER).available === false);
  check("another creator cannot take it on another chain either", registry.checkSymbolAvailable("SCAMX", 42161, OTHER).available === false);
  let refused = false;
  try {
    registry.updateProjectMeta(143, "SCAMX", { description: "new pitch" });
  } catch {
    refused = true;
  }
  check("its metadata can no longer be edited", refused);
  check("the other market is untouched", registry.findProject("good", 143)?.symbol === "GOOD");
} finally {
  delete process.env.ADEXTO_DELISTED_MARKETS;
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
