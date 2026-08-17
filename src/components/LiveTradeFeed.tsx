"use client";

import { useState, useEffect } from "react";
import { ArrowUpRight, Flame, ShieldCheck, Activity, RefreshCw, ExternalLink } from "lucide-react";

interface LiveTrade {
  id: string;
  txHash: string;
  type: "BUY" | "SELL" | "AUTO_BUYBACK";
  symbol: string;
  amountToken: string;
  amountNative: string;
  amountUSD: string;
  priceUSD: string;
  trader: string;
  timestamp: string;
  chain: string;
}

export default function LiveTradeFeed({ symbol }: { symbol: string }) {
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [isLive, setIsLive] = useState(true);

  useEffect(() => {
    async function fetchLiveFeed() {
      try {
        const res = await fetch(`/api/agent/telemetry?symbol=${symbol}`);
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.trades)) {
            setTrades(json.trades);
          }
        }
      } catch (e) {
        console.warn("Feed fetch note:", e);
      }
    }

    fetchLiveFeed();
    const interval = setInterval(fetchLiveFeed, 3000); // Poll every 3 seconds for active trading action
    return () => clearInterval(interval);
  }, [symbol]);

  return (
    <div className="w-full h-full flex flex-col justify-between font-mono text-[11px]">
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span className="text-white font-bold text-[10px] uppercase">Live Autonomous Activity</span>
        </div>
        <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/40">
          ● 0G TEE Active
        </span>
      </div>

      {/* Trades Stream */}
      <div className="space-y-1.5 overflow-y-auto max-h-[160px] pr-1">
        {trades.slice(0, 6).map((t) => (
          <div
            key={t.id}
            className={`p-1.5 rounded-xl border flex items-center justify-between transition-all ${
              t.type === "AUTO_BUYBACK"
                ? "bg-purple-950/30 border-purple-500/40 text-purple-200"
                : t.type === "BUY"
                ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                : "bg-red-950/20 border-red-500/30 text-red-300"
            }`}
          >
            <div className="flex items-center gap-1.5">
              {t.type === "AUTO_BUYBACK" ? (
                <span className="px-1.5 py-0.2 rounded bg-pink-950 text-pink-400 border border-pink-500/40 font-black text-[9px] flex items-center gap-0.5">
                  <Flame className="w-2.5 h-2.5" /> BUYBACK
                </span>
              ) : (
                <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/40 font-black text-[9px]">
                  {t.type}
                </span>
              )}
              <span className="font-bold text-white text-[10px]">{t.amountToken} ${t.symbol}</span>
            </div>

            <div className="flex items-center gap-2 text-right">
              <span className="text-zinc-300 text-[10px]">{t.amountUSD}</span>
              <a
                href={t.chain.includes("Arbitrum") ? `https://arbiscan.io/tx/${t.txHash}` : `https://chainscan.0g.ai/tx/${t.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline text-[9px]"
              >
                {t.txHash.slice(0, 6)}...
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
