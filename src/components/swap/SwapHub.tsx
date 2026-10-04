"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, Repeat } from "lucide-react";

import SwapTerminal from "@/components/SwapTerminal";
import CrossChainSwap from "@/components/swap/CrossChainSwap";
import BalancesPanel from "@/components/swap/BalancesPanel";
import RecentTransfers from "@/components/swap/RecentTransfers";
import { useRecentTransfers } from "@/components/swap/useRecentTransfers";
import { useSwapBalances } from "@/components/swap/useSwapBalances";
import { useWallet } from "@/context/WalletContext";

type Mode = "trade" | "cross-chain";

/**
 * /swap: one page for every exchange the site offers, so the menu does not grow.
 *
 *   Trade        buy or sell an ADEXTO market token against its own curve (SwapTerminal,
 *                unchanged).
 *   Cross-chain  move native or a stablecoin between the five chains, routed by LI.FI.
 *
 * Next to both (beside the card from lg, under it on phones) sit Balances (what the wallet holds on
 * all five chains) and Recent transfers (its cross-chain transfers through ADEXTO, from any device).
 * `?mode=cross-chain` opens the second mode, so it can be linked; `?token=` keeps opening Trade as
 * it always did.
 */
export default function SwapHub() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { address } = useWallet();
  const balances = useSwapBalances(address);
  const recent = useRecentTransfers(address, balances.refreshSoon);

  const urlMode: Mode = params.get("mode") === "cross-chain" && !params.get("token") ? "cross-chain" : "trade";
  const [mode, setModeState] = useState<Mode>(urlMode);
  const [preset, setPreset] = useState<{ fromChainId: number; nonce: number } | null>(null);

  const setMode = (m: Mode) => {
    setModeState(m);
    const next = new URLSearchParams(params.toString());
    if (m === "cross-chain") {
      next.set("mode", "cross-chain");
      next.delete("token");
      next.delete("chain");
    } else next.delete("mode");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const onMove = (fromChainId: number) => {
    setPreset({ fromChainId, nonce: Date.now() });
    if (mode !== "cross-chain") setMode("cross-chain");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const modes: Array<{ id: Mode; label: string; icon: React.ReactNode }> = [
    { id: "trade", label: "Trade", icon: <Repeat className="h-[14px] w-[14px]" aria-hidden="true" /> },
    { id: "cross-chain", label: "Cross-chain", icon: <ArrowLeftRight className="h-[14px] w-[14px]" aria-hidden="true" /> },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:max-w-5xl lg:px-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <p className="kicker mb-3">{mode === "trade" ? "Sovereign bonding curve" : "Five chains, one wallet"}</p>
        <h1 className="font-display text-[28px] font-light leading-[1.1] tracking-tight text-ink sm:text-[36px]">Swap</h1>
        <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-ink-soft">
          {mode === "trade"
            ? "Trade straight against a market's own curve. No shared pool, and nothing is routed anywhere else."
            : "Move ETH, MON, 0G or stablecoins between Monad, Arbitrum, Robinhood, Base and 0G."}
        </p>
      </div>

      {/* Phones: one column, the wallet under the swap card. From lg the wallet sits beside the card, so a wallet with
          many chains no longer pushes the page a few screens down. */}
      <div className="mx-auto max-w-md lg:grid lg:max-w-none lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="min-w-0">
          <div role="tablist" aria-label="Swap mode" className="mb-4 flex rounded-xl border border-line bg-cream-2 p-1 text-[13px]/snug">
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                id={`swap-mode-${m.id}`}
                aria-selected={mode === m.id}
                aria-controls={`swap-panel-${m.id}`}
                tabIndex={mode === m.id ? 0 : -1}
                onClick={() => setMode(m.id)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const other = m.id === "trade" ? "cross-chain" : "trade";
                    setMode(other);
                    document.getElementById(`swap-mode-${other}`)?.focus();
                  }
                }}
                className={`flex h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors lg:h-[34px] ${
                  mode === m.id ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"
                }`}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          <div id="swap-panel-trade" role="tabpanel" aria-labelledby="swap-mode-trade" hidden={mode !== "trade"}>
            <SwapTerminal embedded />
          </div>
          <div id="swap-panel-cross-chain" role="tabpanel" aria-labelledby="swap-mode-cross-chain" hidden={mode !== "cross-chain"}>
            {mode === "cross-chain" && <CrossChainSwap balances={balances} preset={preset} onSent={recent.add} />}
          </div>
        </div>

        <aside aria-label="Wallet" className="mt-6 min-w-0 lg:mt-0" data-testid="swap-wallet">
          <BalancesPanel balances={balances} onMove={onMove} />
          <RecentTransfers recent={recent} hold={Boolean(address) && !balances.report && !balances.error} />
        </aside>
      </div>
    </div>
  );
}
