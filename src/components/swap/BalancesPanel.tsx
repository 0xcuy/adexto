"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw, Wallet } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { chainFromId, chainMark, nativeAssetLogo } from "@/lib/chains";
import { formatTokenAmount, formatUsd } from "@/lib/pricing";
import type { SwapBalances } from "@/components/swap/useSwapBalances";

/**
 * Balances: everything the connected wallet holds on ADEXTO's five chains, under the swap card.
 * This is the ledger the owner asked for, kept inside Swap rather than as another menu item.
 * A chain that could not be read says so; it never shows as zero.
 */
export default function BalancesPanel({ balances, onMove }: { balances: SwapBalances; onMove?: (chainId: number) => void }) {
  const { isConnected, connectWallet } = useWallet();
  const { report, loading, error, refresh } = balances;

  if (!isConnected) {
    return (
      <section className="glass-panel rounded-card p-5" aria-labelledby="balances-title" data-testid="swap-balances">
        <h2 id="balances-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Wallet className="h-4 w-4 text-accent" aria-hidden="true" /> Balances
        </h2>
        <p className="mt-2 text-[12px] text-ink-soft">Connect a wallet to see what it holds on Monad, Arbitrum, Robinhood, Base and 0G in one place.</p>
        <button type="button" onClick={() => void connectWallet()} className="mt-3 h-[40px] rounded-xl border border-line px-4 text-xs font-semibold text-ink hover:border-line-strong">
          Connect wallet
        </button>
      </section>
    );
  }

  const chains = (report?.chains ?? []).filter((c) => c.error || c.totalUsd > 0 || c.assets.some((a) => a.amount > 0) || c.positions.length || c.creatorFees.length);

  return (
    <section className="glass-panel rounded-card p-5" aria-labelledby="balances-title" aria-busy={loading} data-testid="swap-balances">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="balances-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Wallet className="h-4 w-4 text-accent" aria-hidden="true" /> Balances
          </h2>
          <p className="mt-1 text-2xl font-semibold text-ink" data-numeric>
            {report ? formatUsd(report.totalUsd) : loading ? "…" : "—"}
          </p>
          <p className="text-[11px] text-ink-faint">
            Across five chains{report?.partial ? ", lower bound: a chain could not be read" : ""}
            {report && !report.pricesLive ? ", some prices are not live" : ""}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh balances"
          className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-cream-2 hover:text-ink lg:h-auto lg:w-auto lg:p-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {error && <p className="mt-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-[12px] text-danger">{error}</p>}
      {report && chains.length === 0 && <p className="mt-3 text-[12px] text-ink-soft">Nothing on these five chains yet.</p>}

      {/* Baris aset boleh membungkus (U2.5): di 320 px jumlah, nilai USD dan tombol Move/Trade/Claim tidak muat satu
          baris, dan jumlahnya dulu dipotong sampai 4–5 angka. Sekarang nilai + tombol turun ke baris kedua, rata
          kanan, dan tombolnya 32 px di bawah lg (dulu 23 px dan rapat antar baris: ERROR tap<24). */}
      <div className="mt-4 space-y-3">
        {chains.map((c) => {
          const info = chainFromId(c.chainId);
          const mark = info ? chainMark(info) : null;
          return (
            <div key={c.chainId} className="rounded-2xl border border-line bg-surface p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  {mark && <img src={mark} alt="" aria-hidden="true" className="h-4 w-4 rounded-full object-contain" />}
                  {c.name}
                </span>
                <span className="text-[13px] font-semibold text-ink" data-numeric>
                  {c.error ? "—" : formatUsd(c.totalUsd)}
                </span>
              </div>
              {c.error ? (
                <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warn">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Could not read this chain right now. {c.error}
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-line text-[12px]">
                  {c.assets
                    .filter((a) => a.amount > 0)
                    .map((a) => {
                      const logo = a.kind === "native" ? nativeAssetLogo(a.symbol) : null;
                      return (
                        <li key={a.address} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1.5">
                          <span className="flex min-w-0 items-center gap-2 text-ink">
                            {logo ? <img src={logo} alt="" aria-hidden="true" className="h-4 w-4 rounded-full object-contain" /> : <span aria-hidden="true" className="h-4 w-4 rounded-full border border-line bg-cream-3" />}
                            <span className="font-medium">{a.symbol}</span>
                            <span className="text-ink-soft" data-numeric>
                              {formatTokenAmount(a.amount)}
                            </span>
                          </span>
                          <span className="ml-auto flex shrink-0 items-center gap-2">
                            <span className="text-ink-soft" data-numeric>
                              {a.usd == null ? "—" : formatUsd(a.usd)}
                            </span>
                            {onMove && (
                              <button type="button" onClick={() => onMove(c.chainId)} className="inline-flex min-h-[32px] items-center rounded-md border border-line px-2.5 text-[11px] font-semibold text-accent hover:border-accent/40 lg:min-h-0 lg:px-2 lg:py-0.5">
                                Move
                              </button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  {c.positions.map((p) => (
                    <li key={p.symbol} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1.5">
                      <span className="flex min-w-0 items-center gap-2 text-ink">
                        <img src={p.image || "/logo.svg"} alt="" aria-hidden="true" className="h-4 w-4 rounded-full object-cover" />
                        <span className="font-medium">${p.symbol}</span>
                        <span className="min-w-0 text-ink-soft" data-numeric>
                          {formatTokenAmount(p.held + p.staked)}
                          {p.staked > 0 ? ` (${formatTokenAmount(p.staked)} staked)` : ""}
                        </span>
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        <span className="text-ink-soft" data-numeric title="What selling to the curve would return now, after fees">
                          {p.valueUsd == null ? "—" : formatUsd(p.valueUsd)}
                        </span>
                        <Link href={`/swap?token=${encodeURIComponent(p.symbol)}&chain=${c.chainId}`} className="inline-flex min-h-[32px] items-center rounded-md border border-line px-2.5 text-[11px] font-semibold text-accent hover:border-accent/40 lg:min-h-0 lg:px-2 lg:py-0.5">
                          Trade
                        </Link>
                      </span>
                    </li>
                  ))}
                  {c.creatorFees.map((f) => (
                    <li key={`fee-${f.symbol}`} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1.5">
                      <span className="text-ink">
                        Creator fees on ${f.symbol}{" "}
                        <span className="text-ink-soft" data-numeric>
                          {formatTokenAmount(f.amountNative)} {c.nativeSymbol}
                        </span>
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        <span className="text-ink-soft" data-numeric>
                          {f.usd == null ? "—" : formatUsd(f.usd)}
                        </span>
                        <Link href="/creator" className="inline-flex min-h-[32px] items-center rounded-md border border-line px-2.5 text-[11px] font-semibold text-accent hover:border-accent/40 lg:min-h-0 lg:px-2 lg:py-0.5">
                          Claim
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-ink-faint">
        Market tokens are valued at what selling them to their curve returns now, held and staked together. Only the assets ADEXTO routes are listed; other tokens in the wallet are not shown.
      </p>
    </section>
  );
}
