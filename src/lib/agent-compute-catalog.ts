/**
 * Katalog sumber Agent Compute: setiap token yang bisa di-stake untuk compute, dengan angka chain-nya,
 * disimpan di memori dan diperbarui di latar.
 *
 * KENAPA KATALOG, DAN BUKAN MEMBACA PER PERMINTAAN (7 Okt, rencana 1.000–10.000 pasar)
 *
 * `GET /api/agent/keys` dulu membaca kelayakan hub dan anggaran setiap kurva pada setiap tampilan
 * halaman, lalu mengirim SEMUA sumber ke peramban. Dengan 13 sumber itu 7 KB; dengan 10.000 pasar itu
 * ±5 MB per tampilan dan puluhan ribu bacaan RPC. Di sini semuanya dibaca paling sering sekali per
 * menit lewat Multicall3 — empat bacaan per pasar hub (total stake, jumlah staker, dua angka fee
 * kurva), jadi 10.000 pasar = 40.000 bacaan = 200 permintaan, tersebar di enam chain — dan
 * permintaan halaman hanya memotong daftar yang sudah ada di memori: cari, saring, urutkan, ambil
 * satu halaman. Tanpa pengunjung, tidak ada pembaruan sama sekali.
 *
 * Basi-sambil-diperbarui: permintaan yang datang saat katalog melewati umurnya (`ttlFor`) tetap
 * dijawab dari salinan lama, dan pembaruan berjalan di belakang. Hanya permintaan PERTAMA sesudah
 * proses hidup yang menunggu, paling lama `COLD_WAIT_MS`; lewat dari itu jawabannya daftar tanpa
 * angka (`warming: true`), bukan galat.
 *
 * Pasar tersembunyi (`hidden-markets.ts`) tetap ADA di katalog dengan `hidden: true`, karena kunci
 * dan tautan langsung (`?stake=<id>`) ke pasar itu harus tetap jalan. Yang menyaring daftar publik
 * adalah route-nya, sama seperti Explorer.
 */
import { COMPUTE_STAKES, HUB_COMPUTE_SHARE_BPS, HUB_COMPUTE_USD_PER_MILLION_TOKENS, MEASURED_INPUT_FLOOR, type ComputeStake } from "@/config/agent-compute";
import { isHiddenMarket } from "@/config/hidden-markets";
import { listServedProjects } from "@/lib/registry";
import { nativePrices } from "@/lib/native-price";
import { keyCounts } from "@/lib/agent-compute-pool";
import { allComputeSources, budgetFromFees, hubEligibleBatch, sourceMetricsBatch } from "@/lib/stake-hub-server";

export type CatalogEntry = {
  id: string;
  kind: "tiered" | "hub";
  chainId: number;
  chainName: string;
  symbol: string;
  name: string;
  token: string;
  decimals: number;
  /** Kontrak stake (AdextoAgentStake atau hub chain-nya); null kalau belum ada. */
  contract: string | null;
  minStake: number;
  buyHref: string;
  tiers: Array<{ label: string; stake: number; allowance: number }>;
  hidden: boolean;
  /** Detik unix peluncuran pasarnya, dari registry; null kalau tidak dikenal. */
  deployedAt: number | null;
  /** Untuk pasar hub: apakah hub menerima tokennya. null = belum terbaca. */
  eligible: boolean | null;
  totalStaked: number | null;
  stakers: number | null;
  /** Pasar hub: protocol fee kurva sejak launch (aset native), dan compute yang dibiayainya. */
  feesNative: number | null;
  nativeSymbol: string | null;
  budgetUsd: number | null;
  budgetTokens: number | null;
};

/**
 * Umur katalog sebelum diperbarui: semenit sampai 5.000 pasar, lalu memanjang (12 ms per pasar, jadi
 * dua menit di 10.000), supaya RPC publik tidak menanggung 40.000 bacaan setiap menit. Diukur 7 Okt:
 * pembaruan pertama 10.000 pasar 17,6 s (termasuk 10.000 bacaan kelayakan yang sesudahnya di-cache).
 */
const ttlFor = (entries: number) => Math.max(60_000, entries * 12);
const COLD_WAIT_MS = 9_000;

type KeyTotals = { issued: number; active: number };
let state: { at: number; entries: CatalogEntry[]; keys: KeyTotals } | null = null;
let inflight: Promise<void> | null = null;

