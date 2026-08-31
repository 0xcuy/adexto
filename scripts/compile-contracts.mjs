/**
 * Standalone solc compiler for the ADEXTO contracts.
 *
 * Hardhat 3 in this repo requires an ESM package ("type": "module"), which would
 * break the Next.js build, so contracts are compiled directly with solc-js and
 * the artifacts are written to build/artifacts/<Name>.json.
 *
 * Usage: node scripts/compile-contracts.mjs [--via-ir]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const solc = require("solc");

const ROOT = process.cwd();
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const OUT_DIR = path.join(ROOT, "build", "artifacts");
const VIA_IR = process.argv.includes("--via-ir");

function resolveImport(importPath) {
  const candidates = [
    path.join(ROOT, "node_modules", importPath),
    path.join(CONTRACTS_DIR, importPath),
    path.join(ROOT, importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }
  return { error: `File not found: ${importPath}` };
}

const sources = {};
for (const file of fs.readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith(".sol"))) {
  sources[`contracts/${file}`] = { content: fs.readFileSync(path.join(CONTRACTS_DIR, file), "utf8") };
}

/**
 * contracts/test/ holds fixtures, and it is compiled because one of them has to
 * exist as real bytecode: the ERC-8004 registry is deployed on mainnets only, and
 * `AdextoCurveFactory.AGENT_REGISTRY` is a constant, so the agent-binding path is
 * unreachable on every testnet. A local devchain gets the mock's runtime code
 * injected at that constant address instead.
 *
 * Only this directory is walked, not the whole tree, so adding a fixture can never
 * quietly change which production contracts get compiled. Nothing here is
 * deployable by the deploy scripts either — those name their artifact explicitly.
 */
const TEST_DIR = path.join(CONTRACTS_DIR, "test");
if (fs.existsSync(TEST_DIR)) {
  for (const file of fs.readdirSync(TEST_DIR).filter((f) => f.endsWith(".sol"))) {
    sources[`contracts/test/${file}`] = { content: fs.readFileSync(path.join(TEST_DIR, file), "utf8") };
  }
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    ...(VIA_IR ? { viaIR: true } : {}),
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] },
    },
  },
};

console.log(`Compiling ${Object.keys(sources).length} sources with solc ${solc.version()}${VIA_IR ? " (viaIR)" : ""}...`);
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));

const errors = (output.errors || []).filter((e) => e.severity === "error");
const warnings = (output.errors || []).filter((e) => e.severity === "warning");

for (const w of warnings) {
  const msg = w.formattedMessage || w.message;
  if (/Unused|shadow|visibility|SPDX/i.test(msg)) continue;
  console.log(`  warn: ${msg.split("\n")[0]}`);
}

if (errors.length > 0) {
  console.error(`\n${errors.length} compile error(s):`);
  for (const e of errors) console.error(e.formattedMessage || e.message);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let count = 0;
for (const [file, contracts] of Object.entries(output.contracts || {})) {
  for (const [name, artifact] of Object.entries(contracts)) {
    const bytecode = artifact.evm?.bytecode?.object || "";
    fs.writeFileSync(
      path.join(OUT_DIR, `${name}.json`),
      JSON.stringify(
        {
          contractName: name,
          sourceName: file,
          abi: artifact.abi,
          bytecode: bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`,
          deployedBytecode: artifact.evm?.deployedBytecode?.object
            ? `0x${artifact.evm.deployedBytecode.object}`
            : "0x",
        },
        null,
        2
      )
    );
    if (bytecode) {
      console.log(`  ok  ${name.padEnd(26)} ${(bytecode.length / 2 / 1024).toFixed(2)} KiB`);
    }
    count += 1;
  }
}
console.log(`\nWrote ${count} artifacts to build/artifacts/`);
