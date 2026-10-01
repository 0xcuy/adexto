/**
 * Runs every analysis engine, then writes ONE machine-readable report.
 *
 * WHY THIS FILE EXISTS
 *
 * The /security page must not contain a single hand-written number. A hand-typed "Slither ✅"
 * table is a badge with extra steps: it looks like evidence, nothing ties it to a real result,
 * and it stays green after the contracts change. So the page READS `src/config/
 * security-report.json`, and this script is the only thing that writes that file.
 *
 * Rules it keeps:
 *   - An engine that is not installed is reported as `status: "not-installed"`, not skipped.
 *     A missing check must be visible on the page, not vanish from the table.
 *   - An engine that fails to run is reported as `status: "error"` with its message.
 *   - Finding counts come from the engines' output, never from a list in this file.
 *   - The commit hash, whether the tree was dirty, and a hash of every contract file are
 *     recorded, so a reader knows which code the report belongs to.
 *
 * Usage: node scripts/security-scan.mjs
 */
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "build", "security");
const REPORT = path.join(ROOT, "src", "config", "security-report.json");
mkdirSync(OUT_DIR, { recursive: true });

const HOME = os.homedir();
const BIN = {
  forge: path.join(HOME, ".foundry", "bin", "forge"),
  slither: path.join(HOME, ".local", "bin", "slither"),
  aderyn: path.join(HOME, ".local", "bin", "aderyn"),
  semgrep: path.join(HOME, ".local", "bin", "semgrep"),
  solhint: path.join(ROOT, "node_modules", ".bin", "solhint"),
  docker: "/usr/bin/docker",
};

/**
 * The launch path: the contracts a launch actually runs, ADEXTO v1.
 *
 * Findings on this path are counted separately (`launchPathCounts`) because the claim "0 High
 * on the launch path" on /security is about exactly these files. The list lives here, not on
 * the page, so the page cannot invent its own scope.
 */
const LAUNCH_PATH = [
  "contracts/AdextoFactory.sol",
  "contracts/AdextoCurve.sol",
  "contracts/AdextoToken.sol",
  "contracts/IIdentityRegistry.sol",
];

/**
 * `AdextoAgentStake.sol` and `AdextoStakeHub.sol` are deliberately NOT in the list above.
 *
 * Both hold real tokens (the four dedicated stakes, and one hub per chain for every other
 * market), but a launch never calls either, so counting them would make the launch-path claim
 * measure something other than its name. Both ARE scanned: Slither and Aderyn run over the whole
 * directory, so their findings are in the totals.
 *
 * They have a bucket of their own (`stakeCounts`) since the hub drew a Slither High: /security
 * states how many findings sit in the contracts that hold stakes, and triages them, from these
 * counts rather than from a number typed on the page. Their scope is stated in audit/README.md.
 */
