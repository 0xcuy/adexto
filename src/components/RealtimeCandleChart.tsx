"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  IChartApi,
} from "lightweight-charts";
import { formatSmallNumber } from "@/lib/pricing";
import { computeIndicators, toLineData, WARMUP, type Ohlc } from "@/lib/indicators";

/**
 * Candlestick chart with indicators, driven by real OHLC buckets from
 * /api/agent/telemetry.
 *
 * WHY THE INDICATORS ARE OURS AND NOT AN EMBED
 *
 * A TradingView or GeckoTerminal embed resolves a symbol or pool from that
 * provider's database. A token launched minutes ago on our own factory is not in
 * either, so an embed renders an empty frame — which is why the reference
 * screenshots show TIBBIR (listed on MEXC and Uniswap V2) rather than anything of
 * ours. `lightweight-charts` is TradingView's renderer but ships no indicators, so
 * they are computed in @/lib/indicators from the same candles the chart draws.
 *
 * WHAT THIS COMPONENT REFUSES TO DO
 *
 * It does not draw an indicator that does not have enough data yet. RSI(14) needs
 * 15 bars and MACD needs 34; below that the series is a gap and the footer says how
 * many bars are still missing. A half-warmed average rendered as a solid line is
 * the same class of lie as an invented candle.
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
  { label: "4h", seconds: 14400 },
];

/**
 * Overlay indicators share the price scale; RSI and MACD cannot, since one is
 * bounded 0..100 and the other oscillates around zero. Those get their own pane.
 */
type OverlayKey = "ema9" | "ema21" | "sma50" | "bollinger" | "vwap";
type PaneKey = "rsi14" | "macd";
type IndicatorKey = OverlayKey | PaneKey;

const OVERLAYS: Array<{ key: OverlayKey; label: string; color: string; warmupKey: string }> = [
  { key: "ema9", label: "EMA 9", color: "#38bdf8", warmupKey: "ema9" },
  { key: "ema21", label: "EMA 21", color: "#a78bfa", warmupKey: "ema21" },
  { key: "sma50", label: "SMA 50", color: "#fbbf24", warmupKey: "sma50" },
  { key: "bollinger", label: "Bollinger 20,2", color: "#94a3b8", warmupKey: "bollinger" },
  { key: "vwap", label: "VWAP", color: "#f472b6", warmupKey: "vwap" },
];

