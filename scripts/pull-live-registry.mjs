/**
 * Tarik daftar pasar dari situs LIVE ke registry lokal, supaya UI lokal memperlihatkan
 * pasar yang sama dengan produksi saat mengerjakan tampilan.
 *
 * KENAPA INI SKRIP, BUKAN SALIN-TEMPEL SEKALI
 *
 * Registry lokal tertinggal di belakang produksi setiap kali ada peluncuran baru, dan
 * perbedaannya tidak kelihatan sebagai galat — ia kelihatan sebagai "kok pasarnya cuma
 * tiga". Menyalin berkasnya sekali akan mengulang masalah yang sama minggu depan.
 *
 * YANG DITARIK DAN TIDAK
 *
 * Sumbernya `POST /api/graphql` di produksi, yaitu payload publik yang sama dengan yang
 * dibaca explorer. Ia TIDAK memuat `creator`, dan itu disengaja di sisi produksi. Karena
 * pengembangan lokal butuh tahu siapa pemilik pasar (tombol sunting hanya muncul bagi
 * peluncurnya), skrip ini mengisi `creator` dengan alamat yang diberikan lewat
 * `--creator=0x…`, dan kalau tidak diberikan ia memakai nilai yang sudah ada di berkas
 * lokal, lalu terakhir alamat factory. Ini data pengembangan; jangan pernah dijalankan ke
 * arah sebaliknya.
 *
 * Berkas lama SELALU dibuat salinannya lebih dulu. Skrip yang menulis registry tanpa
 * cadangan adalah cara kehilangan pasar uji yang dipakai audit.
 *
 * Pakai:
 *   node scripts/pull-live-registry.mjs
 *   node scripts/pull-live-registry.mjs --from=https://adexto.xyz --creator=0x8a3c…
 *   node scripts/pull-live-registry.mjs --dry-run
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  })
);
const FROM = (args.get("from") || "https://adexto.xyz").replace(/\/$/, "");
const DRY = args.has("dry-run");
const DATA_DIR = process.env.ADEXTO_DATA_DIR || ".data";
const STORE = join(DATA_DIR, "projects.json");

const res = await fetch(`${FROM}/api/graphql`, { method: "POST" });
if (!res.ok) {
  console.error(`sumber menjawab ${res.status}`);
  process.exit(1);
}
const json = await res.json();
const live = json?.data?.projects;
if (!Array.isArray(live) || live.length === 0) {
  console.error("sumber tidak mengembalikan pasar");
  process.exit(1);
}

const existing = existsSync(STORE) ? JSON.parse(readFileSync(STORE, "utf8")) : [];
const rows = Array.isArray(existing) ? existing : existing.projects ?? [];
const byKey = new Map(rows.map((r) => [`${r.chainId}:${String(r.symbol).toUpperCase()}`, r]));

const fallbackCreator = args.get("creator") || null;

/** Bentuk baris registry dari payload publik, tanpa menghapus yang sudah benar lokal. */
function merge(p) {
  const key = `${p.chainId}:${String(p.symbol).toUpperCase()}`;
  const prev = byKey.get(key) ?? {};
  return {
    ...prev,
    id: String(p.tokenAddress).toLowerCase(),
    tokenAddress: p.tokenAddress,
    poolAddress: p.poolAddress ?? null,
    // Lihat catatan di kepala berkas: payload publik tidak membawa `creator`.
    creator: fallbackCreator ?? prev.creator ?? p.tokenAddress,
    name: p.name,
    symbol: String(p.symbol).toUpperCase(),
    slug: String(p.slug ?? p.symbol).toLowerCase(),
    chainId: Number(p.chainId),
    chainKey: p.chainKey ?? prev.chainKey,
    /**
     * Payload publik menamai field ini `chain`, BUKAN `chainLabel`.
     *
     * Versi pertama skrip ini membaca `p.chainLabel`, yang tidak ada di sana, jadi tiga baris
     * yang belum pernah ada secara lokal masuk dengan `chainLabel: undefined` — dan label itu
     * dirender apa adanya di halaman pasar. Gejalanya tidak muncul sebagai galat, hanya sebagai
     * label chain yang hilang, dan hanya pada pasar yang baru ditarik.
     */
    chainLabel: p.chain ?? p.chainLabel ?? prev.chainLabel ?? String(p.chainKey ?? ""),
    targetChainIds: p.targetChainIds ?? [Number(p.chainId)],
    nativeSymbol: p.nativeSymbol ?? prev.nativeSymbol,
    priceNative: Number(p.priceNative) || 0,
    supply: Number(p.supply) || 0,
    lpFeeBps: Number(p.lpFeeBps ?? prev.lpFeeBps ?? 20),
    treasuryBuybackBps: Number(p.treasuryBuybackBps ?? prev.treasuryBuybackBps ?? 10),
    agentModel: p.agentModel ?? prev.agentModel,
    agentPersona: p.agentPersona ?? prev.agentPersona,
    agentStatus: p.agentStatus ?? prev.agentStatus,
    edgeProvider: p.edgeProvider ?? prev.edgeProvider,
    mcpTools: p.mcpTools ?? prev.mcpTools ?? [],
    category: p.category ?? prev.category ?? "defi",
    description: p.description ?? prev.description ?? null,
    links: p.links ?? prev.links ?? null,
    // Logo disajikan produksi sebagai URL `/api/logo/<sym>`; menyimpan URL itu di registry
    // lokal akan membuat gambar lokal bergantung pada produksi. Jadi jatuh ke bawaan dan
    // biarkan pemiliknya memilih preset di UI lokal.
    image: /^\/api\/logo\//.test(String(p.image)) ? prev.image ?? "/logo.svg" : p.image ?? "/logo.svg",
    txHash: p.transactionHash ?? prev.txHash ?? null,
    blockNumber: p.blockNumber ?? prev.blockNumber ?? null,
    teeRoot: p.metadataRoot ?? p.teeAttestationRoot ?? prev.teeRoot ?? null,
    daStorageTx: p.daStorageTx ?? prev.daStorageTx ?? null,
    deployedAt: Number(p.deployedAt) || prev.deployedAt || 0,
    verified: p.verified ?? prev.verified ?? true,
    curated: prev.curated ?? false,
    poolLive: Boolean(p.tradable ?? prev.poolLive ?? false),
  };
}

