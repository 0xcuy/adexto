"use client";

import { useEffect, useState } from "react";
import { Flame, Activity, ExternalLink, Info } from "lucide-react";
import { explorerTxUrl } from "@/lib/chains";

/**
 * Trade feed backed by the same telemetry endpoint as the chart.
 *
 * Changes: fills are labelled by source, so genesis seeds are never presented as
 * live market activity; the explorer link is built from the trade's own chainId
 * instead of a `chain.includes("Arbitrum")` string test; and amounts are formatted
 * from numbers rather than pre-baked display strings.
 */

interface Trade {
  id: string;
  txHash: string;
  type: "BUY" | "SELL" | "AUTO_BUYBACK";
  symbol: string;
  amountToken: number;
  amountNative: number;
  nativeSymbol: string;
  priceNative: number;
  trader: string;
  timestamp: string;
  chainId: number;
  source: "onchain" | "agent" | "genesis";
}

const fmtToken = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2);

function ago(timestamp: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export default function LiveTradeFeed({
  symbol,
  chainId,
  nativeUsd,
}: {
  symbol: string;
  /** Which chain's fills to show — each chain has its own pool and history. */
  chainId: number;
  nativeUsd: number;
}) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [source, setSource] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/agent/telemetry?symbol=${encodeURIComponent(symbol)}&chainId=${chainId}`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setTrades(Array.isArray(json.trades) ? json.trades : []);
        setSource(String(json.source || ""));
      } catch {
        // keep previous
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    const timer = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol, chainId]);

  const isLive = source === "onchain";

  return (
    <div className="w-full h-full flex flex-col font-mono text-[11px]">
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <Activity className={`w-3.5 h-3.5 ${isLive ? "text-emerald-400 animate-pulse" : "text-amber-400"}`} />
          <span className="text-white font-bold text-[10px] uppercase">Trade Feed</span>
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
            isLive
              ? "text-emerald-400 bg-emerald-950/80 border-emerald-500/40"
              : "text-amber-300 bg-amber-950/60 border-amber-500/40"
          }`}
        >
          {isLive ? "● on-chain" : source === "agent" ? "agent log" : source === "genesis" ? "genesis reference" : "no fills"}
        </span>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[170px] pr-1">
        {!loaded ? (
          <div className="h-full flex items-center justify-center text-zinc-500 text-[11px]">Loading…</div>
        ) : trades.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center px-3">
            <Info className="w-4 h-4 text-zinc-500" />
            <span className="text-zinc-400 text-[10px]">No trades recorded for ${symbol} yet.</span>
          </div>
        ) : (
          trades.slice(0, 12).map((t) => (
            <div
              key={t.id}
              className={`p-1.5 rounded-xl border flex items-center justify-between gap-2 ${
                t.type === "AUTO_BUYBACK"
                  ? "bg-purple-950/30 border-purple-500/40"
                  : t.type === "BUY"
                  ? "bg-emerald-950/20 border-emerald-500/30"
                  : "bg-red-950/20 border-red-500/30"
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {t.type === "AUTO_BUYBACK" ? (
                  <span className="px-1.5 rounded bg-pink-950 text-pink-400 border border-pink-500/40 font-black text-[9px] flex items-center gap-0.5 shrink-0">
                    <Flame className="w-2.5 h-2.5" /> BURN
                  </span>
                ) : (
                  <span
                    className={`px-1.5 rounded font-black text-[9px] border shrink-0 ${
                      t.type === "BUY"
                        ? "bg-emerald-950 text-emerald-400 border-emerald-500/40"
                        : "bg-red-950 text-red-400 border-red-500/40"
                    }`}
                  >
                    {t.type}
                  </span>
                )}
                <span className="font-bold text-white text-[10px] truncate">
                  {fmtToken(t.amountToken)} ${t.symbol}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-zinc-300 text-[10px]">
                  {t.amountNative.toFixed(4)} {t.nativeSymbol}
                  {nativeUsd > 0 ? ` · $${(t.amountNative * nativeUsd).toFixed(2)}` : ""}
                </span>
                <span className="text-zinc-600 text-[9px]">{ago(t.timestamp)}</span>
                {t.source === "genesis" ? (
                  <span className="text-zinc-600 text-[9px]">reference</span>
                ) : (
                  <a
                    href={explorerTxUrl(t.chainId, t.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:underline text-[9px] flex items-center gap-0.5"
                  >
                    {t.txHash.slice(0, 6)}
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
