"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock, Crown, Sparkles, ChevronRight } from "lucide-react";
import { CHAIN_LIST, resolveChainOrDefault } from "@/lib/chains";
import { STABLE_PRICES, assetPriceUsd, formatSmallNumber, formatUsd, type AssetPrices } from "@/lib/pricing";

/**
 * Pasar yang hidup, langsung di halaman depan.
 *
 * Membaca endpoint yang SAMA dengan /explorer (`/api/graphql` + `/api/prices`), hanya-baca,
 * tanpa logika baru. Yang ditampilkan hanya yang benar-benar ada di registry: tidak ada
 * perubahan 24 jam atau volume, karena registry tidak menyimpannya dan angka karangan di
 * halaman depan adalah cacat yang sudah pernah dicabut dari situs ini.
 */

type Row = {
  key: string;
  name: string;
  symbol: string;
  slug: string;
  chainId: number;
  image: string;
  priceNative: number;
  supply: number;
  deployedAt: number;
  tradable: boolean;
  verified: boolean;
};

type Sort = "newest" | "largest";

function age(seconds: number): string {
  if (!seconds) return "—";
  const d = Math.max(0, Date.now() / 1000 - seconds);
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 86400 * 60) return `${Math.floor(d / 86400)}d`;
  return `${Math.floor(d / (86400 * 30))}mo`;
}

