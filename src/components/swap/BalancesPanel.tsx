"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, RefreshCw, Wallet } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { chainFromId, chainMark, nativeAssetLogo } from "@/lib/chains";
import { formatTokenAmount, formatUsd } from "@/lib/pricing";
import type { SwapBalances } from "@/components/swap/useSwapBalances";

/** Same breakpoint as Tailwind's `lg`, where SwapHub puts this panel beside the swap card. */
const WIDE = "(min-width: 1024px)";

/**
 * Balances: everything the connected wallet holds on ADEXTO's five chains, beside the swap card
 * from lg and under it on phones. This is the ledger the owner asked for, kept inside Swap rather
 * than as another menu item. A chain that could not be read says so; it never shows as zero.
 *
 * Each chain folds. Phones start with every chain folded (name and total only), so five chains fit
 * on one screen; from lg they start open. A chain the user opened or closed stays that way.
 */
export default function BalancesPanel({ balances, onMove }: { balances: SwapBalances; onMove?: (chainId: number) => void }) {
  const { isConnected, connectWallet } = useWallet();
  const { report, loading, error, refresh } = balances;
  // null until mounted. The chain list only renders after the first balances answer, which comes
  // later than this, so the default never flips under the user's eyes.
  const [wide, setWide] = useState<boolean | null>(null);
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!isConnected) {
    return (
      <section className="glass-panel rounded-card p-5" aria-labelledby="balances-title" data-testid="swap-balances">
        <h2 id="balances-title" className="flex items-center gap-2 text-[13px]/snug font-semibold text-ink">
          <Wallet className="h-4 w-4 text-accent" aria-hidden="true" /> Balances
        </h2>
        <p className="mt-2 text-[12px] text-ink-soft">Connect a wallet to see what it holds on Monad, Arbitrum, Robinhood, Base and 0G in one place.</p>
        <button type="button" onClick={() => void connectWallet()} className="mt-3 h-[40px] rounded-xl border border-line px-4 text-[12px]/snug font-semibold text-ink hover:border-line-strong">
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
          <h2 id="balances-title" className="flex items-center gap-2 text-[13px]/snug font-semibold text-ink">
            <Wallet className="h-4 w-4 text-accent" aria-hidden="true" /> Balances
          </h2>
          <p className="mt-1 text-[20px] font-semibold leading-[1.4] text-ink" data-numeric>
            {report ? formatUsd(report.totalUsd) : loading ? "…" : "—"}
          </p>
          <p className="text-[12px] text-ink-faint">
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
      <div className="mt-4 space-y-2.5">
        {chains.map((c) => {
          const info = chainFromId(c.chainId);
          const mark = info ? chainMark(info) : null;
          const open = toggled[c.chainId] ?? (wide === true || chains.length === 1);
          const regionId = `balances-chain-${c.chainId}`;
          return (
            <div key={c.chainId} className="rounded-2xl border border-line bg-surface" data-testid="balances-chain">
              <h3>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={regionId}
                  onClick={() => setToggled((t) => ({ ...t, [c.chainId]: !open }))}
                  className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-2xl px-3.5 py-2 text-left hover:bg-cream-2/60 lg:min-h-[44px]"
                >
                  <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-ink">
                    {mark && <img src={mark} alt="" aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full object-contain" />}
                    {c.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {c.error && <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-hidden="true" />}
                    <span className="text-[13px] font-semibold text-ink" data-numeric>
                      {c.error ? "—" : formatUsd(c.totalUsd)}
                    </span>
                    {c.error && <span className="sr-only">, could not be read</span>}
                    <ChevronDown className={`h-4 w-4 text-ink-faint transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                  </span>
                </button>
              </h3>
              <div id={regionId} hidden={!open} className="border-t border-line px-3.5 pb-2">
                {c.error ? (
                  <p className="flex items-start gap-1.5 pt-2 text-[12px] text-warn">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Could not read this chain right now. {c.error}
                  </p>
                ) : (
                  <ul className="divide-y divide-line text-[12px]">
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
                                <button type="button" onClick={() => onMove(c.chainId)} className="inline-flex min-h-[32px] items-center rounded-md border border-line px-2.5 text-[12px] font-semibold text-accent hover:border-accent/40 lg:min-h-0 lg:px-2 lg:py-0.5">
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
                          <Link href={`/swap?token=${encodeURIComponent(p.symbol)}&chain=${c.chainId}`} className="inline-flex min-h-[32px] items-center rounded-md border border-line px-2.5 text-[12px] font-semibold text-accent hover:border-accent/40 lg:min-h-0 lg:px-2 lg:py-0.5">
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
                          <Link href="/creator" className="inline-flex min-h-[32px] items-center rounded-md border border-line px-2.5 text-[12px] font-semibold text-accent hover:border-accent/40 lg:min-h-0 lg:px-2 lg:py-0.5">
                            Claim
                          </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* Only once the chains are in: rendered earlier, the note was pushed down by them (a layout shift on desktop). */}
      {report && (
        <p className="mt-3 text-[12px] text-ink-faint">
          Market tokens are valued at what selling them to their curve returns now, held and staked together. Only the assets ADEXTO routes are listed; other tokens in the wallet are not shown.
        </p>
      )}
    </section>
  );
}