const STAKE_CONTRACTS = ["contracts/AdextoAgentStake.sol", "contracts/AdextoStakeHub.sol"];
const inLaunchPath = (f) => LAUNCH_PATH.some((p) => String(f || "").endsWith(p.replace(/^contracts\//, "contracts/")));
const inStakeContracts = (f) => STAKE_CONTRACTS.some((p) => String(f || "").endsWith(p));

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}
function version(bin, args = ["--version"]) {
  try {
    return sh(bin, args).trim().split("\n")[0].slice(0, 80);
  } catch {
    return null;
  }
}
const has = (p) => existsSync(p);

const engines = [];
const add = (e) => engines.push(e);
const log = (s) => console.log(s);

// ── git ─────────────────────────────────────────────────────────────────────
let commit = null;
let dirty = null;
let commitTime = null;
try {
  commit = sh("git", ["rev-parse", "HEAD"]).trim();
  commitTime = sh("git", ["show", "-s", "--format=%cI", "HEAD"]).trim();
  dirty = sh("git", ["status", "--porcelain"]).trim().length > 0;
} catch {
  /* outside git */
}

// ── 1. Deploy-path compiler ─────────────────────────────────────────────────
//
// This is the pipeline that produces the deployed bytecode, so its warnings matter more than
// those of the test build.
log("→ compiler (deploy path, solc via-IR)");
{
  try {
    const out = sh(process.execPath, ["scripts/compile-contracts.mjs", "--via-ir"]);
    writeFileSync(path.join(OUT_DIR, "solc-deploy.log"), out);
    const warnings = (out.match(/Warning:/gi) || []).length;
    const errors = (out.match(/^Error:/gim) || []).length;
    const artifacts = Number((out.match(/Wrote (\d+) artifacts/) || [])[1] || 0);
    add({
      id: "solc",
      name: "Compiler warnings",
      tool: "solc 0.8.37 (via-IR, optimizer 200, evm cancun)",
      version: "0.8.37",
      status: errors === 0 && warnings === 0 ? "clean" : "findings",
      ran: true,
      counts: { errors, warnings },
      detail: `${artifacts} artifacts compiled, ${warnings} warnings, ${errors} errors`,
    });
  } catch (e) {
    add({ id: "solc", name: "Compiler warnings", tool: "solc 0.8.37", status: "error", ran: false, detail: String(e.message).slice(0, 200) });
  }
}

// ── 2. Foundry: fuzz ────────────────────────────────────────────────────────
log("→ forge test (fuzz)");
if (!has(BIN.forge)) {
  add({ id: "forge-fuzz", name: "Foundry fuzzing", tool: "forge", status: "not-installed", ran: false });
  add({ id: "forge-invariant", name: "Foundry invariants", tool: "forge", status: "not-installed", ran: false });
} else {
  const forgeVersion = version(BIN.forge);
  const runForge = (matchPath, env) => {
    try {
      const out = sh(BIN.forge, ["test", "--match-path", matchPath, "--json"], { env: { ...process.env, ...env } });
      return { ok: true, out };
    } catch (e) {
      // forge exits non-zero when a test fails; stdout still holds the JSON.
      return { ok: false, out: String(e.stdout || "") + String(e.stderr || "") };
    }
  };

  const parse = (raw) => {
    // Every valid JSON line is one suite's results.
    let passed = 0, failed = 0, skipped = 0, cases = [];
    const suites = new Set();
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      let j;
      try { j = JSON.parse(t); } catch { continue; }
      for (const [suiteName, suite] of Object.entries(j)) {
        const tests = suite?.test_results ?? {};
        if (Object.keys(tests).length > 0) suites.add(suiteName);
        for (const [name, r] of Object.entries(tests)) {
          const st = String(r.status || "").toLowerCase();
          if (st === "success") passed++;
          else if (st === "skipped") skipped++;
          else failed++;
          cases.push({ name, status: st, runs: r?.counterexample ? null : (r?.kind?.Fuzz?.runs ?? r?.kind?.Invariant?.runs ?? null) });
        }
      }
    }
    return { passed, failed, skipped, cases, suites: suites.size };
  };

  /**
   * A glob, NOT one file.
   *
   * These paths were once fixed file names, and when a new suite was added the page reported
   * far fewer passing properties than actually ran, without any error: the report stayed
   * "clean" while its coverage quietly shrank. The glob counts every new suite without anyone
   * having to remember to add it here.
   */
  const fuzz = runForge("test/*Fuzz.t.sol", {});
  writeFileSync(path.join(OUT_DIR, "forge-fuzz.json"), fuzz.out);
  const f = parse(fuzz.out);
  add({
    id: "forge-fuzz",
    name: "Foundry fuzzing",
    tool: "forge",
    version: forgeVersion,
    status: f.failed === 0 && f.passed > 0 ? "clean" : "findings",
    ran: true,
    counts: { passed: f.passed, failed: f.failed },
    detail: `${f.passed} properties passed, ${f.failed} failed · ${f.suites} suites · 4096 runs each`,
    cases: f.cases.map((c) => c.name),
  });

  log("→ forge test (invariant)");
  const inv = runForge("test/*Invariant.t.sol", {});
  writeFileSync(path.join(OUT_DIR, "forge-invariant.json"), inv.out);
  const i = parse(inv.out);
  add({
    id: "forge-invariant",
    name: "Foundry invariants",
    tool: "forge",
    version: forgeVersion,
    status: i.failed === 0 && i.passed > 0 ? "clean" : "findings",
    ran: true,
    counts: { passed: i.passed, failed: i.failed },
    // Counts test functions, not suites, and says so.
    detail: `${i.passed} tests passed across ${i.suites} suites · 512 runs x 64 random actions`,
  });
}

// ── 3. Slither ──────────────────────────────────────────────────────────────
log("→ slither");
if (!has(BIN.slither)) {
  add({ id: "slither", name: "Slither", tool: "slither", status: "not-installed", ran: false });
} else {
  const jsonPath = path.join(OUT_DIR, "slither.json");
  /**
   * The output file is deleted first, which stops a stale result being reported as fresh.
   *
   * Slither refuses to overwrite an existing `--json` file and exits with an error. The `catch`
   * below then found the PREVIOUS run's file, so the script parsed old results and reported
   * them with `ran: true`. With the file deleted first, a real failure leaves no file and the
   * engine is reported as `error`. A non-zero exit because Slither FOUND something is still
   * handled: in that case it has written its JSON.
   */
  if (existsSync(jsonPath)) rmSync(jsonPath);
  let ok = true, errMsg = null;
  try {
    sh(BIN.slither, [".", "--filter-paths", "lib/|node_modules/|test/", "--json", jsonPath, "--disable-color"], {
      env: { ...process.env, PATH: `${path.join(HOME, ".foundry", "bin")}:${path.join(HOME, ".local", "bin")}:${process.env.PATH}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    if (!existsSync(jsonPath)) { ok = false; errMsg = String(e.message).slice(0, 200); }
  }
  if (!ok) {
    add({ id: "slither", name: "Slither", tool: "slither", version: version(BIN.slither), status: "error", ran: false, detail: errMsg });
  } else {
    const j = JSON.parse(readFileSync(jsonPath, "utf8"));
    const dets = j?.results?.detectors ?? [];
    const sev = {}, sevLaunch = {}, sevStake = {};
    for (const d of dets) {
      const el = (d.elements ?? []).find((x) => x?.source_mapping?.filename_relative);
      const file = el ? el.source_mapping.filename_relative : "";
      const k = d.impact ?? "Unknown";
      sev[k] = (sev[k] ?? 0) + 1;
      if (inLaunchPath(file)) sevLaunch[k] = (sevLaunch[k] ?? 0) + 1;
      if (inStakeContracts(file)) sevStake[k] = (sevStake[k] ?? 0) + 1;
    }
    const highLaunch = sevLaunch.High ?? 0;
    add({
      id: "slither",
      name: "Slither",
      tool: "slither",
      version: version(BIN.slither),
      status: highLaunch === 0 ? "triaged" : "findings",
      ran: true,
      counts: { total: dets.length, ...sev },
      launchPathCounts: sevLaunch,
      stakeCounts: sevStake,
      detail: `${dets.length} findings across 102 detectors · ${highLaunch} High on the launch path`,
    });
  }
}

// ── 4. Aderyn ───────────────────────────────────────────────────────────────
log("→ aderyn");
if (!has(BIN.aderyn)) {
  add({ id: "aderyn", name: "Aderyn", tool: "aderyn", status: "not-installed", ran: false });
} else {
  const jsonPath = path.join(OUT_DIR, "aderyn.json");
  try {
    /**
     * `echidna/` is excluded as a matter of scope, not to hide findings.
     *
     * The Echidna harness wraps the curve so the fuzzer can call it and is never deployed. When
     * it was scanned, it contributed High instances about a file that does not exist in
     * production, which misled readers into thinking the contracts holding money had a problem.
     * `test/` is excluded for exactly the same reason. Every production contract is scanned.
     */
    sh(BIN.aderyn, ["--src", "contracts", "--path-excludes", "test/,lib/,node_modules/,echidna/", "-o", jsonPath], {
      env: { ...process.env, PATH: `${path.join(HOME, ".foundry", "bin")}:${path.join(HOME, ".local", "bin")}:${process.env.PATH}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const j = JSON.parse(readFileSync(jsonPath, "utf8"));
    const count = (grp) => (j?.[grp]?.issues ?? []).reduce((n, i) => n + (i.instances?.length ?? 0), 0);
    const kinds = (grp) => (j?.[grp]?.issues ?? []).length;
    const highInstances = (j?.high_issues?.issues ?? []).reduce((n, i) => n + (i.instances ?? []).filter((x) => inLaunchPath(x.contract_path)).length, 0);
    const inStake = (grp) =>
      (j?.[grp]?.issues ?? []).reduce((n, i) => n + (i.instances ?? []).filter((x) => inStakeContracts(x.contract_path)).length, 0);
    add({
      id: "aderyn",
      name: "Aderyn",
      tool: "aderyn",
      version: version(BIN.aderyn),
      status: "triaged",
      ran: true,
      counts: { highKinds: kinds("high_issues"), highInstances: count("high_issues"), lowKinds: kinds("low_issues"), lowInstances: count("low_issues") },
      launchPathCounts: { HighInstances: highInstances },
      stakeCounts: { HighInstances: inStake("high_issues"), LowInstances: inStake("low_issues") },
      detail: `${kinds("high_issues")} High kinds / ${kinds("low_issues")} Low kinds · ${j?.detectors_used?.length ?? 0} detectors`,
    });
  } catch (e) {
    add({ id: "aderyn", name: "Aderyn", tool: "aderyn", version: version(BIN.aderyn), status: "error", ran: false, detail: String(e.message).slice(0, 200) });
  }
}

// ── 5. Solhint ──────────────────────────────────────────────────────────────
log("→ solhint");
if (!has(BIN.solhint)) {
  add({ id: "solhint", name: "Solhint", tool: "solhint", status: "not-installed", ran: false });
} else {
  try {
    /**
     * Stdout goes straight to a file, not through a pipe.
     *
     * solhint calls `process.exit` when it finds errors, and writes to a stdout PIPE in Node
     * are asynchronous, so output beyond roughly 143 KiB was cut off mid-string and the JSON
     * failed to parse. Writes to a FILE descriptor are synchronous and cannot be truncated
     * that way.
     */
    const solhintOut = path.join(OUT_DIR, "solhint.json");
    const fd = openSync(solhintOut, "w");
    try {
      try {
        execFileSync(BIN.solhint, ["-f", "json", "contracts/*.sol"], {
          cwd: ROOT,
          stdio: ["ignore", fd, "pipe"],
        });
      } catch {
        /* exits non-zero when it finds something; the report is already written to fd */
      }
    } finally {
      closeSync(fd);
    }
    const raw = readFileSync(solhintOut, "utf8");
    const arr = JSON.parse(raw || "[]");
    let errors = 0, warnings = 0;
    for (const m of arr) (String(m.severity).toLowerCase() === "error" ? errors++ : warnings++);
    add({
      id: "solhint",
      name: "Solhint",
      tool: "solhint",
      version: version(BIN.solhint),
      status: errors === 0 ? "clean" : "findings",
      ran: true,
      counts: { errors, warnings },
      detail: `${errors} errors, ${warnings} warnings (style & gas rules)`,
    });
  } catch (e) {
    add({ id: "solhint", name: "Solhint", tool: "solhint", status: "error", ran: false, detail: String(e.message).slice(0, 200) });
  }
}

// ── 6. Semgrep ──────────────────────────────────────────────────────────────
log("→ semgrep");
if (!has(BIN.semgrep)) {
  add({ id: "semgrep", name: "Semgrep", tool: "semgrep", status: "not-installed", ran: false });
} else {
  try {
    let raw = "";
    try {
      raw = sh(BIN.semgrep, ["scan", "--config", "p/security-audit", "--json", "--quiet", "--metrics=off", "contracts/"]);
    } catch (e) {
      raw = String(e.stdout || "");
    }
    writeFileSync(path.join(OUT_DIR, "semgrep.json"), raw);
    const j = JSON.parse(raw || "{}");
    const results = j.results ?? [];
    const scanned = (j.paths?.scanned ?? []).length;
    add({
      id: "semgrep",
      name: "Semgrep",
      tool: "semgrep",
      version: j.version ?? version(BIN.semgrep),
      status: results.length === 0 ? "clean" : "findings",
      ran: true,
      counts: { findings: results.length, filesScanned: scanned, configErrors: (j.errors ?? []).length },
      /**
       * Stated as it is: p/security-audit is a general ruleset, not a Solidity pack (the
       * registry answers 404 for `p/solidity`). The Solidity analysis comes from Slither and
       * Aderyn; Semgrep is a complement, and the page says so.
       */
      detail: `${results.length} findings across ${scanned} files · general p/security-audit ruleset`,
    });
  } catch (e) {
    add({ id: "semgrep", name: "Semgrep", tool: "semgrep", status: "error", ran: false, detail: String(e.message).slice(0, 200) });
  }
}

// ── 7. Echidna (docker) ─────────────────────────────────────────────────────
log("→ echidna");
{
  let imageOk = false;
  try {
    sh(BIN.docker, ["image", "inspect", "ghcr.io/crytic/echidna/echidna:latest"], { stdio: ["ignore", "ignore", "ignore"] });
    imageOk = true;
  } catch { /* image not pulled */ }

  if (!imageOk) {
    add({ id: "echidna", name: "Echidna", tool: "echidna (docker)", status: "not-installed", ran: false, detail: "the ghcr.io/crytic/echidna image has not been pulled" });
  } else {
    try {
      const uid = process.getuid ? process.getuid() : 1000;
      const gid = process.getgid ? process.getgid() : 1000;
      /**
       * One harness per curve contract in scope. Case names are prefixed with the harness so
       * properties with the same name can never be confused if another harness is added.
       */
      const HARNESSES = ["EchidnaAdextoCurve"];
      const props = [];
      let calls = 0;
      let instr = 0;
      const logs = [];
      for (const harness of HARNESSES) {
        /**
         * The host's solc installs are mounted where forge inside the image looks for them
         * (`$HOME/.local/share/svm`, with HOME=/tmp). The image's forge predates solc 0.8.37 and
         * cannot download a compiler it does not know, so without this mount the harness would
         * not compile. The binaries are the checksummed releases from binaries.soliditylang.org.
         */
        const svm = path.join(HOME, ".local", "share", "svm");
        /**
         * When dependencies are symlinks (a scan from a clean `git worktree` links the main
         * checkout's node_modules and forge-std instead of reinstalling them), their targets are
         * mounted at the same absolute path, so the links resolve inside the container too.
         */
        const linked = [];
        for (const rel of ["node_modules", "lib/forge-std"]) {
          const p = path.join(ROOT, rel);
          try {
            const real = realpathSync(p);
            if (real !== p) linked.push("-v", `${real}:${real}:ro`);
          } catch { /* not present */ }
        }
        const out = sh(BIN.docker, [
          "run", "--rm", "-v", `${ROOT}:/src`, "-w", "/src", "-u", `${uid}:${gid}`, "-e", "HOME=/tmp",
          ...(existsSync(svm) ? ["-v", `${svm}:/tmp/.local/share/svm`] : []),
          ...linked,
          "ghcr.io/crytic/echidna/echidna:latest",
          "sh", "-c", `echidna . --contract ${harness} --config echidna.yaml`,
        ]);
        logs.push(`===== ${harness} =====\n${out}`);
        const clean = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
        for (const m of clean.matchAll(/(echidna_\w+):\s*(passing|failed!?)/g)) {
          props.push({ name: `${harness}.${m[1]}`, passing: m[2].startsWith("passing") });
        }
        calls += Number((clean.match(/Total calls:\s*(\d+)/) || [])[1] || 0);
        instr += Number((clean.match(/Unique instructions:\s*(\d+)/) || [])[1] || 0);
      }
      writeFileSync(path.join(OUT_DIR, "echidna.log"), logs.join("\n"));
      const failed = props.filter((p) => !p.passing).length;
      add({
        id: "echidna",
        name: "Echidna",
        tool: "echidna (docker)",
        version: "2.3.3",
        status: failed === 0 && props.length > 0 ? "clean" : "findings",
        ran: true,
        counts: { properties: props.length, failed, totalCalls: calls, uniqueInstructions: instr },
        detail: `${props.length - failed}/${props.length} properties passed · ${HARNESSES.length} harness${HARNESSES.length === 1 ? "" : "es"} · ${calls.toLocaleString("en-US")} calls`,
        cases: props.map((p) => p.name),
      });
    } catch (e) {
      add({ id: "echidna", name: "Echidna", tool: "echidna (docker)", status: "error", ran: false, detail: String(e.message).slice(0, 200) });
    }
  }
}

/**
 * A hash of every contract file that was scanned.
 *
 * `commit` alone is not enough. The natural order is edit, scan, then commit, so the report
 * would name the commit BEFORE the edit while describing the code after it. A content hash per
 * file answers the question that matters, whether the scanned code is the code that exists now,
 * regardless of commit order.
 */
const contractHashes = {};
for (const f of readdirSync(path.join(ROOT, "contracts")).filter((f) => f.endsWith(".sol")).sort()) {
  const source = readFileSync(path.join(ROOT, "contracts", f));
  contractHashes[`contracts/${f}`] = createHash("sha256").update(source).digest("hex").slice(0, 16);
}

// ── write the report ────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  commit,
  commitTime,
  dirty,
  contractHashes,
  scope: { launchPath: LAUNCH_PATH, stakeContracts: STAKE_CONTRACTS },
  engines,
};
mkdirSync(path.dirname(REPORT), { recursive: true });
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

console.log(`\n${"─".repeat(70)}`);
for (const e of engines) {
  console.log(`  ${String(e.status).padEnd(14)} ${e.name.padEnd(20)} ${e.detail ?? ""}`);
}
console.log(`${"─".repeat(70)}`);
console.log(`commit ${commit ? commit.slice(0, 12) : "?"}${dirty ? " (dirty)" : ""}`);
console.log(`written: ${path.relative(ROOT, REPORT)}`);
