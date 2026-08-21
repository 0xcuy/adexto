/**
 * Harness jalur baca kedua /api/graphql.
 *
 * Membuktikan tiga hal yang tidak bisa dibuktikan oleh `tsc` atau `next build`:
 *
 *   1. TANPA subgraph, /api/graphql tetap menjawab lengkap. Ini yang paling
 *      penting: registry adalah jalur pertama dan harus mandiri.
 *   2. DENGAN subgraph, `live` terisi dan harga yang kosong diisi dari indexer —
 *      tapi harga yang SUDAH ADA di registry tidak boleh ditimpa.
 *   3. Saat subgraph MATI / LAMBAT / BALAS ERROR, respons tidak berubah bentuk,
 *      tidak melempar, dan alasannya terbaca di `indexer.chains[].error`.
 *
 * Subgraph-nya distub di sini. Menguji terhadap graph-node sungguhan menguji
 * graph-node; yang perlu diuji adalah logika penggabungan milik kita.
 *
 * Pakai:  BASE_URL=http://127.0.0.1:3000 node audit_subgraph_readpath.mjs
 */
import { createServer } from "node:http";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const STUB_PORT = Number(process.env.STUB_PORT || 3211);

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function getIndex() {
  const r = await fetch(`${BASE_URL}/api/graphql`, { cache: "no-store" });
  if (!r.ok) throw new Error(`/api/graphql HTTP ${r.status}`);
  const j = await r.json();
  if (!j.data) throw new Error(`no data key: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data;
}

/** Stub subgraph. `mode` mengubah cara ia berkelakuan buruk. */
function startStub(curvesById, mode = "ok") {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        if (mode === "hang") return; // tidak pernah menjawab -> harus kena timeout
        if (mode === "http500") {
          res.writeHead(500).end("boom");
          return;
        }
        if (mode === "graphqlError") {
          res.writeHead(200, { "Content-Type": "application/json" }).end(
            JSON.stringify({ errors: [{ message: "auth error: malformed API key" }] }),
          );
          return;
        }
        let ids = [];
        try {
          ids = JSON.parse(body)?.variables?.ids ?? [];
        } catch {}
        const curves = ids
          .map((id) => curvesById[id.toLowerCase()])
          .filter(Boolean);
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            data: { curves, _meta: { block: { number: 50_200_000 }, hasIndexingErrors: false } },
          }),
        );
      });
    });
    server.listen(STUB_PORT, "127.0.0.1", () => resolve(server));
  });
}

function curve(id, over = {}) {
  return {
    id: id.toLowerCase(),
    reserveNative: "1500000000000000000000",
    reserveToken: "900000000000000000000000000",
    tokensSold: "100000000000000000000000000",
    spotPriceNative: "0.00000166666666666666",
    floorPriceNative: "0.0000015",
    volumeNative: "42000000000000000000",
    swapCount: "7",
    buyCount: "5",
    sellCount: "2",
    tokensBurned: "3000000000000000000000",
    totalDepthFees: "84000000000000000",
    totalCreatorFees: "42000000000000000",
    totalTreasuryFees: "42000000000000000",
    totalCreatorFeesClaimed: "0",
    initialized: true,
    lastSwapTimestamp: "1786900000",
    ...over,
  };
}

console.log(`\nADEXTO — harness jalur baca kedua subgraph`);
console.log(`target ${BASE_URL}\n`);

// ── 1. Registry mandiri ─────────────────────────────────────────────────────
console.log("1. TANPA subgraph — registry harus mandiri");
let data;
try {
  data = await getIndex();
} catch (e) {
  console.log(`  FAIL tidak bisa membaca /api/graphql — ${e.message}`);
  console.log("\n  Server dev jalan? BASE_URL benar?");
  process.exit(1);
}

check("respons punya data.projects", Array.isArray(data.projects));
check("projects tidak kosong", data.projects.length > 0, `dapat ${data.projects.length}`);
check("globalStats ada", Boolean(data.globalStats));
check("indexer dilaporkan", Boolean(data.indexer));
check("primarySource = registry", data.indexer?.primarySource === "registry");
check(
  "tiap project punya field identitas dari registry",
  data.projects.every((p) => p.tokenAddress && p.symbol && p.chainId),
);
check(
  "live = null saat tidak ada subgraph",
  data.projects.every((p) => p.live === null),
  `${data.projects.filter((p) => p.live !== null).length} punya live`,
);
check(
  "priceSource bukan 'subgraph' saat indexer tidak ada",
  data.projects.every((p) => p.priceSource !== "subgraph"),
);

const registryBaseline = new Map(data.projects.map((p) => [p.id, p]));
const poolProjects = data.projects.filter((p) => p.poolAddress);
console.log(`  (info) ${poolProjects.length} dari ${data.projects.length} project punya poolAddress`);

// Tanpa poolAddress, tidak ada yang bisa diperkaya — dan itu bukan kegagalan
// harness, tapi keadaan registry sekarang. Dilaporkan terang-terangan.
if (poolProjects.length === 0) {
  console.log("\n  CATATAN: nol project punya poolAddress, jadi bagian 2-5 tidak bisa");
  console.log("  membuktikan penggabungan. Registry-nya belum punya kurva mana pun.");
  console.log(`\nhasil: ${pass} lolos, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
}

const subject = poolProjects[0];
const stub = {};
stub[subject.poolAddress.toLowerCase()] = curve(subject.poolAddress);

console.log(`\n  subjek uji: ${subject.symbol} @ ${subject.chainKey} pool ${subject.poolAddress}`);
console.log(`  set SUBGRAPH_URL_${subject.chainKey.toUpperCase().replace("0G", "0G")} ke stub, lalu restart server dev`);
console.log(`  stub mendengar di http://127.0.0.1:${STUB_PORT}`);

// ── 2-5 butuh server dev yang env-nya menunjuk stub ─────────────────────────
// Harness ini tidak bisa menyuntik env ke proses Next yang sudah jalan, jadi
// bagian ini hanya berjalan bila pemanggil sudah mengarahkan env-nya.
const envVar = `SUBGRAPH_URL_${subject.chainKey === "0G" ? "0G" : subject.chainKey.toUpperCase()}`;
const chainHealth = data.indexer?.chains?.find((c) => c.chainKey === subject.chainKey);

if (!chainHealth || !chainHealth.configured) {
  console.log(`\n2-5. DILEWATI — ${envVar} belum diarahkan ke stub.`);
  console.log(`     Jalankan ulang dengan:`);
  console.log(`       ${envVar}=http://127.0.0.1:${STUB_PORT} npm run dev`);
  console.log(`     lalu:`);
  console.log(`       STUB_MODE=ok node audit_subgraph_readpath.mjs`);
  console.log(`\nhasil: ${pass} lolos, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
}

const server = await startStub(stub, process.env.STUB_MODE || "ok");
console.log(`\n2. DENGAN subgraph (mode ${process.env.STUB_MODE || "ok"})`);
await new Promise((r) => setTimeout(r, 250));

try {
  const merged = await getIndex();
  const m = merged.projects.find((p) => p.id === subject.id);
  const mode = process.env.STUB_MODE || "ok";

  if (mode === "ok") {
    check("live terisi untuk subjek", m?.live !== null);
    check("live.spotPriceNative angka", typeof m?.live?.spotPriceNative === "number");
    check(
      "harga 1e-6 tidak dibulatkan ke nol",
      (m?.live?.spotPriceNative ?? 0) > 0,
      `dapat ${m?.live?.spotPriceNative}`,
    );
    check("reserveNative tetap string (presisi wei)", typeof m?.live?.reserveNative === "string");
    check("indexer.chainsReachable >= 1", (merged.indexer?.chainsReachable ?? 0) >= 1);
    check("indexedBlock dilaporkan", chainHealthOf(merged, subject.chainKey)?.indexedBlock === 50_200_000);

    const before = registryBaseline.get(subject.id);
    if (before?.priceNative) {
      check(
        "harga registry TIDAK ditimpa subgraph",
        m.priceNative === before.priceNative,
        `registry ${before.priceNative} -> jadi ${m.priceNative}`,
      );
      check("priceSource = registry", m.priceSource === "registry");
    } else {
      check("harga kosong DIISI subgraph", m.priceNative > 0);
      check("priceSource = subgraph", m.priceSource === "subgraph");
    }
    check(
      "identitas registry tidak berubah",
      m.tokenAddress === before.tokenAddress && m.symbol === before.symbol && m.chainId === before.chainId,
    );
    check("jumlah project tidak berubah", merged.projects.length === registryBaseline.size);
  } else {
    // Mode rusak: bentuk respons harus identik dengan kasus tanpa subgraph.
    check("respons tetap terbentuk", Array.isArray(merged.projects));
    check("jumlah project tidak berubah", merged.projects.length === registryBaseline.size);
    check("live null saat indexer gagal", m?.live === null);
    const h = chainHealthOf(merged, subject.chainKey);
    check("kegagalan tercatat di indexer.chains[].error", Boolean(h?.error), JSON.stringify(h));
    check("reachable = false", h?.reachable === false);
    check(
      "identitas registry tidak berubah walau indexer gagal",
      m.tokenAddress === registryBaseline.get(subject.id).tokenAddress,
    );
  }
} finally {
  server.close();
}

function chainHealthOf(payload, chainKey) {
  return payload.indexer?.chains?.find((c) => c.chainKey === chainKey);
}

console.log(`\nhasil: ${pass} lolos, ${fail} gagal`);
if (failures.length) {
  console.log("\ngagal:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail ? 1 : 0);