function baseEntry(s: ComputeStake, deployedAt: number | null): CatalogEntry {
  return {
    id: s.id,
    kind: s.kind === "hub" ? "hub" : "tiered",
    chainId: s.chainId,
    chainName: s.chainName,
    symbol: s.symbol,
    name: s.name,
    token: s.token,
    decimals: s.decimals,
    contract: s.contract,
    minStake: s.minStake,
    buyHref: s.buyHref,
    tiers: s.tiers.map((t) => ({ label: t.label, stake: t.stake, allowance: t.allowance })),
    hidden: isHiddenMarket(s.chainId, s.symbol),
    deployedAt,
    eligible: s.kind === "hub" ? null : true,
    totalStaked: null,
    stakers: null,
    feesNative: null,
    nativeSymbol: s.nativeSymbol ?? null,
    budgetUsd: null,
    budgetTokens: null,
  };
}

function launchTimes(): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of listServedProjects()) {
    if (p.tokenAddress && Number.isFinite(p.deployedAt)) out.set(`${p.chainId}:${p.tokenAddress.toLowerCase()}`, p.deployedAt);
  }
  return out;
}

async function build(): Promise<void> {
  const sources = allComputeSources();
  const launched = launchTimes();
  const hubs = sources.filter((s) => s.kind === "hub");
  /**
   * Kelayakan DULU, angka sesudahnya, dan angka hanya untuk yang layak. Dua alasan, keduanya dari uji
   * skala 7 Okt: pasar yang ditolak hub-nya tidak bisa di-stake dan tidak didaftar, jadi empat bacaannya
   * terbuang; dan menjalankan kedua bacaan bersamaan menggandakan permintaan serentak per chain, yang
   * membuat RPC publik Monad menolak satu batch (50 pasar tanpa angka) pada pembaruan pertama.
   */
  const eligible = await hubEligibleBatch(hubs);
  const readable = sources.filter((s) => s.kind !== "hub" || eligible.get(s.id) !== false);
  const [metrics, prices] = await Promise.all([
    sourceMetricsBatch(readable),
    nativePrices()
      .then((r) => r.prices as Record<string, number>)
      .catch(() => ({}) as Record<string, number>),
  ]);
  const entries = sources.map((s) => {
    const e = baseEntry(s, launched.get(`${s.chainId}:${s.token.toLowerCase()}`) ?? null);
    const m = metrics.get(s.id);
    e.totalStaked = m?.totalStaked ?? null;
    e.stakers = m?.stakers ?? null;
    if (s.kind === "hub") {
      e.eligible = eligible.get(s.id) ?? null;
      const symbol = s.nativeSymbol ?? "";
      const price = typeof prices[symbol] === "number" && prices[symbol] > 0 ? prices[symbol] : null;
      if (m?.feesWei != null) {
        const b = budgetFromFees(m.feesWei, symbol, price);
        e.feesNative = b.feesNative;
        e.budgetUsd = b.budgetUsd;
        e.budgetTokens = b.budgetTokens;
      }
    }
    return e;
  });
  // Jumlah kunci ikut dibaca di sini, sekali per menit, bukan per permintaan: berkas kuncinya
  // di-parse utuh setiap kali dibaca, dan di 10.000 kunci itu beberapa MB.
  state = { at: Date.now(), entries, keys: keyCounts() };
}

/** Katalog sekarang. Lihat catatan berkas tentang basi-sambil-diperbarui. */
export async function computeCatalog(): Promise<{
  entries: CatalogEntry[];
  keys: KeyTotals | null;
  refreshedAt: string | null;
  warming: boolean;
}> {
  const fresh = state !== null && Date.now() - state.at < ttlFor(state.entries.length);
  if (!fresh && !inflight) {
    inflight = build()
      .catch((e) => console.warn("[adexto] compute catalog refresh failed:", (e as Error).message))
      .finally(() => {
        inflight = null;
      });
  }
  if (!state && inflight) {
    await Promise.race([inflight, new Promise((r) => setTimeout(r, COLD_WAIT_MS))]);
  }
  if (state) return { entries: state.entries, keys: state.keys, refreshedAt: new Date(state.at).toISOString(), warming: false };
  // Belum ada satu pun bacaan yang selesai: daftarnya tetap ada, angkanya belum.
  const launched = launchTimes();
  return {
    entries: allComputeSources().map((s) => baseEntry(s, launched.get(`${s.chainId}:${s.token.toLowerCase()}`) ?? null)),
    keys: null,
    refreshedAt: null,
    warming: true,
  };
}

