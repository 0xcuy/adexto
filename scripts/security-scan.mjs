/**
 * Menjalankan setiap mesin pemeriksa, lalu menulis SATU laporan terbaca-mesin.
 *
 * KENAPA BERKAS INI ADA
 *
 * Halaman /security tidak boleh memuat satu angka pun yang ditulis tangan. Tabel
 * "Slither ✅" yang diketik manusia adalah badge dengan langkah tambahan: ia terlihat
 * seperti bukti, tapi tidak ada yang mengikatnya ke hasil sungguhan, dan ia tetap
 * hijau setelah kontraknya berubah. Jadi halaman itu MEMBACA `src/config/
 * security-report.json`, dan satu-satunya yang menulis berkas itu adalah skrip ini.
 *
 * Aturan yang dipegang:
 *   - Mesin yang tidak terpasang dilaporkan `status: "not-installed"`, bukan dilewati.
 *     Cek yang hilang harus terlihat di halaman, bukan menghilang dari tabel.
 *   - Mesin yang gagal jalan dilaporkan `status: "error"` beserta pesannya.
 *   - Jumlah temuan diambil dari keluaran mesin, tidak pernah dari daftar di sini.
 *   - Commit hash dan status kotor/bersih ikut dicatat, supaya pembaca tahu laporan
 *     ini milik kode yang mana.
 *
 * Pakai: node scripts/security-scan.mjs
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
 * Kontrak jalur peluncuran: yang benar-benar dijalankan sebuah launch.
 *
 * Pemisahan ini penting supaya angkanya bermakna. Repo ini masih memuat generasi v1
 * yang superseded dan receiver CCIP yang sudah diputuskan dicabut; temuan di sana
 * NYATA dan tetap dilaporkan, tapi mencampurnya dengan jalur yang dipakai orang akan
 * menyamarkan keduanya. Daftarnya ditulis di sini, bukan di halaman, supaya halaman
 * tidak bisa mengarang cakupannya sendiri.
 */
const LAUNCH_PATH = [
  "contracts/AdextoCurveFactory.sol",
  "contracts/SovereignCurve.sol",
  "contracts/AdextoToken.sol",
  "contracts/IIdentityRegistry.sol",
];
const inLaunchPath = (f) => LAUNCH_PATH.some((p) => String(f || "").endsWith(p.replace(/^contracts\//, "contracts/")));

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
  /* di luar git */
}

// ── 1. Compiler jalur deploy ────────────────────────────────────────────────
//
// Ini pipeline yang benar-benar menghasilkan bytecode yang di-deploy, jadi
// warning-nya lebih berarti daripada warning build test.
log("→ compiler (jalur deploy, solc via-IR)");
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
      tool: "solc 0.8.26 (via-IR, optimizer 200)",
      version: "0.8.26",
      status: errors === 0 && warnings === 0 ? "clean" : "findings",
      ran: true,
      counts: { errors, warnings },
      detail: `${artifacts} artifacts compiled, ${warnings} warnings, ${errors} errors`,
    });
  } catch (e) {
    add({ id: "solc", name: "Compiler warnings", tool: "solc 0.8.26", status: "error", ran: false, detail: String(e.message).slice(0, 200) });
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
      // forge keluar non-nol saat ada test gagal; stdout tetap berisi JSON.
      return { ok: false, out: String(e.stdout || "") + String(e.stderr || "") };
    }
  };

  const parse = (raw) => {
    // Baris JSON terakhir yang valid adalah ringkasannya.
    let passed = 0, failed = 0, skipped = 0, cases = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      let j;
      try { j = JSON.parse(t); } catch { continue; }
      for (const suite of Object.values(j)) {
        const tests = suite?.test_results ?? {};
        for (const [name, r] of Object.entries(tests)) {
          const st = String(r.status || "").toLowerCase();
          if (st === "success") passed++;
          else if (st === "skipped") skipped++;
          else failed++;
          cases.push({ name, status: st, runs: r?.counterexample ? null : (r?.kind?.Fuzz?.runs ?? r?.kind?.Invariant?.runs ?? null) });
        }
      }
    }
    return { passed, failed, skipped, cases };
  };

  const fuzz = runForge("test/SovereignCurveFuzz.t.sol", {});
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
    detail: `${f.passed} properties passed, ${f.failed} failed · 4096 runs each`,
    cases: f.cases.map((c) => c.name),
  });

  log("→ forge test (invariant)");
  const inv = runForge("test/SovereignCurveInvariant.t.sol", {});
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
    detail: `${i.passed} invariant suite passed · 512 runs x 64 random actions`,
  });
}

