"use client";

import { useEffect, useState } from "react";
import { Fuel, RefreshCw, AlertTriangle } from "lucide-react";
import { resolveChainOrDefault } from "@/lib/chains";

/**
 * Kartu biaya di langkah review Studio: berapa sebenarnya "gas only" untuk chain yang dipilih,
 * tepat sebelum tanda tangan.
 *
 * Angkanya dari `/api/launch-cost` — satuan gas `deployTrinity` yang diukur ke factory yang
 * terpasang, dikali harga gas chain itu sekarang, dikali harga token native. Chain yang RPC-nya
 * tidak menjawab menampilkan "not readable" dan TIDAK ada angka: angka lama yang tampil seperti
 * bacaan adalah cacat yang sudah berulang di repo ini.
 *
 * Struktur fee tidak dihitung di sini. Ia datang dari pemanggil (Studio), yang membacanya dari
 * factory lewat `GET /api/deploy` — jadi kartu ini tidak bisa berselisih dengan calldata.
 */

interface LaunchCost {
  chainKey: string;
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  gasUnits: number;
  gasPriceGwei: number | null;
  costNative: number | null;
  costUsd: number | null;
  live: boolean;
}

const fmtNative = (v: number) => (v >= 1 ? v.toFixed(4) : v >= 0.0001 ? v.toFixed(6) : v.toPrecision(2));
const fmtUsd = (v: number) => (v < 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
const fmtGwei = (v: number) => (v >= 1 ? v.toFixed(2) : v.toPrecision(2));

export default function LaunchCostCard({
  chainIds,
  traderPaysPct,
  creatorKeepsPct,
}: {
  /** Chain yang benar-benar akan diluncurkan. */
  chainIds: number[];
  /** Total fee yang dibayar trader, dari struktur fee factory chain itu. */
  traderPaysPct: number;
  /** Porsi creator dari setiap swap. */
  creatorKeepsPct: number;
}) {
  const [costs, setCosts] = useState<LaunchCost[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/launch-cost");
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || !Array.isArray(json?.costs)) throw new Error("bad response");
        setCosts(json.costs as LaunchCost[]);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    // Harga gas bergerak tiap blok; semenit sekali cukup untuk layar review.
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const rows = chainIds.map((id) => ({ id, cost: costs?.find((c) => c.chainId === id) ?? null }));
  const state = failed ? "error" : costs === null ? "loading" : "ready";

  return (
    <div className="rounded-xl border border-line bg-surface p-3" data-testid="launch-cost" data-state={state}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-ink">
        <Fuel className="h-3.5 w-3.5 text-accent" /> What this launch costs
      </div>

      <div className="divide-y divide-line/60 text-[11px]" data-numeric>
        {rows.length === 0 ? (
          <p className="py-1.5 text-ink-faint">Pick a chain to see its gas cost.</p>
        ) : (
          rows.map(({ id, cost }) => (
            <div key={id} className="flex items-baseline justify-between gap-3 py-1.5" data-chain={id} data-live={cost?.live ? "1" : "0"}>
              <span className="text-ink-soft">Gas on {cost?.chainName ?? resolveChainOrDefault(id).name}</span>
              {state === "loading" ? (
                <span className="flex items-center gap-1 text-ink-faint">
                  <RefreshCw className="h-3 w-3 animate-spin" /> reading gas price…
                </span>
              ) : cost && cost.costNative !== null ? (
                <span
                  className="text-right font-semibold text-ink"
                  title={`${cost.gasUnits.toLocaleString("en-US")} gas × ${cost.gasPriceGwei !== null ? fmtGwei(cost.gasPriceGwei) : "?"} gwei`}
                  data-cost-native={cost.costNative}
                  data-cost-usd={cost.costUsd ?? ""}
                >
                  ≈ {fmtNative(cost.costNative)} {cost.nativeSymbol}
                  {cost.costUsd !== null && <span className="ml-1 font-normal text-ink-soft">· {fmtUsd(cost.costUsd)}</span>}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-right text-warn" data-cost-native="">
                  <AlertTriangle className="h-3 w-3" /> not readable right now
                </span>
              )}
            </div>
          ))
        )}
        <div className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="text-ink-soft">Liquidity deposit</span>
          <span className="font-semibold text-ok">none — the launch is not payable</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="text-ink-soft">Tokens you receive</span>
          <span className="font-semibold text-ink">0 — the whole supply enters the curve</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="text-ink-soft">Every trade afterwards</span>
          <span className="text-right font-semibold text-ink">
            {traderPaysPct.toFixed(2)}% paid by the trader · {creatorKeepsPct.toFixed(2)}% to you
          </span>
        </div>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">
        {failed
          ? "The gas price could not be read, so no figure is shown. Your wallet shows the exact network fee before you sign."
          : "An estimate: gas prices change every block, and your wallet shows the exact network fee before you sign."}
      </p>
      {/* Cara menghitungnya ditulis di sini, bukan di halaman lain: pembaca yang ragu pada angka
          biaya sedang berada tepat di sini. */}
      <details className="mt-1 text-[10px] leading-relaxed text-ink-faint">
        <summary className="cursor-pointer font-semibold text-accent">How it is computed</summary>
        <p className="mt-1">
          Gas used by <code className="text-accent">deployTrinity</code>, measured against the factory deployed on each
          chain with the same arguments this page sends
          {rows[0]?.cost ? ` (${rows[0].cost.gasUnits.toLocaleString("en-US")} gas on ${rows[0].cost.chainName})` : ""},
          multiplied by that chain&apos;s gas price right now and by the live price of its native token. Nothing else is
          charged: the factory cannot receive a deposit or a launch fee.
        </p>
      </details>
    </div>
  );
}
