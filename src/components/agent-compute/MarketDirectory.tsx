"use client";
/**
 * Direktori setiap token yang bisa di-stake, berhalaman di server (`/api/agent-compute/sources`).
 *
 * Inilah jawaban untuk "bagaimana kalau sudah 10.000 agen": halaman tidak pernah memegang lebih dari
 * satu halaman hasil (24 baris), pencarian dan urutan dikerjakan server, dan tinggi bagian ini tetap
 * sama berapa pun jumlah pasarnya. Dulu setiap sumber dirender sebagai baris centang di kartu teratas.
 *
 * Keadaan (cari, chain, urutan, halaman) disimpan di URL dengan `replaceState`, jadi tautan bisa
 * dibagikan dan Back tidak dipenuhi satu entri per ketikan. `stake=` milik laci dan tidak disentuh.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { CHAIN_LIST, chainMark } from "@/lib/chains";
import ChainChip from "@/components/ui/ChainChip";
import Skeleton from "@/components/ui/Skeleton";
import { fmt, fmtShort, type DirectoryResponse, type DirectorySort, type SourceView } from "@/components/agent-compute/types";

const SORTS: Array<{ id: DirectorySort; label: string }> = [
  { id: "staked", label: "Most staked" },
  { id: "stakers", label: "Most stakers" },
  { id: "funded", label: "Most compute funded" },
  { id: "newest", label: "Newest" },
  { id: "name", label: "A to Z" },
];
const LIMIT = 24;

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const sort = p.get("sort") as DirectorySort | null;
  const chain = p.get("chain");
  const page = Number(p.get("page"));
  return {
    q: (p.get("q") ?? "").slice(0, 64),
    chain: chain && /^\d{1,7}$/.test(chain) ? Number(chain) : null,
    sort: sort && SORTS.some((s) => s.id === sort) ? sort : ("staked" as DirectorySort),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

function writeUrl(s: { q: string; chain: number | null; sort: DirectorySort; page: number }) {
  const url = new URL(window.location.href);
  const set = (k: string, v: string | null) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k));
  set("q", s.q.trim() || null);
  set("chain", s.chain === null ? null : String(s.chain));
  set("sort", s.sort === "staked" ? null : s.sort);
  set("page", s.page > 1 ? String(s.page) : null);
  window.history.replaceState(window.history.state, "", url.toString());
}

function Plan({ s }: { s: SourceView }) {
  return s.kind === "tiered" ? (
    <span className="inline-flex h-[22px] items-center rounded-md bg-accent-soft px-2 text-[11px] font-semibold text-accent">Fixed tiers</span>
  ) : (
    <span className="inline-flex h-[22px] items-center rounded-md bg-cream-3 px-2 text-[11px] font-semibold text-ink-soft">Fee-funded</span>
  );
}

const num = (v: number | null, suffix = "") => (v === null ? "…" : `${fmtShort(v)}${suffix}`);
/** Token bertingkat tidak dibiayai trading: jatahnya ditentukan tingkat stake, jadi kolom ini bilang begitu. */
const funded = (s: SourceView) => (s.kind === "tiered" ? "By tier" : s.budgetTokens === null ? "…" : `${fmtShort(s.budgetTokens)} tokens`);

