"use client";

import { useEffect, useRef, useState } from "react";
import { Users, RefreshCw, ExternalLink } from "lucide-react";
import { explorerAddressUrl, resolveChainOrDefault } from "@/lib/chains";
import { formatTokenAmount } from "@/lib/pricing";
import type { HoldersReport } from "@/lib/holders";

/**
 * Holder: jumlah, porsi 10 teratas, porsi creator, dan porsi yang masih di kurva.
 *
 * Saldo disusun server dari seluruh `Transfer` sejak mint (`/api/market/holders`). Selama
 * pemindaian awal berjalan, panel menyebut kemajuannya dan angkanya diberi tanda sebagai
 * sementara — distribusi dari separuh riwayat bukan distribusi.
 */

/**
 * Persen yang tidak berbohong di kedua ujung: 99,9945% di kurva TIDAK boleh tercetak "100%"
 * (terbaca belum ada yang membeli), dan porsi holder pada pasar muda memang sekecil 0,0026% —
 * membulatkannya ke "<0.01%" membuat semua baris daftar sama.
 */
const fmtPct = (v: number) => {
  if (!Number.isFinite(v)) return "—";
  if (v <= 0) return "0%";
  if (v >= 100) return "100%";
  if (v >= 99.99) return "99.99%";
  if (v >= 1) return `${v.toFixed(2)}%`;
  if (v < 0.0001) return "<0.0001%";
  return `${Number(v.toPrecision(2))}%`;
};

export default function HoldersPanel({
  symbol,
  chainId,
  me,
}: {
  symbol: string;
  chainId: number;
  /** Dompet yang tersambung, ditandai YOU di daftar. */
  me?: string | null;
}) {
  const [report, setReport] = useState<HoldersReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const chain = resolveChainOrDefault(chainId);

  const load = async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetch(`/api/market/holders?symbol=${encodeURIComponent(symbol)}&chainId=${chainId}`);
      const json = await res.json();
      if (res.ok) {
        setReport(json as HoldersReport);
        setError(null);
      } else {
        setError(String(json?.error || `HTTP ${res.status}`));
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      inflight.current = false;
    }
  };

  useEffect(() => {
    setReport(null);
    void load();
    // Lebih rapat selama pemindaian awal berjalan, supaya kemajuannya terlihat bergerak.
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, chainId]);

  const meL = (me || "").toLowerCase();
  const complete = Boolean(report?.complete);
  const provisional = report && !complete ? "~" : "";

  const stat = "flex flex-col gap-0.5 rounded-xl border border-line bg-surface px-3 py-2";
  const label = "text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint";

  return (
    <div
      className="glass-panel rounded-card border border-line p-4"
      data-testid="holders"
      data-complete={report ? String(complete) : "unknown"}
      data-holders={report?.holders ?? ""}
      data-top10={report?.top10Pct ?? ""}
      data-creator-pct={report?.creatorPct ?? ""}
      data-curve-pct={report?.curvePct ?? ""}
    >
      <div className="mb-2.5 flex items-center justify-between border-b border-line pb-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Users className="h-3.5 w-3.5 text-accent" /> Holders
        </span>
        {report && !complete ? (
          <span className="flex items-center gap-1 text-[10px] text-warn" title="Rebuilding balances from every Transfer since the token was minted">
            <RefreshCw className="h-3 w-3 animate-spin" /> reading history {Math.floor(report.index.progress * 100)}%
          </span>
        ) : report ? (
          <span className="text-[10px] text-ink-faint" title="Balances rebuilt from every Transfer since the token was minted">
            from every transfer since launch
          </span>
        ) : null}
      </div>

      {!report ? (
        <p className="py-3 text-center text-[11px] text-ink-faint">{error ?? "Reading holders from the chain…"}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-numeric>
            <div className={stat} title="Wallets holding any amount, not counting the curve or burn addresses">
              <span className={label}>Holders</span>
              <span className="text-sm font-semibold text-ink">
                {provisional}
                {report.holders.toLocaleString("en-US")}
              </span>
            </div>
            <div className={stat} title="Share of the supply held by the ten largest wallets, not counting the curve">
              <span className={label}>Top 10</span>
              <span className="text-sm font-semibold text-ink">
                {provisional}
                {fmtPct(report.top10Pct)}
              </span>
            </div>
            <div className={stat} title={`Share of the supply held by the wallet that launched this market (${report.creator})`}>
              <span className={label}>Creator</span>
              <span className={`text-sm font-semibold ${report.creatorPct >= 5 ? "text-warn" : "text-ink"}`}>
                {provisional}
                {fmtPct(report.creatorPct)}
              </span>
            </div>
            <div className={stat} title="Supply still held by the bonding curve, not yet bought">
              <span className={label}>In curve</span>
              <span className="text-sm font-semibold text-ink">
                {provisional}
                {fmtPct(report.curvePct)}
              </span>
            </div>
          </div>

          {report.top.length > 0 ? (
            <ol className="mt-3 space-y-1" data-numeric>
              {report.top.map((h, i) => {
                const isDev = h.address === report.creator;
                const isMe = meL && h.address === meL;
                // Batang relatif terhadap holder terbesar: porsi mutlaknya bisa 0,002% dan
                // batang selebar itu tidak terlihat.
                const width = report.top[0].pct > 0 ? Math.max(2, (h.pct / report.top[0].pct) * 100) : 0;
                return (
                  // Di bawah lg barisnya setinggi tautannya (36 px), tanpa padding vertikal; dulu tautan 16 px
                  // dengan jarak 3,5 px ke baris berikutnya terlalu rapat untuk jempol.
                  <li key={h.address} className="relative overflow-hidden rounded-lg px-2 text-[11px] lg:py-1" data-holder={h.address}>
                    <div className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${width}%` }} aria-hidden="true" />
                    <div className="relative flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="w-4 shrink-0 text-right text-ink-faint">{i + 1}</span>
                        <a
                          href={explorerAddressUrl(chain, h.address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[36px] items-center gap-0.5 font-mono text-accent hover:underline lg:min-h-0"
                          title={`${h.address} · ${formatTokenAmount(h.tokens)} $${symbol}`}
                        >
                          {h.address.slice(0, 6)}…{h.address.slice(-4)}
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                        {isMe && <span className="rounded bg-accent-soft px-1 text-[8px] font-bold text-accent">YOU</span>}
                        {isDev && <span className="rounded bg-warn/15 px-1 text-[8px] font-bold text-warn">DEV</span>}
                      </span>
                      <span className="shrink-0 font-semibold text-ink">{fmtPct(h.pct)}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-3 text-center text-[11px] text-ink-soft">No wallet holds ${symbol} yet; the whole supply is in the curve.</p>
          )}
        </>
      )}
    </div>
  );
}