const PANES: Array<{ key: PaneKey; label: string; warmupKey: string }> = [
  { key: "rsi14", label: "RSI 14", warmupKey: "rsi14" },
  { key: "macd", label: "MACD 12,26,9", warmupKey: "macd" },
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
  /** Indicator series are created and destroyed as they are toggled. */
  const overlayRefs = useRef<Partial<Record<string, any>>>({});
  const paneRefs = useRef<Partial<Record<string, any>>>({});
  const candlesRef = useRef<Candle[]>([]);
  /**
   * Whether the visible range has been fitted for the current symbol/timeframe.
   *
   * `setData` does not adjust the visible range, so a market with only a handful of
   * bars renders them squeezed against the right edge with an empty pane to the
   * left — which reads as a broken chart. Fitting solves that, but fitting on every
   * 15-second poll would yank the view back and undo any pan or zoom the user just
   * made, so it happens once per symbol/chain/timeframe.
   */
  const fittedFor = useRef<string>("");

  const [interval, setIntervalSeconds] = useState(300);
  const [priceNative, setPriceNative] = useState(fallbackPriceNative);
  const [changePct, setChangePct] = useState(0);
  const [source, setSource] = useState<string>("");
  const [tradeCount, setTradeCount] = useState(0);
  const [candleCount, setCandleCount] = useState(0);
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
  const [enabled, setEnabled] = useState<Record<IndicatorKey, boolean>>({
    ema9: true,
    ema21: true,
    sma50: false,
    bollinger: false,
    vwap: false,
    rsi14: true,
    macd: false,
  });
  /** OHLC values under the crosshair, like the legend GeckoTerminal shows. */
  const [legend, setLegend] = useState<Candle | null>(null);

  const enabledKey = JSON.stringify(enabled);

  // Chart instance is created once per container, not per data refresh.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#030610" },
        textColor: "#94a3b8",
        fontSize: 11,
        fontFamily: "monospace",
        panes: { separatorColor: "rgba(255,255,255,0.12)", separatorHoverColor: "rgba(0,245,255,0.25)" },
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
      /**
       * A custom formatter, because a curve opens around 1e-9 of the native asset
       * and the built-in price format with 8 decimals rendered every axis label as
       * "0.00000000" — a price scale that showed nothing at all. `formatSmallNumber`
       * is the same subscript notation the rest of the app uses, so the axis, the
       * header and the trade panel read alike.
       *
       * Per-series on purpose: a chart-wide `localization.priceFormatter` would also
       * capture the RSI pane, where 0..100 values need no such treatment.
       */
      priceFormat: { type: "custom", formatter: (p: number) => formatSmallNumber(p), minMove: 1e-12 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "rgba(56, 189, 248, 0.35)",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    // The legend follows the crosshair, and falls back to the newest bar when the
    // pointer leaves the chart so the row is never blank.
    chart.subscribeCrosshairMove((param) => {
      const list = candlesRef.current;
      if (!param.time) {
        setLegend(list.length ? list[list.length - 1] : null);
        return;
      }
      const hit = list.find((c) => c.time === (param.time as unknown as number));
      setLegend(hit ?? (list.length ? list[list.length - 1] : null));
    });

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
      overlayRefs.current = {};
      paneRefs.current = {};
    };
  }, []);

  /**
   * Draw the indicators. Runs whenever the data or the toggles change.
   *
   * Series are torn down and rebuilt rather than hidden, so a disabled indicator
   * costs nothing and an enabled one cannot show a stale line from a previous
   * timeframe.
   */
  const drawIndicators = (candles: Candle[]) => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const s of Object.values(overlayRefs.current)) if (s) chart.removeSeries(s);
    for (const s of Object.values(paneRefs.current)) if (s) chart.removeSeries(s);
    overlayRefs.current = {};
    paneRefs.current = {};

    // Extra panes are removed when their indicator is off, otherwise an empty strip
    // stays behind and eats vertical space.
    while (chart.panes().length > 1) {
      const extra = chart.panes()[chart.panes().length - 1];
      try {
        chart.removePane(extra.paneIndex());
      } catch {
        break;
      }
    }
    if (candles.length === 0) return;

    const ohlc: Ohlc[] = candles;
    const ind = computeIndicators(ohlc);

    const addOverlay = (color: string, data: Array<{ time: number; value: number }>, style = LineStyle.Solid) => {
      if (data.length === 0) return null;
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(data as any);
      return s;
    };

    if (enabled.ema9) overlayRefs.current.ema9 = addOverlay("#38bdf8", toLineData(ohlc, ind.ema9));
    if (enabled.ema21) overlayRefs.current.ema21 = addOverlay("#a78bfa", toLineData(ohlc, ind.ema21));
    if (enabled.sma50) overlayRefs.current.sma50 = addOverlay("#fbbf24", toLineData(ohlc, ind.sma50));
    if (enabled.vwap) overlayRefs.current.vwap = addOverlay("#f472b6", toLineData(ohlc, ind.vwap), LineStyle.Dashed);
    if (enabled.bollinger) {
      overlayRefs.current.bbU = addOverlay("rgba(148,163,184,0.9)", toLineData(ohlc, ind.bollinger.upper));
      overlayRefs.current.bbM = addOverlay("rgba(148,163,184,0.5)", toLineData(ohlc, ind.bollinger.middle), LineStyle.Dotted);
      overlayRefs.current.bbL = addOverlay("rgba(148,163,184,0.9)", toLineData(ohlc, ind.bollinger.lower));
    }

    if (enabled.rsi14) {
      const data = toLineData(ohlc, ind.rsi14);
      if (data.length > 0) {
        const pane = chart.addPane();
        pane.setHeight(90);
        const idx = pane.paneIndex();
        const s = chart.addSeries(
          LineSeries,
          { color: "#22d3ee", lineWidth: 1, priceLineVisible: false, priceFormat: { type: "price", precision: 1, minMove: 0.1 } },
          idx
        );
        s.setData(data as any);
        // 70/30 are the conventional bands; drawn as price lines so they scroll with
        // the series instead of being painted at a fixed pixel height.
        s.createPriceLine({ price: 70, color: "rgba(244,63,94,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
        s.createPriceLine({ price: 30, color: "rgba(16,185,129,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });
        paneRefs.current.rsi14 = s;
      }
    }

    if (enabled.macd) {
      const histData = toLineData(ohlc, ind.macd.histogram);
      if (histData.length > 0) {
        const pane = chart.addPane();
        pane.setHeight(90);
        const idx = pane.paneIndex();
        const hist = chart.addSeries(
          HistogramSeries,
          // MACD of a 1e-9 price is itself around 1e-11, so the same reasoning as the
          // candle series applies to this axis.
          { priceFormat: { type: "custom", formatter: (p: number) => formatSmallNumber(p), minMove: 1e-14 } },
          idx
        );
        hist.setData(
          histData.map((d) => ({
            time: d.time as any,
            value: d.value,
            color: d.value >= 0 ? "rgba(16,185,129,0.55)" : "rgba(244,63,94,0.55)",
          })) as any
        );
        const macdLine = chart.addSeries(
          LineSeries,
          { color: "#38bdf8", lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
          idx
        );
        macdLine.setData(toLineData(ohlc, ind.macd.macd) as any);
        const signalLine = chart.addSeries(
          LineSeries,
          { color: "#fbbf24", lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
          idx
        );
        signalLine.setData(toLineData(ohlc, ind.macd.signal) as any);
        paneRefs.current.macdHist = hist;
        paneRefs.current.macdLine = macdLine;
        paneRefs.current.macdSignal = signalLine;
      }
    }
  };

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
        setCandleCount(candles.length);

        if (candles.length > 0 && candleSeriesRef.current) {
          const sorted = [...candles].sort((a, b) => a.time - b.time);
          candlesRef.current = sorted;
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
          drawIndicators(sorted);
          setLegend(sorted[sorted.length - 1]);

          const fitKey = `${symbol}:${chainId}:${interval}`;
          if (fittedFor.current !== fitKey) {
            chartRef.current?.timeScale().fitContent();
            fittedFor.current = fitKey;
          }
        } else {
          candlesRef.current = [];
          setLegend(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, chainId, interval]);

  // Redraw on a toggle without waiting for the next poll.
  useEffect(() => {
    if (candlesRef.current.length > 0) drawIndicators(candlesRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey]);

  const priceUsd = priceNative * (nativeUsd || 0);
  const changeIsUp = changePct >= 0;

  /**
   * Which enabled indicators cannot draw yet, and how many bars they still need.
   * Stated plainly rather than leaving the user to wonder why a line is missing.
   */
  const warmingUp = useMemo(() => {
    const all = [...OVERLAYS, ...PANES];
    return all
      .filter((i) => enabled[i.key as IndicatorKey] && candleCount < (WARMUP[i.warmupKey] ?? 1))
      .map((i) => `${i.label} needs ${(WARMUP[i.warmupKey] ?? 1) - candleCount} more`);
  }, [enabled, candleCount]);

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

  const toggle = (key: IndicatorKey) => setEnabled((p) => ({ ...p, [key]: !p[key] }));
  const activeCount = Object.values(enabled).filter(Boolean).length;

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

          <div className="relative ml-1">
            <button
              type="button"
              onClick={() => setShowIndicatorMenu((v) => !v)}
              aria-expanded={showIndicatorMenu}
              aria-haspopup="true"
              className={`px-2 py-0.5 rounded font-bold border transition-colors ${
                showIndicatorMenu
                  ? "bg-accent-soft text-accent border-accent/30"
                  : "bg-cream-3 text-ink-soft border-transparent hover:text-ink"
              }`}
            >
              Indicators{activeCount > 0 ? ` (${activeCount})` : ""}
            </button>
            {showIndicatorMenu && (
              <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-xl border border-line bg-white p-2 shadow-2xl space-y-0.5">
                <p className="px-1 pb-1 text-[9px] uppercase tracking-wider text-ink-faint">On price</p>
                {OVERLAYS.map((o) => (
                  <label
                    key={o.key}
                    className="flex items-center gap-2 px-1 py-1 rounded hover:bg-cream-3 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={enabled[o.key]}
                      onChange={() => toggle(o.key)}
                      className="accent-accent"
                    />
                    <span className="h-0.5 w-3 rounded" style={{ backgroundColor: o.color }} />
                    <span className="text-[11px] text-ink">{o.label}</span>
                    {candleCount < (WARMUP[o.warmupKey] ?? 1) && (
                      <span className="ml-auto text-[9px] text-warn">needs {WARMUP[o.warmupKey]}</span>
                    )}
                  </label>
                ))}
                <p className="px-1 pt-1.5 pb-1 text-[9px] uppercase tracking-wider text-ink-faint">
                  Separate pane
                </p>
                {PANES.map((p) => (
                  <label
                    key={p.key}
                    className="flex items-center gap-2 px-1 py-1 rounded hover:bg-cream-3 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={enabled[p.key]}
                      onChange={() => toggle(p.key)}
                      className="accent-accent"
                    />
                    <span className="text-[11px] text-ink">{p.label}</span>
                    {candleCount < (WARMUP[p.warmupKey] ?? 1) && (
                      <span className="ml-auto text-[9px] text-warn">needs {WARMUP[p.warmupKey]}</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* OHLC legend under the crosshair. */}
      {legend && (
        <div className="flex items-center gap-2.5 pb-1 font-mono text-[10px] text-ink-soft shrink-0 flex-wrap">
          {(["open", "high", "low", "close"] as const).map((k) => (
            <span key={k}>
              {k[0].toUpperCase()}
              <span className={legend.close >= legend.open ? "text-ok ml-0.5" : "text-danger ml-0.5"}>
                {formatSmallNumber(legend[k])}
              </span>
            </span>
          ))}
          <span>
            Vol<span className="text-accent ml-0.5">{legend.volume.toFixed(4)}</span>
          </span>
        </div>
      )}

      <div ref={containerRef} className="w-full flex-1 min-h-[300px] overflow-hidden rounded-xl" />

      <div className="pt-1.5 flex items-center justify-between text-[10px] font-mono text-ink-faint shrink-0 gap-2 flex-wrap">
        <span>
          Source: <span className={source === "onchain" ? "text-ok" : "text-warn"}>{sourceLabel}</span>
          {tradeCount > 0 ? ` · ${tradeCount} fills · ${candleCount} bars` : ""}
        </span>
        {warmingUp.length > 0 ? (
          <span className="text-warn" title="An indicator is only drawn once it has a full window of data.">
            warming up: {warmingUp.join(", ")}
          </span>
        ) : (
          <span className={poolLive ? "text-ok" : "text-warn"}>
            {poolLive ? "pool live" : "pool not tradable"}
          </span>
        )}
      </div>
    </div>
  );
}
