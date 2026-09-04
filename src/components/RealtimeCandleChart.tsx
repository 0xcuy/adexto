"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, IChartApi } from "lightweight-charts";
import { formatSmallNumber } from "@/lib/pricing";

/**
 * Candlestick chart driven by real OHLC buckets from /api/agent/telemetry.
 *
 * Previous behaviour and why it was broken:
 *   - it built 31 candles with `open = high = low = close = basePriceUSD`, so every
 *     market rendered a perfectly flat line;
 *   - the live poll called `series.update()` with the timestamp of the newest
 *     telemetry record. lightweight-charts rejects an update older than the last
 *     bar, the throw was swallowed by a bare `catch`, and the price never moved
 *     (QNOVA stayed at $0.000180 while telemetry reported $0.2920);
 *   - the "+14.8%" badge was a hardcoded `useState(14.8)` for every token.
 *
 * Now the series is replaced with `setData` on every poll (monotonic by
 * construction), the change percentage comes from the data, and a volume
 * histogram is drawn from the same buckets.
 */

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  symbol: string;
  /** Which chain's market to chart — a ticker can exist on several chains. */
  chainId: number;
  /** Native-denominated fallback price used only when there is no trade history. */
  fallbackPriceNative: number;
  nativeSymbol: string;
  /** USD value of one native unit, for the header readout. */
  nativeUsd: number;
  poolLive: boolean;
}

const INTERVALS = [
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3600 },
];

export default function RealtimeCandleChart({
  symbol,
  chainId,
  fallbackPriceNative,
  nativeSymbol,
  nativeUsd,
  poolLive,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);

  const [interval, setIntervalSeconds] = useState(300);
  const [priceNative, setPriceNative] = useState(fallbackPriceNative);
  const [changePct, setChangePct] = useState(0);
  const [source, setSource] = useState<string>("");
  const [tradeCount, setTradeCount] = useState(0);

  // Chart instance is created once per container, not per data refresh.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#030610" },
        textColor: "#94a3b8",
        fontSize: 11,
        fontFamily: "monospace",
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.04)" },
        horzLines: { color: "rgba(255, 255, 255, 0.04)" },
      },
      crosshair: {
        vertLine: { color: "#00F5FF", width: 1, style: 3 },
        horzLine: { color: "#00F5FF", width: 1, style: 3 },
      },
      timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)", scaleMargins: { top: 0.1, bottom: 0.28 } },
      width: containerRef.current.clientWidth,
      height: 340,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
      priceFormat: { type: "price", precision: 8, minMove: 0.00000001 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "rgba(56, 189, 248, 0.35)",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Data refresh. `setData` replaces the whole series, so ordering is always valid.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/agent/telemetry?symbol=${encodeURIComponent(symbol)}&chainId=${chainId}&bucket=${interval}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        const candles: Candle[] = Array.isArray(data.candles) ? data.candles : [];
        setSource(String(data.source || ""));
        setTradeCount(Number(data.totalTrades || 0));

        if (candles.length > 0 && candleSeriesRef.current) {
          const sorted = [...candles].sort((a, b) => a.time - b.time);
          candleSeriesRef.current.setData(
            sorted.map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close }))
          );
          volumeSeriesRef.current?.setData(
            sorted.map((c) => ({
              time: c.time as any,
              value: c.volume,
              color: c.close >= c.open ? "rgba(16,185,129,0.35)" : "rgba(244,63,94,0.35)",
            }))
          );
        }

        /**
         * The header reads the API's numbers instead of recomputing them from the
         * candles.
         *
         * It used to derive the price from `last.close` and the change from
         * `first.open`, which made this component a third, independent definition of
         * "the price" alongside the API and the on-chain spot price in the trade
         * panel — and it inherited any candle bug directly into the headline figure.
         * The API now reports the curve's post-trade spot price and measures change
         * from the launch price, so there is one definition and the panel agrees
         * with it.
         */
        if (Number.isFinite(data.priceNative) && data.priceNative > 0) {
          setPriceNative(data.priceNative);
          setChangePct(Number(data.changePct) || 0);
        }
      } catch {
        // leave the last rendered state in place
      }
    }

    load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol, chainId, interval]);

  const priceUsd = priceNative * (nativeUsd || 0);
  const changeIsUp = changePct >= 0;

  // Kata "seed" dihindari di label ini: di produk ini kata itu dulu berarti
  // setoran likuiditas yang sudah ditiadakan, jadi memakainya untuk sumber data
  // placeholder membuat pembaca menyangka kurvanya disetori.
  const sourceLabel =
    source === "onchain"
      ? "on-chain Swap events"
      : source === "agent"
      ? "agent-reported fills"
      : source === "genesis"
      ? "genesis reference price (no market fills yet)"
      : "no trade history";

  return (
    <div className="w-full flex flex-col h-full justify-between">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-1 border-b border-line shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-base sm:text-lg font-semibold text-ink font-mono flex items-center gap-2">
            <span>
              ${symbol}/{nativeSymbol}
            </span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded border ${
                changeIsUp
                  ? "text-ok bg-ok/10 border-ok/30"
                  : "text-danger bg-danger/10 border-danger/30"
              }`}
            >
              {changeIsUp ? "+" : ""}
              {changePct.toFixed(2)}%
            </span>
          </div>
          <span className="text-xs sm:text-sm font-mono text-accent font-bold">
            {priceNative > 0 ? formatSmallNumber(priceNative) : "—"} {nativeSymbol}
          </span>
          {priceUsd > 0 && (
            <span className="text-[11px] font-mono text-ink-soft">
              ≈ ${priceUsd < 0.01 ? priceUsd.toFixed(6) : priceUsd.toFixed(4)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 font-mono text-[10px]">
          {INTERVALS.map((i) => (
            <button
              key={i.label}
              type="button"
              onClick={() => setIntervalSeconds(i.seconds)}
              className={`px-2 py-0.5 rounded font-bold border transition-colors ${
                interval === i.seconds
                  ? "bg-accent-soft text-accent border-accent/30"
                  : "bg-cream-3 text-ink-soft border-transparent hover:text-ink"
              }`}
            >
              {i.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="w-full flex-1 min-h-[300px] overflow-hidden rounded-xl" />

      <div className="pt-1.5 flex items-center justify-between text-[10px] font-mono text-ink-faint shrink-0">
        <span>
          Source: <span className={source === "onchain" ? "text-ok" : "text-warn"}>{sourceLabel}</span>
          {tradeCount > 0 ? ` · ${tradeCount} fills` : ""}
        </span>
        <span className={poolLive ? "text-ok" : "text-warn"}>
          {poolLive ? "pool live" : "pool not tradable"}
        </span>
      </div>
    </div>
  );
}