const merged = live.map(merge);
// Baris lokal yang tidak ada di produksi DIPERTAHANKAN: pasar devchain hasil audit hidup di
// sini, dan membuangnya akan mematahkan harness yang bergantung padanya.
const liveKeys = new Set(merged.map((r) => `${r.chainId}:${r.symbol}`));
const localOnly = rows.filter((r) => !liveKeys.has(`${r.chainId}:${String(r.symbol).toUpperCase()}`));
const out = [...merged, ...localOnly];

console.log(`sumber   : ${FROM}`);
console.log(`live     : ${merged.length} pasar`);
console.log(`lokal-only: ${localOnly.length} dipertahankan`);
for (const r of out) {
  console.log(`  ${r.symbol.padEnd(8)} chain=${String(r.chainId).padEnd(6)} live=${String(r.poolLive).padEnd(5)} creator=${String(r.creator).slice(0, 10)}…`);
}

if (DRY) {
  console.log("\n--dry-run: tidak ada yang ditulis");
  process.exit(0);
}

mkdirSync(dirname(STORE), { recursive: true });
if (existsSync(STORE)) {
  const backup = `${STORE}.bak-pull-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
  copyFileSync(STORE, backup);
  console.log(`\ncadangan : ${backup}`);
}
writeFileSync(STORE, JSON.stringify(out, null, 2));
console.log(`ditulis  : ${STORE} (${out.length} baris)`);
console.log("\nRegistry menyimpan cache di memori proses, jadi restart server dev agar terbaca.");