export default function LiveMarkets({ limit = 6 }: { limit?: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [prices, setPrices] = useState<AssetPrices>(STABLE_PRICES);
  const [sort, setSort] = useState<Sort>("largest");
  const [chain, setChain] = useState<number | "all">("all");

  /**
   * Kurs native/USD disegarkan; daftar pasarnya tidak.
   *
   * Dulu keduanya dibaca sekali saja, jadi kolom harga USD di beranda membeku pada nilai
   * saat halaman dibuka — padahal harga token dalam USD adalah harga native x kurs, jadi
   * ia bergerak setiap kali 0G bergerak walau tidak ada fill baru. Yang diulang hanya
   * `/api/prices`: daftar pasar berubah saat ada peluncuran baru, bukan tiap belasan
   * detik, dan membacanya ulang terus-menerus akan memuat registry tanpa alasan.
   */
  useEffect(() => {
    let cancelled = false;
    const loadPrices = async () => {
      try {
        const p = await fetch("/api/prices").then((r) => r.json());
        if (!cancelled && p?.prices) setPrices({ ...STABLE_PRICES, ...p.prices });
      } catch {
        // kurs sebelumnya dipertahankan
      }
    };
    const timer = setInterval(loadPrices, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [g, p] = await Promise.all([
          fetch("/api/graphql", { method: "POST" }).then((r) => r.json()),
          fetch("/api/prices").then((r) => r.json()).catch(() => null),
        ]);
        if (cancelled) return;
        if (p?.prices) setPrices({ ...STABLE_PRICES, ...p.prices });
        setRows(
          (g?.data?.projects ?? []).map((x: any) => ({
            key: String(x.marketKey ?? `${x.chainId}:${x.symbol}`),
            name: String(x.name),
            symbol: String(x.symbol).toUpperCase(),
            slug: String(x.slug ?? x.symbol).toLowerCase(),
            chainId: Number(x.chainId),
            image: x.image ?? "/logo.svg",
            priceNative: Number(x.priceNative) || 0,
            supply: Number(x.supply) || 0,
            deployedAt: Number(x.deployedAt) || 0,
            tradable: Boolean(x.tradable),
            verified: Boolean(x.verified),
          }))
        );
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const view = useMemo(() => {
    if (!rows) return [];
    const withUsd = rows
      .filter((r) => chain === "all" || r.chainId === chain)
      .map((r) => {
        const c = resolveChainOrDefault(r.chainId);
        const priceUsd = r.priceNative * assetPriceUsd(c.nativeSymbol, prices);
        return { ...r, chainName: c.key, nativeSymbol: c.nativeSymbol, priceUsd, mcapUsd: priceUsd * r.supply };
      });
    withUsd.sort((a, b) => (sort === "newest" ? b.deployedAt - a.deployedAt : b.mcapUsd - a.mcapUsd));
    return withUsd.slice(0, limit);
  }, [rows, prices, sort, chain, limit]);

  const tabs: Array<{ id: Sort; label: string; icon: typeof Crown }> = [
    { id: "largest", label: "Largest", icon: Crown },
    { id: "newest", label: "Newest", icon: Sparkles },
  ];

  return (
    <div className="glass-panel rounded-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[22px] font-medium tracking-tight text-ink">Live markets</h2>
        <div className="flex items-center gap-1 rounded-full border border-line bg-cream-2 p-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSort(id)}
              aria-pressed={sort === id}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                sort === id ? "bg-cream-3 text-ink" : "text-ink-soft hover:text-ink"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(["all", ...CHAIN_LIST.map((c) => c.chainId)] as const).map((id) => {
          const label = id === "all" ? "All chains" : resolveChainOrDefault(id as number).key;
          const active = chain === id;
          return (
            <button
              key={String(id)}
              type="button"
              onClick={() => setChain(id as number | "all")}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                active ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-ink-soft hover:text-ink"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Kepala kolom — desktop saja. Di ponsel tiap baris jadi kartu ringkas. */}
      <div className="mt-5 hidden grid-cols-[minmax(0,2.2fr)_1fr_1.2fr_1fr_0.6fr_auto] gap-3 border-b border-line px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint md:grid">
        <span>Market</span>
        <span>Chain</span>
        <span className="text-right">Price</span>
        <span className="text-right">Market cap</span>
        <span className="text-right">Age</span>
        <span className="w-[72px]" />
      </div>

      <ul className="mt-2 md:mt-0">
        {rows === null && !failed &&
          Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 border-b border-line/60 px-2 py-4 last:border-0">
              <span className="skeleton h-9 w-9 !rounded-xl" />
              <span className="skeleton h-3 w-32" />
              <span className="skeleton ml-auto h-3 w-20" />
            </li>
          ))}

        {failed && <li className="py-8 text-center text-sm text-ink-soft">The market registry did not answer. Try again in a moment.</li>}

        {rows !== null && view.length === 0 && (
          <li className="py-8 text-center text-sm text-ink-soft">No market on this chain yet — be the first.</li>
        )}

        {view.map((r) => (
          <li key={r.key} className="border-b border-line/60 last:border-0">
            <Link
              href={`/token/${r.slug}?chain=${r.chainId}`}
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-cream-3/60 md:grid-cols-[minmax(0,2.2fr)_1fr_1.2fr_1fr_0.6fr_auto]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <img src={r.image} alt="" className="h-9 w-9 shrink-0 rounded-xl border border-line object-cover" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-ink">{r.name}</span>
                  <span className="block text-[11px] text-ink-faint">
                    ${r.symbol}
                    <span className="md:hidden"> · {r.chainName}</span>
                  </span>
                </span>
              </span>
              <span className="hidden text-[12px] text-ink-soft md:block">{r.chainName}</span>
              <span className="hidden text-right md:block" data-numeric>
                <span className="block text-[13px] font-medium text-ink">{r.priceUsd > 0 ? formatUsd(r.priceUsd) : "—"}</span>
                <span className="block text-[10px] text-ink-faint">
                  {r.priceNative > 0 ? `${formatSmallNumber(r.priceNative)} ${r.nativeSymbol}` : ""}
                </span>
              </span>
              <span className="hidden text-right text-[13px] text-ink md:block" data-numeric>
                {r.mcapUsd > 0 ? formatUsd(r.mcapUsd, { compact: true }) : "—"}
              </span>
              <span className="hidden items-center justify-end gap-1 text-[12px] text-ink-soft md:flex">
                <Clock className="h-3 w-3" /> {age(r.deployedAt)}
              </span>
              <span className="flex items-center justify-end gap-3">
                <span className="text-right md:hidden" data-numeric>
                  <span className="block text-[13px] font-medium text-ink">{r.priceUsd > 0 ? formatUsd(r.priceUsd) : "—"}</span>
                  <span className="block text-[10px] text-ink-faint">
                    {r.mcapUsd > 0 ? `mcap ${formatUsd(r.mcapUsd, { compact: true })}` : ""}
                  </span>
                </span>
                <span
                  className={`inline-flex w-[72px] items-center justify-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    r.tradable
                      ? "border-accent/40 bg-accent-soft text-accent group-hover:bg-accent group-hover:text-white"
                      : "border-line text-ink-soft"
                  }`}
                >
                  {r.tradable ? "trade" : "view"} <ChevronRight className="h-3 w-3" />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <Link
        href="/explorer"
        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12px] font-medium text-ink transition-colors hover:border-accent/40 hover:text-accent"
      >
        View all markets <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
