/**
 * Penjaga konsistensi: mengikat KLAIM ke FAKTA.
 *
 * `audit_claims.mjs` melarang daftar frasa tetap. Itu menangkap klaim yang selalu
 * salah, tapi tidak bisa menangkap kelas bug yang justru paling sering muncul di
 * proyek ini: **pernyataan yang dulu benar lalu diam-diam berhenti benar.**
 *
 * Riwayat nyatanya, semuanya lolos build dengan mulus:
 *   - README menandai factory 0.9.0 sebagai "current generation" berbulan-bulan
 *     setelah 0.10.0 di-broadcast. Siapa pun yang mengikutinya memakai generasi
 *     yang selectornya beda dan tanpa AGENT_REGISTRY.
 *   - /swap memberi tahu pengunjung "the curve factory has not been broadcast to
 *     mainnet" setelah factory-nya hidup di empat mainnet.
 *   - /docs menulis subgraph "is not yet deployed" setelah ter-deploy ke Studio.
 *   - README menulis SUBGRAPH_URL_* "deliberately unset" setelah diisi.
 *   - deskripsi subgraph menyebut "agent buyback burns" padahal executeBuyback
 *     tidak bergerbang pemanggil sama sekali.
 *   - deskripsi subgraph tidak pernah menyebut AgentBound yang justru diindeks.
 *
 * Semuanya punya bentuk yang sama: teks statis mengklaim sesuatu yang bisa dibaca
 * dari chain, dari .env.local, atau dari kode — dan tidak ada yang pernah
 * membandingkan keduanya. Berkas ini membandingkannya.
 *
 * Aturan yang dipegang: setiap pemeriksaan harus punya sumber kebenaran yang bisa
 * dibaca mesin. Tidak ada penilaian selera di sini; itu tugas review manusia.
 *
 * RPC yang tidak bisa dihubungi dilaporkan sebagai PERINGATAN, bukan kegagalan —
 * RPC publik memang kadang drop, dan menjatuhkan deploy karenanya akan membuat
 * penjaga ini dimatikan orang. Ketidaksesuaian NYATA selalu kegagalan.
 *
 * Pakai: node audit_consistency.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { ethers } from "ethers";

const ROOT = process.cwd();
let fail = 0;
let warn = 0;
const ok = (l, d) => console.log(`  OK    ${l}${d ? `: ${d}` : ""}`);
const bad = (l, d) => {
  console.log(`  FAIL  ${l}${d ? `: ${d}` : ""}`);
  fail++;
};
const soft = (l, d) => {
  console.log(`  WARN  ${l}${d ? `: ${d}` : ""}`);
  warn++;
};
const check = (l, pass, d) => (pass ? ok(l, d) : bad(l, d));

// ── sumber kebenaran ────────────────────────────────────────────────────────
const env = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
}
const readme = readFileSync("README.md", "utf8");
const manifest = readFileSync("subgraph/subgraph.yaml", "utf8");
const subgraphPkg = JSON.parse(readFileSync("subgraph/package.json", "utf8"));

const CHAINS = {
  16661: { key: "0G", rpc: env.OG_RPC_URL || "https://evmrpc.0g.ai", factoryEnv: "NEXT_PUBLIC_CURVE_FACTORY_0G" },
  8453: { key: "Base", rpc: "https://mainnet.base.org", factoryEnv: "NEXT_PUBLIC_CURVE_FACTORY_BASE" },
  42161: { key: "Arbitrum", rpc: "https://arb1.arbitrum.io/rpc", factoryEnv: "NEXT_PUBLIC_CURVE_FACTORY_ARBITRUM" },
  143: { key: "Monad", rpc: "https://rpc.monad.xyz", factoryEnv: "NEXT_PUBLIC_CURVE_FACTORY_MONAD" },
};

function providerFor(chainId) {
  const c = CHAINS[chainId];
  return new ethers.JsonRpcProvider(c.rpc, chainId, { staticNetwork: true });
}

/** Kumpulkan berkas sumber yang teksnya terlihat pengguna. */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|md)$/.test(e.name)) out.push(p);
    }
  };
  walk("src");
  out.push("README.md");
  return out;
}

