"use client";

import { useEffect, useRef, useState } from "react";
import { Wallet, RefreshCw, ChevronDown } from "lucide-react";
import { formatSmallNumber, formatTokenAmount, formatUsd } from "@/lib/pricing";
import type { PositionReport } from "@/lib/position-server";

/**
 * "Your position": saldo, harga masuk rata-rata, modal, dan PnL dompet yang tersambung, dihitung
 * server dari perdagangan dompet itu sendiri di chain (`/api/market/position`).
 *
 * PnL hanya tampil bila riwayat sejak peluncuran sudah terpindai utuh. Sebelum itu panel
 * mengatakan riwayatnya sedang dibaca — harga masuk dari riwayat yang belum lengkap adalah
 * angka yang salah dengan wajah yang meyakinkan.
 */

const fmtSignedUsd = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatUsd(Math.abs(v))}`;
const fmtSignedNative = (v: number, sym: string) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatSmallNumber(Math.abs(v))} ${sym}`;
const fmtPct = (v: number | null) =>
  v === null || !Number.isFinite(v) ? "" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
const toneOf = (v: number | null | undefined) =>
  v === null || v === undefined || Math.abs(v) < 1e-15 ? "text-ink" : v > 0 ? "text-ok" : "text-danger";

export default function MyPositionPanel({
  symbol,
  chainId,
  wallet,
  refreshKey,
}: {
  symbol: string;
  chainId: number;
  wallet: string;
  /** Berubah sekali per perdagangan pengguna yang terkonfirmasi. */
  refreshKey?: string | null;
}) {
  const [report, setReport] = useState<PositionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inflight = useRef(false);
  /** Tertutup bawaannya: kolom kanan terminal sudah panjang. Saldo ringkas tetap terlihat di kepala panel. */
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetch(
        `/api/market/position?symbol=${encodeURIComponent(symbol)}&chainId=${chainId}&wallet=${encodeURIComponent(wallet)}`
      );
      const json = await res.json();
      if (!res.ok) {
        setError(String(json?.error || `HTTP ${res.status}`));
      } else {
        setReport(json as PositionReport);
        setError(null);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    setReport(null);
    setLoading(true);
    void load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, chainId, wallet]);

  // Sesudah perdagangan: indeks menunggu beberapa konfirmasi, jadi dibaca ulang beberapa kali.
  useEffect(() => {
    if (!refreshKey) return;
    const timers = [3_000, 9_000, 20_000].map((ms) => setTimeout(load, ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const p = report?.position;
  const sym = report?.nativeSymbol ?? "";
  const complete = Boolean(report?.complete);
  const usd = report?.fxNow ?? null;
  const unrealizedUsd = p?.unrealizedUsd ?? null;
  const pnlPct = p ? (p.unrealizedPctUsd ?? p.unrealizedPct) : null;

  const row = "flex items-baseline justify-between gap-3 py-1";
  const label = "text-[11px] text-ink-soft";
  const value = "text-right text-[12px] font-semibold";

  return (
    <div
      className="glass-panel rounded-card border border-line p-4"
      data-testid="my-position"
      data-complete={report ? String(complete) : "unknown"}
      data-balance={p?.balanceTokens ?? ""}
      data-tracked={p?.trackedTokens ?? ""}
      data-untracked={p?.untrackedTokens ?? ""}
      data-cost-native={p?.costNative ?? ""}
      data-avg-native={p?.avgEntryNative ?? ""}
      data-realized-native={p?.realizedNative ?? ""}
      data-unrealized-native={p?.unrealizedNative ?? ""}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="my-position-body"
        className={`flex w-full items-center justify-between gap-2 text-left ${open ? "mb-2 border-b border-line pb-2" : ""}`}
      >
        <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-ink">
          <Wallet className="h-3.5 w-3.5 text-accent" /> Your position
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {report && !complete && report.index ? (
            <span className="flex items-center gap-1 text-[10px] text-warn" title="Reading this market's full history from the chain">
              <RefreshCw className="h-3 w-3 animate-spin" /> history {Math.floor(report.index.progress * 100)}%
            </span>
          ) : p && p.balanceTokens > 0 ? (
            <span className="truncate text-[11px] font-semibold text-ink" data-numeric>
              {formatTokenAmount(p.balanceTokens)} ${symbol}
              {p.valueUsd !== null && <span className="font-normal text-ink-soft"> · {formatUsd(p.valueUsd)}</span>}
            </span>
          ) : report ? (
            <span className="text-[10px] text-ink-faint" title="Every trade since launch has been read from the chain">
              {p && p.buys + p.sells > 0
                ? `${p.buys} buy${p.buys === 1 ? "" : "s"} · ${p.sells} sell${p.sells === 1 ? "" : "s"}`
                : "no trades yet"}
            </span>
          ) : null}
          <ChevronDown className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>

      <div id="my-position-body" hidden={!open}>
      {loading && !report ? (
        <p className="py-3 text-center text-[11px] text-ink-faint">Reading your trades…</p>
      ) : error && !report ? (
        <p className="py-3 text-center text-[11px] text-warn">{error}</p>
      ) : p && p.balanceTokens <= 0 && p.buys + p.sells === 0 ? (
        <p className="py-3 text-center text-[11px] text-ink-soft">You have not traded ${symbol} with this wallet.</p>
      ) : p ? (
        <div className="divide-y divide-line/60" data-numeric>
          <div className={row}>
            <span className={label}>Balance</span>
            <span className={`${value} text-ink`}>
              {formatTokenAmount(p.balanceTokens)} ${symbol}
              {p.valueUsd !== null && <span className="ml-1 font-normal text-ink-soft">· {formatUsd(p.valueUsd)}</span>}
            </span>
          </div>

          {complete ? (
            <>
              <div className={row}>
                <span className={label}>Avg entry</span>
                <span className={`${value} text-ink`} title={p.avgEntryNative !== null ? `${p.avgEntryNative} ${sym} per token` : undefined}>
                  {p.avgEntryUsd !== null
                    ? formatUsd(p.avgEntryUsd)
                    : p.avgEntryNative !== null
                    ? `${formatSmallNumber(p.avgEntryNative)} ${sym}`
                    : "—"}
                </span>
              </div>
              <div className={row}>
                <span className={label}>Cost basis</span>
                <span className={`${value} text-ink`} title={`${p.costNative} ${sym}`}>
                  {p.trackedTokens <= 0
                    ? "—"
                    : p.costUsd !== null
                    ? formatUsd(p.costUsd)
                    : `${formatSmallNumber(p.costNative)} ${sym}`}
                </span>
              </div>
              <div className={row}>
                <span className={label} title="Tokens bought here, valued at the curve's current price, minus what they cost">
                  Unrealized PnL
                </span>
                <span
                  className={`${value} ${toneOf(unrealizedUsd ?? p.unrealizedNative)}`}
                  data-testid="position-unrealized"
                >
                  {p.unrealizedNative === null
                    ? "—"
                    : unrealizedUsd !== null
                    ? fmtSignedUsd(unrealizedUsd)
                    : fmtSignedNative(p.unrealizedNative, sym)}
                  {pnlPct !== null && <span className="ml-1 font-normal">({fmtPct(pnlPct)})</span>}
                </span>
              </div>
              <div className={row}>
                <span className={label} title="Sell proceeds minus the average cost of the tokens sold">
                  Realized PnL
                </span>
                <span className={`${value} ${toneOf(p.realizedUsd ?? p.realizedNative)}`}>
                  {p.sells === 0
                    ? "—"
                    : p.realizedUsd !== null
                    ? fmtSignedUsd(p.realizedUsd)
                    : fmtSignedNative(p.realizedNative, sym)}
                </span>
              </div>
              {report.exitNative !== null && (
                <div className={row}>
                  <span className={label} title="What selling the whole balance would return right now, after every fee and the price impact">
                    Sell all now
                  </span>
                  <span className={`${value} text-ink`}>
                    {formatSmallNumber(report.exitNative)} {sym}
                    {usd !== null && <span className="ml-1 font-normal text-ink-soft">· {formatUsd(report.exitNative * usd)}</span>}
                  </span>
                </div>
              )}
              {p.untrackedTokens > 0 && (
                <p className="pt-1.5 text-[10px] leading-relaxed text-ink-faint" data-testid="position-untracked">
                  {formatTokenAmount(p.untrackedTokens)} ${symbol} came in by transfer, not by a trade here, so they have no entry
                  price and are left out of the PnL.
                </p>
              )}
              {p.soldWithoutEntryTokens > 0 && (
                <p className="pt-1.5 text-[10px] leading-relaxed text-ink-faint">
                  {formatTokenAmount(p.soldWithoutEntryTokens)} ${symbol} sold had no entry price; their proceeds are left out of
                  the realized PnL.
                </p>
              )}
            </>
          ) : (
            <p className="pt-2 text-[10px] leading-relaxed text-ink-faint">
              Entry price and PnL appear once this market's full history has been read from the chain.
            </p>
          )}
        </div>
      ) : null}
      </div>
    </div>
  );
}
