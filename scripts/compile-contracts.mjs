/**
 * Standalone solc compiler for the ADEXTO contracts.
 *
 * Hardhat 3 in this repo requires an ESM package ("type": "module"), which would break the
 * Next.js build, so contracts are compiled directly with solc-js and the artifacts are
 * written to build/artifacts/<Name>.json.
 *
 * Usage: node scripts/compile-contracts.mjs [--via-ir]
 *
 * TWO COMPILERS, CHOSEN BY EACH FILE'S PRAGMA
 *
 * Generation 0.13.0 (AdextoFactory, AdextoCurve, AdextoToken) is compiled with solc 0.8.37,
 * which has no known bugs in the Solidity bug list at the time of writing.
 * `AdextoAgentStake` is already live on 0G and was compiled with 0.8.26. Recompiling it with
 * another compiler would produce bytecode that no longer matches the deployed contract, so a
 * file that pins `pragma solidity 0.8.26;` is compiled with the `solc-0.8.26` package and
 * everything else with `solc`. The two groups share no imports, so they compile as separate
 * units.
 *
 * `evmVersion` is pinned to "cancun" for both. It was the implicit default of 0.8.26, and
 * newer compilers default to later EVM versions that not every target chain supports.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const COMPILERS = {
  "0.8.37": require("solc"),
  "0.8.26": require("solc-0.8.26"),
};

const ROOT = process.cwd();
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const OUT_DIR = path.join(ROOT, "build", "artifacts");
const VIA_IR = process.argv.includes("--via-ir");
const EVM_VERSION = "cancun";

for (const [want, compiler] of Object.entries(COMPILERS)) {
  if (!compiler.version().startsWith(`${want}+`)) {
    console.error(`expected solc ${want}, found ${compiler.version()}. Run npm install.`);
    process.exit(1);
  }
}

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

/**
 * contracts/test/ holds fixtures, and it is compiled because one of them has to exist as
 * real bytecode: the ERC-8004 registry is deployed on mainnets only, and
 * `AdextoFactory.AGENT_REGISTRY` is a constant, so the agent-binding path is unreachable on
 * testnets. A local devchain gets the mock's runtime code injected at that address instead.
 *
 * Only these two directories are walked, so adding a file elsewhere (the Echidna harnesses,
 * the Foundry tests) can never change which production contracts get compiled.
 */
const files = [];
for (const dir of ["", "test"]) {
  const abs = path.join(CONTRACTS_DIR, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of fs.readdirSync(abs).filter((f) => f.endsWith(".sol"))) {
    files.push(dir ? `contracts/${dir}/${file}` : `contracts/${file}`);
  }
}

const groups = { "0.8.37": {}, "0.8.26": {} };
for (const rel of files) {
  const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const pinnedLegacy = /^\s*pragma\s+solidity\s+0\.8\.26\s*;/m.test(content);
  groups[pinnedLegacy ? "0.8.26" : "0.8.37"][rel] = { content };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let count = 0;
for (const [version, sources] of Object.entries(groups)) {
  if (Object.keys(sources).length === 0) continue;
  const solc = COMPILERS[version];
  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: EVM_VERSION,
      ...(VIA_IR ? { viaIR: true } : {}),
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] },
      },
    },
  };

  console.log(
    `Compiling ${Object.keys(sources).length} sources with solc ${solc.version()}${VIA_IR ? " (viaIR)" : ""}, evm ${EVM_VERSION}...`,
  );
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

  for (const [file, contracts] of Object.entries(output.contracts || {})) {
    for (const [name, artifact] of Object.entries(contracts)) {
      const bytecode = artifact.evm?.bytecode?.object || "";
      fs.writeFileSync(
        path.join(OUT_DIR, `${name}.json`),
        JSON.stringify(
          {
            contractName: name,
            sourceName: file,
            compiler: solc.version(),
            abi: artifact.abi,
            bytecode: bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`,
            deployedBytecode: artifact.evm?.deployedBytecode?.object
              ? `0x${artifact.evm.deployedBytecode.object}`
              : "0x",
          },
          null,
          2,
        ),
      );
      if (bytecode) {
        console.log(`  ok  ${name.padEnd(26)} ${(bytecode.length / 2 / 1024).toFixed(2)} KiB`);
      }
      count += 1;
    }
  }
}
console.log(`\nWrote ${count} artifacts to build/artifacts/`);
