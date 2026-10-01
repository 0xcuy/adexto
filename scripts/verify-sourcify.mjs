/**
 * Submit a deployed contract to Sourcify and wait for the verdict.
 *
 *   node scripts/verify-sourcify.mjs --chain-id 143 --address 0x… --contract AdextoStakeHub [--tx 0x…]
 *
 * Uses the artifact's own solc metadata and the source files it names, read from disk, so what is
 * verified is exactly what was compiled (scripts/compile-contracts.mjs --via-ir). Sourcify rebuilds
 * the bytecode and compares it with the chain; "exact_match" means the metadata hash matched too.
 * Passing the creation transaction lets Sourcify check the creation code as well as the runtime.
 *
 * Sends only public data: the source files and their compiler metadata.
 */
import fs from "node:fs";
import path from "node:path";

const API = "https://sourcify.dev/server";
const args = process.argv.slice(2);
const arg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] ?? "" : "";
};
const chainId = arg("--chain-id");
const address = arg("--address");
const contract = arg("--contract");
const tx = arg("--tx");
if (!/^\d+$/.test(chainId) || !/^0x[0-9a-fA-F]{40}$/.test(address) || !contract) {
  console.error("Usage: node scripts/verify-sourcify.mjs --chain-id <id> --address <0x…> --contract <Name> [--tx <0x…>]");
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(path.join("build", "artifacts", `${contract}.json`), "utf8"));
const metadata = JSON.parse(artifact.metadata);
const sources = {};
for (const name of Object.keys(metadata.sources)) {
  const file = name.startsWith("@") ? path.join("node_modules", name) : name;
  sources[name] = fs.readFileSync(file, "utf8");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const current = async () => {
  const r = await fetch(`${API}/v2/contract/${chainId}/${address}`);
  return r.ok ? r.json() : null;
};

const before = await current();
if (before?.match === "exact_match") {
  console.log(`already verified: ${before.match} (creation ${before.creationMatch}, runtime ${before.runtimeMatch})`);
  process.exit(0);
}

const res = await fetch(`${API}/v2/verify/metadata/${chainId}/${address}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sources, metadata, ...(tx ? { creationTransactionHash: tx } : {}) }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.verificationId) {
  console.error(`Sourcify refused the submission (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  process.exit(1);
}
console.log(`submitted: verification ${body.verificationId}`);

for (let i = 0; i < 60; i++) {
  await sleep(3000);
  const job = await (await fetch(`${API}/v2/verify/${body.verificationId}`)).json().catch(() => null);
  if (job?.isJobCompleted) {
    if (job.error) {
      console.error(`verification failed: ${JSON.stringify(job.error).slice(0, 400)}`);
      process.exit(1);
    }
    break;
  }
}
const after = await current();
console.log(`result: ${after?.match ?? "unknown"} (creation ${after?.creationMatch ?? "?"}, runtime ${after?.runtimeMatch ?? "?"})`);
console.log(`https://repo.sourcify.dev/${chainId}/${address}`);
process.exit(after?.match === "exact_match" ? 0 : 1);
