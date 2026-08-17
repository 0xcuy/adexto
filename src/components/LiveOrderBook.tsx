"use client";

import { useState, useEffect } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";

interface OrderBookProps {
  symbol: string;
  basePriceUSD: number;
}

interface OrderLevel {
  price: number;
  amount: number;
  total: number;
}

export default function LiveOrderBook({ symbol, basePriceUSD }: OrderBookProps) {
  const [bids, setBids] = useState<OrderLevel[]>([]);
  const [asks, setAsks] = useState<OrderLevel[]>([]);
  const [spread, setSpread] = useState("0.02%");

  useEffect(() => {
    // Generate initial orderbook depth
    function generateDepth() {
      const askList: OrderLevel[] = [];
      const bidList: OrderLevel[] = [];

      let askTotal = 0;
      for (let i = 1; i <= 6; i++) {
        const p = basePriceUSD * (1 + i * 0.0018 + (Math.random() * 0.0005));
        const amount = Math.floor(5000 + Math.random() * 25000);
        askTotal += amount;
        askList.push({ price: p, amount, total: askTotal });
      }

      let bidTotal = 0;
      for (let i = 1; i <= 6; i++) {
        const p = basePriceUSD * (1 - i * 0.0018 - (Math.random() * 0.0005));
        const amount = Math.floor(5000 + Math.random() * 25000);
        bidTotal += amount;
        bidList.push({ price: p, amount, total: bidTotal });
      }

      setAsks(askList.reverse());
      setBids(bidList);
    }

    generateDepth();
    const interval = setInterval(generateDepth, 3500);
    return () => clearInterval(interval);
  }, [basePriceUSD]);

  return (
    <div className="w-full h-full flex flex-col justify-between font-mono text-[11px]">
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
        <span className="text-zinc-400 font-bold text-[10px] uppercase">Order Book (Sovereign AMM Depth)</span>
        <span className="text-zinc-500 text-[10px]">Spread: {spread}</span>
      </div>

      {/* Asks (Sell Orders - Red) */}
      <div className="space-y-1">
        {asks.slice(-5).map((a, idx) => (
          <div key={idx} className="flex justify-between items-center py-0.5 px-1 rounded bg-red-950/20 relative overflow-hidden">
            <div 
              className="absolute right-0 top-0 bottom-0 bg-red-500/10 pointer-events-none" 
              style={{ width: `${Math.min(100, (a.amount / 30000) * 100)}%` }}
            />
            <span className="text-red-400 font-semibold relative z-10">${a.price.toFixed(4)}</span>
            <span className="text-zinc-300 relative z-10">{a.amount.toLocaleString()}</span>
            <span className="text-zinc-500 text-[10px] relative z-10">{(a.total / 1000).toFixed(1)}k</span>
          </div>
        ))}
      </div>

      {/* Mid Market Price Indicator */}
      <div className="my-1.5 py-1 px-2 rounded-lg bg-[#070b18] border border-cyan-500/30 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-black text-cyan-300">
          <ArrowUp className="w-3.5 h-3.5 text-emerald-400" />
          <span>${basePriceUSD.toFixed(4)}</span>
        </div>
        <span className="text-[10px] text-emerald-400 font-bold">● Uniswap v4 Hook Active</span>
      </div>

      {/* Bids (Buy Orders - Green) */}
      <div className="space-y-1">
        {bids.slice(0, 5).map((b, idx) => (
          <div key={idx} className="flex justify-between items-center py-0.5 px-1 rounded bg-emerald-950/20 relative overflow-hidden">
            <div 
              className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 pointer-events-none" 
              style={{ width: `${Math.min(100, (b.amount / 30000) * 100)}%` }}
            />
            <span className="text-emerald-400 font-semibold relative z-10">${b.price.toFixed(4)}</span>
            <span className="text-zinc-300 relative z-10">{b.amount.toLocaleString()}</span>
            <span className="text-zinc-500 text-[10px] relative z-10">{(b.total / 1000).toFixed(1)}k</span>
          </div>
        ))}
      </div>
    </div>
  );
}
