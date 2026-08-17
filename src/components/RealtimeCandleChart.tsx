"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CandlestickSeries, IChartApi, ISeriesApi } from "lightweight-charts";

interface RealtimeCandleChartProps {
  symbol: string;
  basePriceUSD: number;
}

export default function RealtimeCandleChart({ symbol, basePriceUSD }: RealtimeCandleChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<any>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(basePriceUSD);
  const [priceChange, setPriceChange] = useState<number>(14.8);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. Initialize TradingView Lightweight Chart
    const chart = createChart(chartContainerRef.current, {
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
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
      },
      width: chartContainerRef.current.clientWidth,
      height: 340,
    });

    // 2. Add Candlestick Series (Lightweight Charts v5 API)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
    });

    // 3. Generate Historical Realistic Candles based on base price
    const initialData = [];
    const now = Math.floor(Date.now() / 1000);
    const interval = 60 * 5; // 5 min candles
    let price = basePriceUSD * 0.85;

    for (let i = 50; i >= 0; i--) {
      const time = (now - i * interval) as any;
      const variation = (Math.random() - 0.48) * (price * 0.02);
      const open = price;
      const close = open + variation;
      const high = Math.max(open, close) + Math.random() * (price * 0.01);
      const low = Math.min(open, close) - Math.random() * (price * 0.01);
      price = close;

      initialData.push({
        time,
        open,
        high,
        low,
        close,
      });
    }

    candleSeries.setData(initialData);
    seriesRef.current = candleSeries;
    chartRef.current = chart;

    setCurrentPrice(price);

    // 4. Live Tick Simulation (Updating latest candle in real-time)
    const timer = setInterval(() => {
      if (!seriesRef.current) return;
      const tickDelta = (Math.random() - 0.49) * (price * 0.004);
      price = Math.max(0.0001, price + tickDelta);

      const currentTime = (Math.floor(Date.now() / 1000)) as any;
      seriesRef.current.update({
        time: currentTime,
        open: price - tickDelta,
        high: price + Math.abs(tickDelta) * 1.5,
        low: price - Math.abs(tickDelta) * 1.5,
        close: price,
      });

      setCurrentPrice(price);
      setPriceChange(prev => +(prev + (tickDelta > 0 ? 0.05 : -0.05)).toFixed(2));
    }, 2500);

    // 5. Handle Resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [symbol, basePriceUSD]);

  return (
    <div className="w-full flex flex-col h-full justify-between">
      {/* Top Chart Header */}
      <div className="flex items-center justify-between pb-3 mb-1 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="text-base sm:text-lg font-black text-white font-mono flex items-center gap-2">
            <span>${symbol}/USD</span>
            <span className="text-xs text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
              +{priceChange}%
            </span>
          </div>
          <span className="text-xs sm:text-sm font-mono text-cyan-300 font-bold">
            ${currentPrice < 0.01 ? currentPrice.toFixed(6) : currentPrice.toFixed(4)}
          </span>
        </div>

        <div className="flex items-center gap-1 font-mono text-[10px]">
          <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 font-bold border border-cyan-500/40">1m</span>
          <span className="px-2 py-0.5 rounded bg-white/5 text-zinc-400 hover:text-white cursor-pointer">5m</span>
          <span className="px-2 py-0.5 rounded bg-white/5 text-zinc-400 hover:text-white cursor-pointer">15m</span>
          <span className="px-2 py-0.5 rounded bg-white/5 text-zinc-400 hover:text-white cursor-pointer">1h</span>
        </div>
      </div>

      {/* Candlestick Canvas */}
      <div ref={chartContainerRef} className="w-full flex-1 min-h-[300px] overflow-hidden rounded-xl" />
    </div>
  );
}
