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

/**
 * Umur relatif. Berlanjut melewati hari, karena sekarang riwayatnya bisa sampai sana.
 *
 * Satuan terbesarnya dulu `d` tanpa batas atas, jadi fill berumur enam minggu tampil
 * sebagai "42d". Itu tidak salah, hanya berhenti berguna — dan selama jendela bacanya
 * masih 13 jam, kasus itu tidak pernah muncul sehingga tidak pernah terasa. Setelah
 * jendelanya dibatasi blok peluncuran alih-alih hitungan blok tetap, ia muncul.
 */
function ago(timestamp: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86400)}d`;
  if (seconds < 31_536_000) return `${Math.floor(seconds / 2_592_000)}mo`;
  return `${Math.floor(seconds / 31_536_000)}y`;
}

interface Coverage {
  fromBlock: number | null;
  toBlock: number | null;
  reachedLaunch: boolean;
  truncated: boolean;
  blocksScanned: number;
  calls: number;
  error: string | null;
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
  const [coverage, setCoverage] = useState<Coverage | null>(null);
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
        setCoverage(json.coverage ?? null);
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
    <div className="flex h-full w-full flex-col text-[11px]" data-numeric>
      <div className="flex items-center justify-between border-b border-line pb-2 mb-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <Activity className={`w-3.5 h-3.5 ${isLive ? "text-ok animate-pulse" : "text-warn"}`} />
          <span className="text-ink font-bold text-[10px] uppercase">Trade Feed</span>
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
            isLive
              ? "text-ok bg-ok/10 border-ok/30"
              : "text-warn bg-warn/10 border-warn/30"
          }`}
        >
          {isLive ? "● on-chain" : source === "agent" ? "agent log" : source === "genesis" ? "genesis reference" : "no fills"}
        </span>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[170px] pr-1">
        {!loaded ? (
          <div className="h-full flex items-center justify-center text-ink-faint text-[11px]">Loading…</div>
        ) : trades.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center px-3">
            <Info className="w-4 h-4 text-ink-faint" />
            {/* Penolakan RPC dipisahkan dari pasar yang benar-benar kosong. Keduanya dulu
                menampilkan kalimat yang sama, sehingga kegagalan baca terbaca sebagai fakta
                tentang pasarnya. */}
            {coverage?.error ? (
              <>
                <span className="text-warn text-[10px]">Could not read trade history from the node.</span>
                <span className="text-ink-faint text-[9px] break-all">{coverage.error}</span>
              </>
            ) : (
              <span className="text-ink-soft text-[10px]">No trades recorded for ${symbol} yet.</span>
            )}
          </div>
        ) : (
          trades.slice(0, 50).map((t) => (
            <div
              key={t.id}
              className={`p-1.5 rounded-xl border flex items-center justify-between gap-2 ${
                t.type === "AUTO_BUYBACK"
                  ? "bg-accent-soft border-accent/30"
                  : t.type === "BUY"
                  ? "bg-ok/10 border-ok/30"
                  : "bg-danger/10 border-danger/30"
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {t.type === "AUTO_BUYBACK" ? (
                  <span className="px-1.5 rounded bg-accent-soft text-accent border border-accent/30 font-semibold text-[9px] flex items-center gap-0.5 shrink-0">
                    <Flame className="w-2.5 h-2.5" /> BURN
                  </span>
                ) : (
                  <span
                    className={`px-1.5 rounded font-semibold text-[9px] border shrink-0 ${
                      t.type === "BUY"
                        ? "bg-ok/10 text-ok border-ok/30"
                        : "bg-danger/10 text-danger border-danger/30"
                    }`}
                  >
                    {t.type}
                  </span>
                )}
                <span className="font-bold text-ink text-[10px] truncate">
                  {fmtToken(t.amountToken)} ${t.symbol}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-ink-soft text-[10px]">
                  {t.amountNative.toFixed(4)} {t.nativeSymbol}
                  {nativeUsd > 0 ? ` · $${(t.amountNative * nativeUsd).toFixed(2)}` : ""}
                </span>
                <span className="text-ink-faint text-[9px]">{ago(t.timestamp)}</span>
                {t.source === "genesis" ? (
                  <span className="text-ink-faint text-[9px]">reference</span>
                ) : (
                  <a
                    href={explorerTxUrl(t.chainId, t.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline text-[9px] flex items-center gap-0.5"
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

      {/* Jangkauan pembacaan, dinyatakan alih-alih disiratkan.
          Pertanyaan yang memicu baris ini: "kenapa feed hari kemarin hilang?" Jawabannya
          waktu itu adalah jendela 45.000 blok — sekitar 13 jam di 0G — tetapi tidak ada
          apa pun di layar yang bisa mengatakannya, jadi feed yang terpotong tampak
          identik dengan feed yang lengkap. Sekarang kalau riwayatnya utuh sampai
          peluncuran, itu dinyatakan; kalau terpotong, itu juga dinyatakan. */}
      {loaded && isLive && trades.length > 0 && coverage && (
        <div className="mt-2 shrink-0 border-t border-line pt-1.5 text-[9px] text-ink-faint">
          {coverage.reachedLaunch ? (
            <span>
              {trades.length} fill{trades.length === 1 ? "" : "s"} · full history since launch
            </span>
          ) : (
            <span>
              {trades.length} fill{trades.length === 1 ? "" : "s"} · newest {coverage.blocksScanned.toLocaleString("en-US")} blocks
              only, older fills not read
            </span>
          )}
          {trades.length > 50 && <span> · showing 50</span>}
        </div>
      )}
    </div>
  );
}