export default function MarketDirectory({ onOpen }: { onOpen: (s: SourceView, opener: HTMLElement) => void }) {
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState<number | null>(null);
  const [sort, setSort] = useState<DirectorySort>("staked");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = readUrl();
    setQ(s.q);
    setQuery(s.q);
    setChain(s.chain);
    setSort(s.sort);
    setPage(s.page);
    setReady(true);
  }, []);

  // Pencarian menunggu 250 ms sesudah ketikan terakhir, dan selalu kembali ke halaman 1.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      if (q !== query) {
        setQuery(q);
        setPage(1);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, query, ready]);

  useEffect(() => {
    if (!ready) return;
    writeUrl({ q: query, chain, sort, page });
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ sort, page: String(page), limit: String(LIMIT) });
    if (query.trim()) params.set("q", query.trim());
    if (chain !== null) params.set("chain", String(chain));
    fetch(`/api/agent-compute/sources?${params}`, { signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 429 ? "Too many requests. Wait a moment and retry." : `status ${r.status}`);
        return (await r.json()) as DirectoryResponse;
      })
      .then((j) => {
        setData(j);
        if (j.page !== page) setPage(j.page);
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setError((e as Error).message || "The list could not be loaded.");
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [ready, query, chain, sort, page, nonce]);

  // Katalog server baru hidup dan belum selesai membaca chain: tanya lagi sebentar lagi, supaya
  // angka "…" terisi sendiri tanpa pengunjung harus memuat ulang.
  useEffect(() => {
    if (!data?.warming) return;
    const t = setTimeout(() => setNonce((n) => n + 1), 4_000);
    return () => clearTimeout(t);
  }, [data]);

  const go = useCallback((p: number) => {
    setPage(p);
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (data!.page - 1) * data!.limit + 1;
  const to = data ? Math.min(total, data.page * data.limit) : 0;
  const counts = data?.counts ?? {};
  const pages = data?.pages ?? 1;
  const chips: Array<{ id: number | null; label: string; mark: string | null }> = [
    { id: null, label: "All", mark: null },
    ...CHAIN_LIST.map((c) => ({ id: c.chainId, label: c.key, mark: chainMark(c) })),
  ];

  /** Nomor halaman yang ditampilkan: pertama, terakhir, dan dua di sekitar halaman ini. */
  const pageList = (() => {
    const cur = data?.page ?? page;
    const set = new Set([1, pages, cur - 1, cur, cur + 1].filter((n) => n >= 1 && n <= pages));
    const sorted = [...set].sort((a, b) => a - b);
    const out: Array<number | "gap"> = [];
    sorted.forEach((n, i) => {
      if (i > 0 && n - sorted[i - 1] > 1) out.push("gap");
      out.push(n);
    });
    return out;
  })();

  return (
    <div ref={top} className="scroll-mt-24">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search tokens</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value.slice(0, 64))}
            placeholder="Search ticker, name or address"
            autoComplete="off"
            spellCheck={false}
            className="h-11 w-full rounded-xl border border-line-strong bg-cream-2 pl-10 pr-10 text-[16px] text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none sm:text-[14px]"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-faint hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </label>
        {/* Ponsel: chain dan urutan sebagai dua pilihan berdampingan. Grid chip 4 kolom memotong "Monad"
            dan "Robinhood" di 320 px (audit-layout 7 Okt), dan pilihan tetap muat berapa pun jumlah chain.
            Mulai sm: urutan di samping pencarian, chain sebagai chip ber-angka di bawahnya. */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <label className="flex h-11 min-w-0 items-center rounded-xl border border-line-strong bg-cream-2 px-3 text-[14px] text-ink-soft sm:hidden">
            <span className="sr-only">Chain</span>
            <select
              value={chain === null ? "" : String(chain)}
              onChange={(e) => {
                setChain(e.target.value ? Number(e.target.value) : null);
                setPage(1);
              }}
              className="h-full min-w-0 flex-1 cursor-pointer bg-transparent text-[16px] font-semibold text-ink focus:outline-none"
            >
              <option value="">All chains{data ? ` · ${fmt(counts.all ?? 0)}` : ""}</option>
              {CHAIN_LIST.map((c) => (
                <option key={c.chainId} value={String(c.chainId)}>
                  {c.key}
                  {data ? ` · ${fmt(counts[String(c.chainId)] ?? 0)}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-11 min-w-0 items-center gap-2 rounded-xl border border-line-strong bg-cream-2 px-3 text-[14px] text-ink-soft sm:pl-3.5 sm:pr-2">
            <span className="sr-only sm:not-sr-only sm:shrink-0">Sort</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as DirectorySort);
                setPage(1);
              }}
              aria-label="Sort"
              className="h-full min-w-0 flex-1 cursor-pointer bg-transparent text-[16px] font-semibold text-ink focus:outline-none sm:text-[14px]"
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div role="group" aria-label="Filter by chain" className="mt-3 hidden flex-wrap gap-1.5 sm:flex">
        {chips.map((c) => {
          const on = chain === c.id;
          const n = c.id === null ? counts.all : counts[String(c.id)];
          return (
            <button
              key={c.label}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setChain(c.id);
                setPage(1);
              }}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12px] font-medium transition-colors ${
                on ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-cream-2 text-ink-soft hover:text-ink"
              }`}
            >
              {c.mark && (
                // eslint-disable-next-line @next/next/no-img-element -- logo chain statis kecil dari /public
                <img src={c.mark} alt="" aria-hidden="true" className="h-[14px] w-[14px] shrink-0 rounded-sm object-contain" />
              )}
              <span>{c.label}</span>
              {data && <span className={`tabular-nums ${on ? "" : "text-ink-faint"}`}>{fmt(n ?? 0)}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-ink-faint">
        <p aria-live="polite">
          {error
            ? "The list could not be loaded."
            : !data
              ? "Loading tokens…"
              : total === 0
                ? "No token matches."
                : `Showing ${fmt(from)}–${fmt(to)} of ${fmt(total)}`}
        </p>
        {data?.warming && <p>Figures are still loading.</p>}
      </div>

      {error ? (
        <div className="mt-3 rounded-card border border-line bg-surface p-5 text-[14px] text-ink-soft">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="mt-3 inline-flex h-10 items-center rounded-xl border border-line-strong bg-cream-2 px-4 text-[13px] font-semibold text-ink"
          >
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} shape="rect" className="h-[56px] w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="mt-3 rounded-card border border-line bg-surface p-5 text-[14px] text-ink-soft">
          <p>
            No token matches {query.trim() ? <>&ldquo;{query.trim()}&rdquo;</> : "this filter"}
            {chain !== null ? ` on ${CHAIN_LIST.find((c) => c.chainId === chain)?.name ?? "this chain"}` : ""}.
          </p>
          <button
            type="button"
            onClick={() => {
              setQ("");
              setQuery("");
              setChain(null);
              setPage(1);
            }}
            className="mt-3 inline-flex h-10 items-center rounded-xl border border-line-strong bg-cream-2 px-4 text-[13px] font-semibold text-ink"
          >
            Clear search and filters
          </button>
        </div>
      ) : (
        <div className={`mt-3 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {/* Desktop dan tablet: tabel. */}
          <div className="hidden overflow-hidden rounded-card border border-line bg-surface md:block">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-line bg-cream-2 text-[11px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Token</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Chain</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Plan</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Min stake</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Staked</th>
                  <th scope="col" className="hidden px-4 py-2.5 text-right font-semibold lg:table-cell">Stakers</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Compute funded</th>
                  <th scope="col" className="px-4 py-2.5">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0 hover:bg-[var(--row-hover)]">
                    <th scope="row" className="max-w-[240px] px-4 py-3 font-normal">
                      <span className="font-semibold text-ink">${s.symbol}</span>{" "}
                      <span className="truncate text-ink-faint">{s.name}</span>
                    </th>
                    <td className="px-4 py-3">
                      <ChainChip chain={s.chainId} size="sm" variant="plain" />
                    </td>
                    <td className="px-4 py-3">
                      <Plan s={s} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-soft">{fmt(s.minStake)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-soft">{num(s.totalStaked)}</td>
                    <td className="hidden px-4 py-3 text-right font-mono tabular-nums text-ink-soft lg:table-cell">{num(s.stakers)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-soft">{funded(s)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => onOpen(s, e.currentTarget)}
                        aria-label={`Stake $${s.symbol} on ${s.chainName}`}
                        className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-cream-2 px-3 text-[13px] font-semibold text-ink transition-colors hover:border-accent/50 hover:text-accent"
                      >
                        Stake
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ponsel: kartu. */}
          <ul className="space-y-2 md:hidden">
            {data.items.map((s) => (
              <li key={s.id} className="rounded-card border border-line bg-surface p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-2">
                      <span className="text-[15px] font-semibold text-ink">${s.symbol}</span>
                      <ChainChip chain={s.chainId} size="sm" variant="plain" />
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-ink-faint">{s.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => onOpen(s, e.currentTarget)}
                    aria-label={`Stake $${s.symbol} on ${s.chainName}`}
                    className="inline-flex h-10 shrink-0 items-center rounded-lg border border-line-strong bg-cream-2 px-3.5 text-[13px] font-semibold text-ink"
                  >
                    Stake
                  </button>
                </div>
                <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-line pt-2.5 text-[12px]">
                  <div>
                    <dt className="text-ink-faint">Min stake</dt>
                    <dd className="mt-0.5 font-mono text-ink-soft">{fmtShort(s.minStake)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Staked</dt>
                    <dd className="mt-0.5 font-mono text-ink-soft">{num(s.totalStaked)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Compute</dt>
                    <dd className="mt-0.5 font-mono text-ink-soft">{funded(s)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => go(Math.max(1, (data?.page ?? 1) - 1))}
                disabled={(data?.page ?? 1) <= 1}
                className="inline-flex h-10 items-center gap-1 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-ink-soft disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
              </button>
              <ol className="hidden items-center gap-1 sm:flex">
                {pageList.map((n, i) =>
                  n === "gap" ? (
                    <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-ink-faint">
                      …
                    </li>
                  ) : (
                    <li key={n}>
                      <button
                        type="button"
                        onClick={() => go(n)}
                        aria-current={n === data?.page ? "page" : undefined}
                        className={`h-10 min-w-[40px] rounded-xl border px-2 text-[13px] font-semibold tabular-nums ${
                          n === data?.page ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-surface text-ink-soft hover:text-ink"
                        }`}
                      >
                        {n}
                      </button>
                    </li>
                  ),
                )}
              </ol>
              <span className="text-[13px] text-ink-faint sm:hidden">
                Page {data?.page ?? 1} of {pages}
              </span>
              <button
                type="button"
                onClick={() => go(Math.min(pages, (data?.page ?? 1) + 1))}
                disabled={(data?.page ?? 1) >= pages}
                className="inline-flex h-10 items-center gap-1 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-ink-soft disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