/** Entri tanpa angka chain untuk sebuah sumber, bila katalog belum memuatnya (pasar baru beberapa detik). */
export function entryFromSource(s: ComputeStake): CatalogEntry {
  return baseEntry(s, null);
}

/**
 * Bentuk publik satu sumber, sama di `/api/agent-compute/sources` dan `/api/agent/keys`, supaya
 * peramban punya satu tipe untuk kartu, baris direktori dan laci stake.
 */
export function sourceView(e: CatalogEntry) {
  return {
    id: e.id,
    kind: e.kind,
    chainId: e.chainId,
    chainName: e.chainName,
    symbol: e.symbol,
    name: e.name,
    token: e.token,
    decimals: e.decimals,
    contract: e.contract,
    minStake: e.minStake,
    buyHref: e.buyHref,
    tiers: e.tiers,
    hidden: e.hidden,
    eligible: e.eligible,
    deployedAt: e.deployedAt,
    totalStaked: e.totalStaked,
    stakers: e.stakers,
    feesNative: e.feesNative,
    nativeSymbol: e.nativeSymbol,
    budgetUsd: e.budgetUsd,
    budgetTokens: e.budgetTokens,
    shareBps: e.kind === "hub" ? HUB_COMPUTE_SHARE_BPS : null,
    usdPerMillionTokens: e.kind === "hub" ? HUB_COMPUTE_USD_PER_MILLION_TOKENS : null,
  };
}
export type SourceView = ReturnType<typeof sourceView>;

/** Pasar yang bisa di-stake di daftar publik: tidak tersembunyi, dan tidak ditolak hub-nya. */
export function listable(e: CatalogEntry): boolean {
  return !e.hidden && e.eligible !== false && Boolean(e.contract);
}

export type CatalogSort = "staked" | "stakers" | "funded" | "newest" | "name";
export const CATALOG_SORTS: readonly CatalogSort[] = ["staked", "stakers", "funded", "newest", "name"];

/** Urutan stabil: angka yang tidak terbaca selalu di bawah, lalu ticker sebagai pemecah seri. */
export function sortEntries(list: CatalogEntry[], sort: CatalogSort): CatalogEntry[] {
  const num = (v: number | null) => (v === null || !Number.isFinite(v) ? -1 : v);
  const tie = (a: CatalogEntry, b: CatalogEntry) => a.symbol.localeCompare(b.symbol) || a.chainId - b.chainId;
  const by: Record<CatalogSort, (a: CatalogEntry, b: CatalogEntry) => number> = {
    staked: (a, b) => num(b.totalStaked) - num(a.totalStaked) || tie(a, b),
    stakers: (a, b) => num(b.stakers) - num(a.stakers) || tie(a, b),
    // Sumber bertingkat tidak dibiayai trading; jatahnya tetap. Di urutan ini ia di bawah pasar hub.
    funded: (a, b) => num(b.budgetTokens) - num(a.budgetTokens) || tie(a, b),
    newest: (a, b) => num(b.deployedAt) - num(a.deployedAt) || tie(a, b),
    name: (a, b) => tie(a, b),
  };
  return [...list].sort(by[sort]);
}

/** Cocokkan ticker, nama, atau awalan alamat token. */
export function matchesQuery(e: CatalogEntry, q: string): boolean {
  const s = q.trim().toLowerCase().replace(/^\$/, "");
  if (!s) return true;
  if (s.startsWith("0x")) return e.token.toLowerCase().startsWith(s);
  return e.symbol.toLowerCase().includes(s) || e.name.toLowerCase().includes(s) || e.chainName.toLowerCase().includes(s);
}

/** Satu permintaan minimum, dalam token model: dipakai UI untuk "≈ N requests". */
export const REQUEST_FLOOR_TOKENS = MEASURED_INPUT_FLOOR;

/** Id empat sumber bertingkat, dalam urutan config. */
export const TIERED_IDS: readonly string[] = COMPUTE_STAKES.map((s) => s.id);