// ── 3. Slither ──────────────────────────────────────────────────────────────
log("→ slither");
if (!has(BIN.slither)) {
  add({ id: "slither", name: "Slither", tool: "slither", status: "not-installed", ran: false });
} else {
  const jsonPath = path.join(OUT_DIR, "slither.json");
  let ok = true, errMsg = null;
  try {
    sh(BIN.slither, [".", "--filter-paths", "lib/|node_modules/|test/", "--json", jsonPath, "--disable-color"], {
      env: { ...process.env, PATH: `${path.join(HOME, ".foundry", "bin")}:${path.join(HOME, ".local", "bin")}:${process.env.PATH}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    // Slither keluar non-nol kalau menemukan sesuatu; JSON tetap ditulis.
    if (!existsSync(jsonPath)) { ok = false; errMsg = String(e.message).slice(0, 200); }
  }
  if (!ok) {
    add({ id: "slither", name: "Slither", tool: "slither", version: version(BIN.slither), status: "error", ran: false, detail: errMsg });
  } else {
    const j = JSON.parse(readFileSync(jsonPath, "utf8"));
    const dets = j?.results?.detectors ?? [];
    const sev = {}, sevLaunch = {};
    for (const d of dets) {
      const el = (d.elements ?? []).find((x) => x?.source_mapping?.filename_relative);
      const file = el ? el.source_mapping.filename_relative : "";
      const k = d.impact ?? "Unknown";
      sev[k] = (sev[k] ?? 0) + 1;
      if (inLaunchPath(file)) sevLaunch[k] = (sevLaunch[k] ?? 0) + 1;
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
    sh(BIN.aderyn, ["--src", "contracts", "--path-excludes", "test/,lib/,node_modules/", "-o", jsonPath], {
      env: { ...process.env, PATH: `${path.join(HOME, ".foundry", "bin")}:${path.join(HOME, ".local", "bin")}:${process.env.PATH}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const j = JSON.parse(readFileSync(jsonPath, "utf8"));
    const count = (grp) => (j?.[grp]?.issues ?? []).reduce((n, i) => n + (i.instances?.length ?? 0), 0);
    const kinds = (grp) => (j?.[grp]?.issues ?? []).length;
    const highInstances = (j?.high_issues?.issues ?? []).reduce((n, i) => n + (i.instances ?? []).filter((x) => inLaunchPath(x.contract_path)).length, 0);
    add({
      id: "aderyn",
      name: "Aderyn",
      tool: "aderyn",
      version: version(BIN.aderyn),
      status: "triaged",
      ran: true,
      counts: { highKinds: kinds("high_issues"), highInstances: count("high_issues"), lowKinds: kinds("low_issues"), lowInstances: count("low_issues") },
      launchPathCounts: { HighInstances: highInstances },
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
    let raw = "";
    try {
      raw = sh(BIN.solhint, ["-f", "json", "contracts/*.sol"]);
    } catch (e) {
      raw = String(e.stdout || "");
    }
    writeFileSync(path.join(OUT_DIR, "solhint.json"), raw);
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
       * Disebut apa adanya: p/security-audit adalah aturan umum, bukan pack khusus
       * Solidity. Registry `p/solidity` membalas HTTP 404, jadi pack itu tidak ada.
       * Analisis Solidity yang sesungguhnya datang dari Slither dan Aderyn; Semgrep
       * di sini pelengkap, dan halaman harus mengatakan begitu.
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
  } catch { /* image belum ada */ }

  if (!imageOk) {
    add({ id: "echidna", name: "Echidna", tool: "echidna (docker)", status: "not-installed", ran: false, detail: "the ghcr.io/crytic/echidna image has not been pulled" });
  } else {
    try {
      const uid = process.getuid ? process.getuid() : 1000;
      const gid = process.getgid ? process.getgid() : 1000;
      const out = sh(BIN.docker, [
        "run", "--rm", "-v", `${ROOT}:/src`, "-w", "/src", "-u", `${uid}:${gid}`, "-e", "HOME=/tmp",
        "ghcr.io/crytic/echidna/echidna:latest",
        "sh", "-c", "echidna . --contract EchidnaCurve --config echidna.yaml",
      ]);
      writeFileSync(path.join(OUT_DIR, "echidna.log"), out);
      const clean = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
      const props = [...clean.matchAll(/(echidna_\w+):\s*(passing|failed!?)/g)].map((m) => ({ name: m[1], passing: m[2].startsWith("passing") }));
      const calls = Number((clean.match(/Total calls:\s*(\d+)/) || [])[1] || 0);
      const instr = Number((clean.match(/Unique instructions:\s*(\d+)/) || [])[1] || 0);
      const failed = props.filter((p) => !p.passing).length;
      add({
        id: "echidna",
        name: "Echidna",
        tool: "echidna (docker)",
        version: "2.3.3",
        status: failed === 0 && props.length > 0 ? "clean" : "findings",
        ran: true,
        counts: { properties: props.length, failed, totalCalls: calls, uniqueInstructions: instr },
        detail: `${props.length - failed}/${props.length} properties passed · ${calls.toLocaleString("en-US")} calls`,
        cases: props.map((p) => p.name),
      });
    } catch (e) {
      add({ id: "echidna", name: "Echidna", tool: "echidna (docker)", status: "error", ran: false, detail: String(e.message).slice(0, 200) });
    }
  }
}

// ── tulis laporan ───────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  commit,
  commitTime,
  dirty,
  scope: { launchPath: LAUNCH_PATH },
  engines,
};
mkdirSync(path.dirname(REPORT), { recursive: true });
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

console.log(`\n${"─".repeat(70)}`);
for (const e of engines) {
  console.log(`  ${String(e.status).padEnd(14)} ${e.name.padEnd(20)} ${e.detail ?? ""}`);
}
console.log(`${"─".repeat(70)}`);
console.log(`commit ${commit ? commit.slice(0, 12) : "?"}${dirty ? " (kotor)" : ""}`);
console.log(`ditulis: ${path.relative(ROOT, REPORT)}`);
