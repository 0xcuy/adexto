"use client";

import { STATS_WINDOWS, type MarketStats } from "@/lib/market-stats";
import { formatSmallNumber, formatUsd } from "@/lib/pricing";

/**
 * Strip statistik di bawah header terminal: perubahan harga per jendela, volume 24 jam,
 * beli/jual, dan trader unik.
 *
 * Angkanya dihitung server dari himpunan perdagangan yang sama dengan feed di bawahnya
 * (`src/lib/market-stats.ts`), jadi strip dan feed tidak bisa saling membantah.
 *
 * SATU SATUAN UNTUK SEMUA JENDELA. Perubahan ditampilkan dalam dolar bila kurs terekam untuk
 * SEMUA jendela, kalau tidak dalam aset native untuk semuanya. Mencampur — 5m dalam dolar,
 * 24h dalam 0G — membuat dua angka bersebelahan tidak bisa dibandingkan, dan tidak ada yang
 * akan membaca keterangan satuannya.
 */

const fmtPct = (v: number | null) => {
  if (v === null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.005) return "0.00%";
  const abs = Math.abs(v);
  const body = abs >= 1000 ? `${Math.round(abs).toLocaleString("en-US")}` : abs.toFixed(2);
  return `${v > 0 ? "+" : "−"}${body}%`;
};

const tone = (v: number | null) =>
  v === null || Math.abs(v) < 0.005 ? "text-ink-soft" : v > 0 ? "text-ok" : "text-danger";

export default function MarketStatsStrip({
  stats,
  loaded,
  nativeSymbol,
  nativeUsd,
}: {
  stats: MarketStats | null;
  loaded: boolean;
  nativeSymbol: string;
  nativeUsd: number;
}) {
  const usdEverywhere = Boolean(stats && STATS_WINDOWS.every((w) => stats.change[w.key].usd !== null));
  // Batas bawah, dinyatakan: riwayat yang terbaca belum terbukti menutup 24 jam penuh.
  const atLeast = stats && !stats.complete ? "≥ " : "";

  const volumeUsd = stats ? stats.volume24h.usd ?? (nativeUsd > 0 ? stats.volume24h.native * nativeUsd : null) : null;
  const buys = stats?.buys24h ?? 0;
  const sells = stats?.sells24h ?? 0;
  const total = buys + sells;

  const cell = "flex min-w-0 flex-col gap-0.5 rounded-xl border border-line bg-surface px-3 py-2";
  const label = "text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint";

  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8"
      data-testid="market-stats"
      data-complete={stats ? String(stats.complete) : "unknown"}
      data-unit={usdEverywhere ? "usd" : "native"}
    >
      {STATS_WINDOWS.map((w) => {
        const c = stats?.change[w.key];
        const shown = c ? (usdEverywhere ? c.usd : c.native) : null;
        const title = c
          ? [
              c.usd !== null ? `${fmtPct(c.usd)} in USD` : null,
              c.native !== null ? `${fmtPct(c.native)} in ${nativeSymbol}` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined;
        return (
          <div key={w.key} className={cell} title={title} data-stat={`change-${w.key}`} data-value={shown ?? ""}>
            <span className={label}>{w.key}</span>
            <span className={`text-sm font-semibold ${loaded ? tone(shown) : "text-ink-faint"}`} data-numeric>
              {loaded ? fmtPct(shown) : "…"}
            </span>
          </div>
        );
      })}

      <div
        className={cell}
        data-stat="volume-24h"
        data-value={stats ? stats.volume24h.native : ""}
        title={stats ? `${formatSmallNumber(stats.volume24h.native)} ${nativeSymbol} traded in the last 24 hours` : undefined}
      >
        <span className={label}>Vol 24h</span>
        <span className="text-sm font-semibold text-ink" data-numeric>
          {!loaded || !stats
            ? "…"
            : `${atLeast}${volumeUsd !== null ? formatUsd(volumeUsd, { compact: true }) : `${formatSmallNumber(stats.volume24h.native)} ${nativeSymbol}`}`}
        </span>
      </div>

      <div
        className={cell}
        data-stat="traders-24h"
        data-value={stats ? stats.traders24h : ""}
        title="Distinct wallets that bought or sold in the last 24 hours. For a relayed buy the wallet that received the tokens counts, not the relayer."
      >
        <span className={label}>Traders 24h</span>
        <span className="text-sm font-semibold text-ink" data-numeric>
          {!loaded || !stats ? "…" : `${atLeast}${stats.traders24h}`}
        </span>
      </div>

      <div className={`${cell} col-span-2`} data-stat="txns-24h" data-buys={buys} data-sells={sells}>
        <span className={label}>Txns 24h</span>
        <span className="flex items-baseline gap-2 text-sm font-semibold" data-numeric>
          {!loaded || !stats ? (
            <span className="text-ink-faint">…</span>
          ) : (
            <>
              <span className="text-ok">
                {atLeast}
                {buys} buys
              </span>
              <span className="text-danger">{sells} sells</span>
            </>
          )}
        </span>
        {/* Rasio beli/jual sebagai batang, supaya condongnya terbaca sekilas. */}
        <div className="mt-0.5 flex h-1 w-full overflow-hidden rounded-full bg-cream-3" aria-hidden="true">
          {total > 0 && (
            <>
              <div className="h-full bg-ok" style={{ width: `${(buys / total) * 100}%` }} />
              <div className="h-full bg-danger" style={{ width: `${(sells / total) * 100}%` }} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
