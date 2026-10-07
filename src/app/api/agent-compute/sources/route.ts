/**
 * `GET /api/agent-compute/sources` — daftar token yang bisa di-stake untuk Agent Compute, berhalaman.
 *
 *   ?q=        ticker, nama, chain, atau awalan alamat token (≤ 64 karakter)
 *   ?chain=    chain id
 *   ?kind=     tiered | hub
 *   ?sort=     staked (bawaan) | stakers | funded | newest | name
 *   ?page=     mulai 1        ?limit=  1–50, bawaan 24
 *   ?ids=a,b   sumber tertentu menurut id (≤ 20), termasuk pasar tersembunyi: tautan `?stake=<id>`
 *              ke pasar itu harus tetap terbuka walaupun pasarnya tidak didaftar.
 *
 * KENAPA ROUTE TERSENDIRI (7 Okt, rencana 1.000–10.000 pasar)
 *
 * `/api/agent/keys` dulu mengirim SEMUA sumber pada setiap tampilan halaman. Di sini daftar dipotong
 * di server dari katalog di memori (`agent-compute-catalog.ts`), jadi ukuran jawaban tetap ±24 baris
 * berapa pun jumlah pasarnya, dan tidak ada bacaan RPC di jalur permintaan.
 *
 * `counts` per chain dihitung SESUDAH pencarian dan SEBELUM saringan chain, supaya chip chain
 * menyebut berapa hasil yang menunggu di chain itu untuk pencarian yang sedang diketik.
 *
 * Publik dan hanya-baca: semua angkanya data chain yang siapa pun bisa baca sendiri, ditambah
 * jumlah kunci yang tercatat (tanpa alamat).
 */
import { NextResponse } from "next/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import {
  CATALOG_SORTS,
  computeCatalog,
  listable,
  matchesQuery,
  sortEntries,
  sourceView,
  type CatalogSort,
} from "@/lib/agent-compute-catalog";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

const int = (v: string | null) => (v && /^\d{1,6}$/.test(v) ? Number(v) : null);

export async function GET(req: Request) {
  const gate = rateLimit(`acsources:${clientIp(req)}`, 120, 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many requests.", retryAfter: gate.retryAfter },
      { status: 429, headers: rateLimitHeaders(gate) },
    );
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 64);
  const chain = int(url.searchParams.get("chain"));
  const kindRaw = url.searchParams.get("kind");
  const kind = kindRaw === "tiered" || kindRaw === "hub" ? kindRaw : null;
  const sortRaw = url.searchParams.get("sort") as CatalogSort | null;
  const sort: CatalogSort = sortRaw && CATALOG_SORTS.includes(sortRaw) ? sortRaw : "staked";
  const limit = Math.min(MAX_LIMIT, Math.max(1, int(url.searchParams.get("limit")) ?? DEFAULT_LIMIT));
  const page = Math.max(1, int(url.searchParams.get("page")) ?? 1);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9-]{3,40}$/.test(s))
    .slice(0, 20);

  const { entries, keys, refreshedAt, warming } = await computeCatalog();
  const headers = {
    "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=120",
    ...rateLimitHeaders(gate),
  };

  if (ids.length) {
    const byId = new Map(entries.map((e) => [e.id, e]));
    const items = ids.flatMap((id) => {
      const e = byId.get(id);
      return e ? [sourceView(e)] : [];
    });
    return NextResponse.json({ items, refreshedAt, warming }, { headers });
  }

  const listed = entries.filter(listable);
  const ofKind = kind ? listed.filter((e) => e.kind === kind) : listed;
  const matched = ofKind.filter((e) => matchesQuery(e, q));
  const counts: Record<string, number> = { all: matched.length };
  for (const e of matched) counts[String(e.chainId)] = (counts[String(e.chainId)] ?? 0) + 1;
  const inChain = chain === null ? matched : matched.filter((e) => e.chainId === chain);
  const sorted = sortEntries(inChain, sort);
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const current = Math.min(page, pages);

  return NextResponse.json(
    {
      items: sorted.slice((current - 1) * limit, current * limit).map(sourceView),
      total,
      page: current,
      pages,
      limit,
      sort,
      counts,
      summary: {
        markets: listed.length,
        tiered: listed.filter((e) => e.kind === "tiered").length,
        chains: new Set(listed.map((e) => e.chainId)).size,
        keysIssued: keys?.issued ?? null,
        keysActive: keys?.active ?? null,
      },
      refreshedAt,
      warming,
    },
    { headers },
  );
}