/**
 * Buang komentar sebelum mencocokkan frasa.
 *
 * Tanpa ini, komentar yang MENJELASKAN sebuah klaim usang ("dulu di sini tertulis
 * X, dan itu keliru") akan memicu penjaga yang melarang X. Proyek ini penuh
 * komentar semacam itu dan memang harus tetap ada.
 */
function visibleText(path) {
  const raw = readFileSync(path, "utf8");
  if (path.endsWith(".md")) return raw;
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ── 1. alamat & versi di README harus cocok dengan chain ────────────────────
console.log("\n── README: alamat, VERSION dan ukuran bytecode vs chain ──");
{
  const rows = [];
  let chainId = null;
  for (const line of readme.split("\n")) {
    const head = line.match(/^###\s+.+?·\s+chain ID (\d+)/);
    if (head) {
      chainId = Number(head[1]);
      continue;
    }
    const m = line.match(/^\|\s*\*{0,2}([A-Za-z][A-Za-z0-9 ()]+?)\*{0,2}\s*\|\s*\[`(0x[0-9a-fA-F]{40})`\]/);
    if (!m || !chainId) continue;
    // Hanya kolom catatan yang dipindai untuk ukuran byte. Memindai seluruh baris
    // membuat ekor alamat hex terbaca sebagai ukuran: `…048D8bc1B` jadi "1 B".
    const notes = line.split("|").slice(3).join("|");
    rows.push({
      chainId,
      name: m[1].trim(),
      address: m[2],
      isCurrent: /\*\*current\*\*/.test(notes),
      claimsVersion: (notes.match(/`VERSION`\s*`([0-9.]+)`/) || [])[1] ?? null,
      claimsBytes: (notes.match(/\b(\d{1,3}(?:,\d{3})+)\s+B\b/) || [])[1]?.replace(/,/g, "") ?? null,
    });
  }

  if (rows.length === 0) bad("tabel alamat README terbaca", "0 baris ter-parse — format tabel berubah?");
  else {
    let mism = 0;
    let unreachable = 0;
    for (const r of rows) {
      let code, version;
      try {
        const p = providerFor(r.chainId);
        code = await p.getCode(r.address);
        try {
          version = await new ethers.Contract(r.address, ["function VERSION() view returns (string)"], p).VERSION();
        } catch {
          version = null;
        }
      } catch {
        unreachable++;
        continue;
      }
      const bytes = (code.length - 2) / 2;
      const issues = [];
      if (bytes === 0) issues.push("tidak ada bytecode");
      if (r.claimsVersion && version !== r.claimsVersion) issues.push(`klaim VERSION ${r.claimsVersion}, chain ${version ?? "tidak ada"}`);
      if (r.claimsBytes && Number(r.claimsBytes) !== bytes) issues.push(`klaim ${r.claimsBytes} B, chain ${bytes} B`);
      if (issues.length) {
        bad(`${CHAINS[r.chainId].key} ${r.name} ${r.address}`, issues.join("; "));
        mism++;
      }
    }
    if (unreachable > 0) soft("sebagian baris tidak bisa diverifikasi", `${unreachable} RPC gagal`);
    if (mism === 0) ok(`${rows.length - unreachable} baris alamat cocok dengan chain`);

    // Baris yang ditandai **current** harus sama dengan yang dipakai aplikasi.
    for (const [id, c] of Object.entries(CHAINS)) {
      const cur = rows.find((r) => r.chainId === Number(id) && r.isCurrent && /CurveFactory/i.test(r.name));
      const fromEnv = env[c.factoryEnv];
      if (!cur) {
        soft(`${c.key}: README tidak menandai factory mana yang current`);
        continue;
      }
      if (!fromEnv) {
        soft(`${c.key}: ${c.factoryEnv} tidak diset, tidak bisa dibandingkan`);
        continue;
      }
      check(
        `${c.key}: factory "current" di README = ${c.factoryEnv}`,
        cur.address.toLowerCase() === fromEnv.toLowerCase(),
        cur.address.toLowerCase() === fromEnv.toLowerCase() ? cur.address : `README ${cur.address} vs env ${fromEnv}`
      );
    }
  }
}

// ── 2. agent ERC-8004 yang diklaim README harus benar-benar milik kita ──────
console.log("\n── README: agent ERC-8004 vs kepemilikan on-chain ──");
{
  const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
  const owner = env.SIGNER_ADDRESS || "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D";
  const rows = [];
  let chainId = null;
  for (const line of readme.split("\n")) {
    const head = line.match(/^###\s+.+?·\s+chain ID (\d+)/);
    if (head) chainId = Number(head[1]);
    const m = line.match(/ERC-8004 agent[^|]*\|\s*\[`(\d+)`\]/);
    if (m && chainId) rows.push({ chainId, agentId: BigInt(m[1]) });
  }
  if (rows.length === 0) soft("README tidak mencantumkan agent id, tidak ada yang diperiksa");
  for (const r of rows) {
    try {
      const p = providerFor(r.chainId);
      const got = await new ethers.Contract(REGISTRY, ["function ownerOf(uint256) view returns (address)"], p).ownerOf(r.agentId);
      check(
        `${CHAINS[r.chainId].key} agent ${r.agentId} dimiliki deployer`,
        got.toLowerCase() === owner.toLowerCase(),
        got.toLowerCase() === owner.toLowerCase() ? got : `on-chain ${got}`
      );
    } catch (e) {
      soft(`${CHAINS[r.chainId].key} agent ${r.agentId} tidak bisa dibaca`, String(e.shortMessage ?? e.message).slice(0, 50));
    }
  }
}

// ── 3. versi subgraph harus sama di semua tempat ───────────────────────────
console.log("\n── versi subgraph: package.json vs env vs dokumen ──");
{
  const v = subgraphPkg.version;
  ok(`subgraph/package.json`, `v${v}`);
  for (const k of ["SUBGRAPH_URL_BASE", "SUBGRAPH_URL_ARBITRUM"]) {
    const url = env[k];
    if (!url) {
      soft(`${k} tidak diset`, "lewati");
      continue;
    }
    const inUrl = (url.match(/\/v([0-9.]+)$/) || [])[1];
    check(`${k} memakai v${v}`, inUrl === v, inUrl ? `v${inUrl}` : "tidak ada versi di URL");
  }
  /**
   * Hanya URL endpoint yang diperiksa, BUKAN setiap penyebutan versi di prosa.
   *
   * Versi pertama memindai semua kemunculan `v0.x.y` dekat kata "subgraph" dan
   * langsung menuduh README, padahal yang ditemukannya adalah catatan riwayat yang
   * memang harus ada di sana ("v0.10.1 memperbaiki ketidakcocokan satuan…").
   * Menceritakan versi lama itu sah; yang tidak sah adalah MENYAJIKAN URL versi
   * lama sebagai endpoint. Jadi yang dijaga URL-nya.
   */
  const staleUrls = [];
  for (const path of ["README.md", "src/app/docs/page.tsx"]) {
    for (const m of visibleText(path).matchAll(/api\.studio\.thegraph\.com\/query\/\d+\/[a-z0-9-]+\/v([0-9.]+)/g)) {
      if (m[1] !== v) staleUrls.push(`${path}: v${m[1]}`);
    }
  }
  check(
    "setiap URL endpoint Studio di dokumen memakai versi aktif",
    staleUrls.length === 0,
    staleUrls.join(", ") || `semua v${v}`
  );
}

// ── 4. setiap event yang diindeks harus disebut di deskripsi subgraph ──────
console.log("\n── deskripsi subgraph vs event yang benar-benar diindeks ──");
{
  const events = [...manifest.matchAll(/- event:\s*(\w+)\(/g)].map((m) => m[1]);
  const description = (manifest.match(/^description: >\n([\s\S]*?)\nrepository:/m) || ["", ""])[1];
  const rule = {
    TrinityProjectDeployed: /launch/i,
    AgentBound: /agent identit|ERC-8004|binding/i,
    CurveInitialized: /curve/i,
    Swap: /swap/i,
    AutoBuybackExecuted: /buyback/i,
    CreatorFeesClaimed: /creator fee/i,
  };
  const missing = [];
  for (const ev of new Set(events)) {
    const r = rule[ev];
    if (!r) {
      soft(`event ${ev} belum punya aturan penyebutan`, "tambahkan ke `rule` di berkas ini");
      continue;
    }
    if (!r.test(description)) missing.push(ev);
  }
  check("setiap event terindeks disebut di deskripsi", missing.length === 0, missing.join(", ") || `${new Set(events).size} event`);
}

// ── 5. atribusi buyback harus mengikuti kontraknya ─────────────────────────
console.log("\n── deskripsi tidak boleh mengatribusikan buyback ke agent tanpa gerbang ──");
{
  const sol = readFileSync("contracts/SovereignCurve.sol", "utf8");
  const fn = sol.slice(sol.indexOf("function executeBuyback"));
  const head = fn.slice(0, fn.indexOf("{"));
  const gated = /onlyAgent/.test(head) || /require\s*\(\s*msg\.sender\s*==/.test(fn.slice(0, fn.indexOf("\n    }")));
  const description = (manifest.match(/^description: >\n([\s\S]*?)\nrepository:/m) || ["", ""])[1];
  const attributes = /agent[- ]?(funded |triggered |executed )?buyback/i.test(description);
  if (gated) ok("executeBuyback bergerbang, atribusi ke agent boleh");
  else
    check(
      "executeBuyback terbuka untuk siapa pun, jadi deskripsi tidak menyebutnya milik agent",
      !attributes,
      attributes ? 'masih berbunyi "agent buyback"' : "diatribusikan ke treasury"
    );
}

// ── 6. status yang sudah berubah tidak boleh masih disangkal ───────────────
console.log("\n── penyangkalan usang vs keadaan env sebenarnya ──");
{
  const factoriesSet = Object.values(CHAINS).every((c) => Boolean(env[c.factoryEnv]));
  const subgraphSet = Boolean(env.SUBGRAPH_URL_BASE || env.SUBGRAPH_URL_ARBITRUM);

  /** [aktif kalau, frasa, alasan] */
  const guards = [
    [factoriesSet, /factory has not been\s+broadcast/i, "keempat NEXT_PUBLIC_CURVE_FACTORY_* terisi"],
    [factoriesSet, /launching[^.]{0,40}(not enabled|disabled)/i, "keempat factory terisi, launching aktif"],
    [factoriesSet, /intentionally still unset/i, "env factory sudah diisi"],
    [factoriesSet, /Not live:[^.]*mainnet launch factory/i, "factory hidup di empat mainnet"],
    [subgraphSet, /subgraph[^.]{0,60}is not yet deployed/i, "subgraph sudah ter-deploy ke Studio"],
    [subgraphSet, /no mainnet subgraph has been deployed/i, "dua subgraph mainnet sudah ter-deploy"],
    [subgraphSet, /SUBGRAPH_URL_\*[^.]{0,40}(unset|not set)/i, "SUBGRAPH_URL_* sudah diisi"],
    [subgraphSet, /still does not read them/i, "aplikasi sudah diwire ke indexer"],
  ];

  /**
   * Markdown dipindai dari sumber; UI dipindai dari halaman yang BENAR-BENAR
   * dirender.
   *
   * Versi pertama memindai `.tsx` sebagai teks dan menuduh studio/page.tsx karena
   * memuat "Launching is disabled." — padahal string itu berada di dalam
   * `{liveChains.length === 0 && …}` dan tidak pernah tampil selama ada factory.
   * Copy yang benar dituduh salah. Berkas sumber tidak tahu apa yang dirender,
   * jadi satu-satunya cara jujur menilai teks UI adalah membacanya dari halaman
   * jadi — persis yang dilakukan audit_claims.mjs.
   *
   * Tanpa BASE_URL bagian UI DILEWATI dengan peringatan, bukan ditebak. Penjaga
   * yang salah tuduh akan dimatikan orang, dan itu lebih buruk daripada tidak ada
   * penjaga.
   */
  let hits = 0;
  for (const path of sourceFiles().filter((p) => p.endsWith(".md"))) {
    const text = visibleText(path);
    for (const [active, re, why] of guards) {
      if (!active) continue;
      const m = text.match(re);
      if (m) {
        bad(`${path} masih menyangkal keadaan sekarang`, `"${m[0].slice(0, 60)}" — ${why}`);
        hits++;
      }
    }
  }

  const BASE = process.env.BASE_URL;
  if (!BASE) {
    soft("teks UI tidak diperiksa", "setel BASE_URL untuk memindai halaman yang dirender");
  } else {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    const routes = ["/", "/studio", "/swap", "/explorer", "/docs", "/pitch", "/governance"];
    for (const route of routes) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
        await page.waitForTimeout(1500);
        const text = await page.locator("body").innerText();
        for (const [active, re, why] of guards) {
          if (!active) continue;
          const m = text.match(re);
          if (m) {
            bad(`${route} masih menyangkal keadaan sekarang`, `"${m[0].slice(0, 60)}" — ${why}`);
            hits++;
          }
        }
      } catch (e) {
        soft(`${route} tidak bisa dibaca`, String(e.message).slice(0, 60));
      }
      await page.close();
    }
    await browser.close();
  }

  if (hits === 0) ok("tidak ada penyangkalan usang di markdown maupun teks yang dirender");
}

// ── 7. klaim ketersediaan Uniswap harus mengikuti chain ────────────────────
console.log("\n── klaim 'chain X tidak punya Uniswap' vs kenyataan on-chain ──");
{
  /**
   * README pernah menyatakan "0G dan Monad tidak punya deployment Uniswap v4 sama
   * sekali" sebagai fakta. Itu benar saat ditulis dan berhenti benar ketika Monad
   * mendapat Uniswap — dan tidak ada yang memberitahu, karena klaim itu tidak
   * pernah dibandingkan dengan apa pun.
   *
   * Alamat di bawah berasal dari feed deployment resmi Uniswap dan sudah
   * diverifikasi 24.009 byte masing-masing. Kalau Uniswap memindahkannya, getCode
   * akan mengembalikan 0 dan pemeriksaan ini berbunyi PERINGATAN, bukan lolos
   * diam-diam.
   */
  const V4_POOL_MANAGER = {
    8453: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    42161: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32",
    143: "0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e",
    // 0G sengaja tidak ada: tidak satu pun record Uniswap untuk chain ini.
  };

  /**
   * Router CCIP, kelas klaim yang sama dan sudah basi dengan cara yang sama.
   *
   * `/docs` menyatakan "Chainlink CCIP publishes no router on 0G or Monad". Daftar
   * mainnet resmi Chainlink memuat `0g-mainnet` dan `monad-mainnet`, dan keempat
   * router terbukti ada di chain. Alamat di bawah sudah diverifikasi.
   */
  const CCIP_ROUTER = {
    16661: "0x0aA145a62153190B8f0D3cA00c441e451529f755",
    8453: "0x881e3A65B4d4a04dD529061dd0071cf975F58bCD",
    42161: "0x141fa059441E0ca23ce184B6A78bafD2A517DdE8",
    143: "0x33566fE5976AAa420F3d5C64996641Fc3858CaDB",
  };

  const live = [];
  for (const [id, addr] of Object.entries(V4_POOL_MANAGER)) {
    try {
      const code = await providerFor(Number(id)).getCode(addr);
      const bytes = (code.length - 2) / 2;
      if (bytes > 0) live.push(CHAINS[id].key);
      else soft(`v4 PoolManager ${CHAINS[id].key} kini 0 byte`, `${addr} — alamat mungkin berpindah, perbarui daftar`);
    } catch (e) {
      soft(`v4 PoolManager ${CHAINS[id].key} tidak bisa dibaca`, String(e.shortMessage ?? e.message).slice(0, 40));
    }
  }
  if (live.length) ok(`v4 PoolManager hidup di ${live.join(", ")}`);

  // Untuk chain yang v4-nya HIDUP, dokumen tidak boleh mengatakan chain itu tidak punya.
  let bogus = 0;
  for (const path of sourceFiles().filter((p) => p.endsWith(".md"))) {
    const text = visibleText(path);
    for (const key of live) {
      // Cocokkan hanya pernyataan yang MENYANGKAL, dan hanya di luar konteks koreksi.
      const re = new RegExp(`${key}[^.]{0,80}(no|tidak ada)[^.]{0,40}Uniswap`, "i");
      const m = text.match(re);
      if (!m) continue;
      // Kalimat yang secara eksplisit menandai dirinya koreksi tidak dihitung.
      const around = text.slice(Math.max(0, m.index - 200), m.index + 200);
      if (/no longer true|corrected here|used to add|sudah tidak benar|diralat/i.test(around)) continue;
      bad(`${path} menyangkal Uniswap di ${key}`, `"${m[0].slice(0, 70)}" — v4 PoolManager ada di chain itu`);
      bogus++;
    }
  }
  if (bogus === 0) ok("tidak ada dokumen yang menyangkal Uniswap di chain yang sebenarnya punya");

  // ── CCIP: klaim ketersediaan router harus mengikuti chain juga ──
  const ccipLive = [];
  for (const [id, addr] of Object.entries(CCIP_ROUTER)) {
    try {
      const code = await providerFor(Number(id)).getCode(addr);
      if ((code.length - 2) / 2 > 0) ccipLive.push(CHAINS[id].key);
      else soft(`router CCIP ${CHAINS[id].key} kini 0 byte`, `${addr} — perbarui daftar`);
    } catch (e) {
      soft(`router CCIP ${CHAINS[id].key} tidak bisa dibaca`, String(e.shortMessage ?? e.message).slice(0, 40));
    }
  }
  if (ccipLive.length) ok(`router CCIP hidup di ${ccipLive.join(", ")}`);

  /**
   * Yang dijaga adalah klaim tentang KETERSEDIAAN Chainlink, bukan tentang keadaan
   * kita. "lane kami idle" atau "belum kami buka" itu benar dan harus tetap boleh
   * ditulis; "Chainlink tidak menerbitkan router di sini" tidak boleh.
   */
  let ccipBogus = 0;
  for (const path of sourceFiles()) {
    const text = visibleText(path);
    for (const key of ccipLive) {
      const re = new RegExp(`(publishes no router|no router|tidak menerbitkan router)[^.]{0,60}${key}|${key}[^.]{0,60}(publishes no router|tidak menerbitkan router)`, "i");
      const m = text.match(re);
      if (!m) continue;
      const around = text.slice(Math.max(0, m.index - 200), m.index + 200);
      if (/no longer true|corrected here|berhenti benar|diralat/i.test(around)) continue;
      bad(`${path} menyangkal router CCIP di ${key}`, `"${m[0].slice(0, 60)}" — router ada di chain itu`);
      ccipBogus++;
    }
  }
  if (ccipBogus === 0) ok("tidak ada dokumen yang menyangkal router CCIP di chain yang sebenarnya punya");
}

console.log(`\n  temuan: ${fail}   peringatan: ${warn}`);
if (fail > 0) {
  console.log("  Kelas bug di sini adalah pernyataan yang dulu benar. Perbaiki teksnya, bukan pemeriksanya,");
  console.log("  kecuali fakta yang dirujuk memang sudah berubah.");
}
process.exit(fail === 0 ? 0 : 1);
