"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, Info } from "lucide-react";
import { formatSmallNumber } from "@/lib/pricing";

/**
 * AMM depth ladder derived from the pool's real reserves.
 *
 * The old version generated a ladder from `basePriceUSD * (1 ± i * 0.002)` with a
 * flat 10k-per-level size and a hardcoded "Spread: 0.02%", regardless of whether a
 * pool existed. Levels are now computed with the same constant-product formula the
 * contract uses, so the prices shown are the prices a trade of that size would
 * actually clear at. When there is no executable pool the component says so
 * instead of inventing depth.
 */

interface Props {
  symbol: string;
  /** Which chain's pool to read — each chain has its own reserves. */
  chainId: number;
  nativeSymbol: string;
  nativeUsd: number;
}

interface PoolInfo {
  tradable: boolean;
  reason: string | null;
  reserveNative?: string;
  reserveToken?: string;
  spotPriceNative?: number;
  lpFeeBps?: number;
  treasuryBuybackBps?: number;
}

interface Level {
  priceNative: number;
  sizeToken: number;
  cumulativeToken: number;
  notionalNative: number;
}

const STEPS = [0.0025, 0.005, 0.01, 0.02, 0.04];

export default function LiveOrderBook({ symbol, chainId, nativeSymbol, nativeUsd }: Props) {
  const [pool, setPool] = useState<PoolInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/pool?symbol=${encodeURIComponent(symbol)}&chainId=${chainId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPool(data);
      } catch {
        // keep previous state
      }
    }
    load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol, chainId]);

  const { asks, bids, spreadPct, spot } = useMemo(() => {
    const reserveNative = Number(pool?.reserveNative ?? 0);
    const reserveToken = Number(pool?.reserveToken ?? 0);
    const feeBps = Number(pool?.lpFeeBps ?? 20) + Number(pool?.treasuryBuybackBps ?? 10);

    if (!pool?.tradable || reserveNative <= 0 || reserveToken <= 0) {
      return { asks: [] as Level[], bids: [] as Level[], spreadPct: 0, spot: 0 };
    }

    const spotPrice = reserveNative / reserveToken;

    // Buy side: spend a share of the native reserve, see the clearing price.
    const askLevels: Level[] = [];
    let askCumulative = 0;
    for (const step of STEPS) {
      const nativeIn = reserveNative * step;
      const afterFee = nativeIn * (1 - feeBps / 10000);
      const tokensOut = (reserveToken * afterFee) / (reserveNative + afterFee);
      if (tokensOut <= 0) continue;
      askCumulative += tokensOut;
      askLevels.push({
        priceNative: nativeIn / tokensOut,
        sizeToken: tokensOut,
        cumulativeToken: askCumulative,
        notionalNative: nativeIn,
      });
    }

    // Sell side: offload a share of the token reserve.
    const bidLevels: Level[] = [];
    let bidCumulative = 0;
    for (const step of STEPS) {
      const tokenIn = reserveToken * step;
      const grossOut = (reserveNative * tokenIn) / (reserveToken + tokenIn);
      const nativeOut = grossOut * (1 - feeBps / 10000);
      if (nativeOut <= 0) continue;
      bidCumulative += tokenIn;
      bidLevels.push({
        priceNative: nativeOut / tokenIn,
        sizeToken: tokenIn,
        cumulativeToken: bidCumulative,
        notionalNative: nativeOut,
      });
    }

    const bestAsk = askLevels[0]?.priceNative ?? spotPrice;
    const bestBid = bidLevels[0]?.priceNative ?? spotPrice;
    const spread = bestAsk > 0 ? ((bestAsk - bestBid) / bestAsk) * 100 : 0;

    return { asks: askLevels.reverse(), bids: bidLevels, spreadPct: spread, spot: spotPrice };
  }, [pool]);

  const fmtPrice = (v: number) => formatSmallNumber(v);
  const fmtSize = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(2);

  const maxSize = Math.max(...asks.map((a) => a.sizeToken), ...bids.map((b) => b.sizeToken), 1);

  return (
    <div className="w-full h-full flex flex-col font-mono text-[11px]">
      <div className="flex items-center justify-between border-b border-line pb-2 mb-2 shrink-0">
        <span className="text-ink-soft font-bold text-[10px] uppercase">Curve depth ladder</span>
        {asks.length > 0 && <span className="text-ink-faint text-[10px]">Spread: {spreadPct.toFixed(2)}%</span>}
      </div>

      {!pool ? (
        <div className="flex-1 flex items-center justify-center text-ink-faint text-[11px]">Loading pool state…</div>
      ) : !pool.tradable ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-3">
          <Info className="w-4 h-4 text-warn" />
          <span className="text-warn font-bold text-[10px] uppercase">No executable pool</span>
          <span className="text-ink-soft text-[10px] leading-relaxed">{pool.reason}</span>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-between">
          <div className="space-y-1">
            {asks.map((a, idx) => (
              <div key={`ask-${idx}`} className="flex justify-between items-center py-0.5 px-1 rounded bg-danger/10 relative overflow-hidden">
                <div
                  className="absolute right-0 top-0 bottom-0 bg-danger/10 pointer-events-none"
                  style={{ width: `${Math.min(100, (a.sizeToken / maxSize) * 100)}%` }}
                />
                <span className="text-danger font-semibold relative z-10">{fmtPrice(a.priceNative)}</span>
                <span className="text-ink-soft relative z-10">{fmtSize(a.sizeToken)}</span>
                <span className="text-ink-faint text-[10px] relative z-10">
                  {a.notionalNative.toFixed(4)} {nativeSymbol}
                </span>
              </div>
            ))}
          </div>

          <div className="my-1.5 py-1 px-2 rounded-lg bg-white border border-accent/30 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-accent">
              <ArrowUp className="w-3.5 h-3.5 text-ok" />
              <span>{fmtPrice(spot)}</span>
              <span className="text-[9px] text-ink-faint font-normal">{nativeSymbol}</span>
            </div>
            <span className="text-[10px] text-ink-soft">
              {nativeUsd > 0 ? `≈ $${(spot * nativeUsd).toFixed(6)}` : ""}
            </span>
          </div>

          <div className="space-y-1">
            {bids.map((b, idx) => (
              <div key={`bid-${idx}`} className="flex justify-between items-center py-0.5 px-1 rounded bg-ok/10 relative overflow-hidden">
                <div
                  className="absolute right-0 top-0 bottom-0 bg-ok/10 pointer-events-none"
                  style={{ width: `${Math.min(100, (b.sizeToken / maxSize) * 100)}%` }}
                />
                <span className="text-ok font-semibold relative z-10">{fmtPrice(b.priceNative)}</span>
                <span className="text-ink-soft relative z-10">{fmtSize(b.sizeToken)}</span>
                <span className="text-ink-faint text-[10px] relative z-10">
                  {b.notionalNative.toFixed(4)} {nativeSymbol}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-2 mt-1 border-t border-line flex items-center justify-between text-[9px] text-ink-faint">
            <span className="flex items-center gap-1">
              <ArrowDown className="w-2.5 h-2.5" /> Reserves
            </span>
            <span>
              {Number(pool.reserveNative).toFixed(4)} {nativeSymbol} / {fmtSize(Number(pool.reserveToken))} {symbol}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
