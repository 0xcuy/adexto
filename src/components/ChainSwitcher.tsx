"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Globe } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { CHAIN_LIST, chainFromId, type ChainInfo } from "@/lib/chains";

/**
 * Chain switcher for the navbar.
 *
 * WHAT THIS REPLACES
 *
 * The navbar used to render a dead label: a pulsing green dot and
 * `chainName.split(" ")[0]`, which produced a bare "0G" wedged against the wallet
 * button. It could not be clicked, so the only ways to change chain were the filter
 * inside /swap or switching in the wallet itself and hoping the app noticed. For a
 * site whose whole point is that each chain is a SEPARATE market, the network you
 * are on is not decoration — it decides which token you would be buying.
 *
 * WHY THE DOT WAS ALSO WRONG, NOT JUST UGLY
 *
 * A pulsing green dot reads as "this is live". It was rendered for whichever chain
 * the wallet happened to report, including chains where nothing can be traded. The
 * dot is now tied to `tradable`, so it means one specific thing: this chain has a
 * curve factory the app is actually wired to.
 *
 * ON ERRORS
 *
 * `setSelectedChain` swallows a declined switch with a console.warn, which is
 * reasonable for programmatic callers and wrong here — a user who rejects the
 * wallet prompt must not be left looking at a menu that appears to have worked. So
 * this calls `switchToChain` and surfaces the failure.
 */
export default function ChainSwitcher() {
  const { chainInfo, walletChainId, isConnected, switchToChain, setSelectedChain } = useWallet();
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape, so the menu cannot be left hanging over
  // the page after the pointer moves on.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** A chain can be traded on only when the app holds a curve factory for it. */
  const tradable = (c: ChainInfo) => Boolean(c.curveFactoryAddress);

  /**
   * True when the wallet is on a chain this app does not know at all.
   *
   * Worth surfacing rather than hiding: the app would keep showing the selected
   * chain's prices and markets while every transaction went somewhere else.
   */
  const walletOnUnknown = isConnected && walletChainId !== null && chainFromId(walletChainId) === null;
  /** Wallet is on a chain we know, but not the one selected in the UI. */
  const walletMismatch =
    isConnected && walletChainId !== null && !walletOnUnknown && walletChainId !== chainInfo.chainId;

  const pick = async (target: ChainInfo) => {
    setError(null);
    setBusyKey(target.key);
    try {
      if (isConnected) {
        // Surfaces a rejected wallet prompt instead of logging it and moving on.
        await switchToChain(target);
      } else {
        // With no wallet there is nothing to switch; the selection still drives
        // prices, explorer links and which market the swap page opens on.
        await setSelectedChain(target.key);
      }
      setOpen(false);
    } catch (e) {
      setError((e as Error).message.slice(0, 120));
    } finally {
      setBusyKey(null);
    }
  };

  const current = walletOnUnknown ? null : chainInfo;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Network: ${current ? current.name : "unsupported"}. Change network`}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
          walletOnUnknown || walletMismatch
            ? "border-warn/40 bg-warn/10 text-warn hover:bg-warn/20"
            : "border-line bg-white text-ink hover:border-line-strong"
        }`}
      >
        {walletOnUnknown ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${tradable(chainInfo) ? "bg-ok" : "bg-warn"}`}
          />
        )}
        <span className="max-w-[92px] truncate">{current ? current.key : "Unsupported"}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-2 w-[264px] overflow-hidden rounded-xl border border-line bg-white shadow-xl"
        >
          <div className="flex items-center gap-1.5 border-b border-line bg-cream-2 px-3 py-2">
            <Globe className="h-3 w-3 text-accent" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Network</span>
          </div>

          {/* Stated up front, because it is the thing that surprises people: a
              ticker on two chains is two independent tokens with two prices. */}
          <p className="border-b border-line px-3 py-2 text-[10px] leading-relaxed text-ink-soft">
            Each chain is a separate market. Switching changes which token you would
            buy, and prices differ because nothing bridges between them.
          </p>

          {walletOnUnknown && (
            <p className="flex items-start gap-1.5 border-b border-line bg-warn/10 px-3 py-2 text-[10px] leading-relaxed text-warn">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Your wallet is on chain {walletChainId}, which ADEXTO does not support. Pick one below before
                trading.
              </span>
            </p>
          )}
          {walletMismatch && (
            <p className="flex items-start gap-1.5 border-b border-line bg-warn/10 px-3 py-2 text-[10px] leading-relaxed text-warn">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Your wallet is on {chainFromId(walletChainId!)?.name ?? walletChainId} but the app is showing{" "}
                {chainInfo.name}. Selecting a chain here fixes both.
              </span>
            </p>
          )}

          <ul className="max-h-[280px] overflow-y-auto py-1">
            {CHAIN_LIST.map((c) => {
              const active = c.chainId === chainInfo.chainId && !walletOnUnknown;
              const canTrade = tradable(c);
              return (
                <li key={c.chainId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={busyKey !== null}
                    onClick={() => pick(c)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${
                      active ? "bg-accent-soft" : "hover:bg-cream-2"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${canTrade ? "bg-ok" : "bg-warn"}`}
                      />
                      <span className="min-w-0">
                        <span className={`block truncate text-[12px] font-semibold ${active ? "text-accent" : "text-ink"}`}>
                          {c.name}
                        </span>
                        <span className="block text-[10px] text-ink-soft">
                          {/* Says what the dot means, so the colour is never the
                              only carrier of the information. */}
                          {c.nativeSymbol} · {canTrade ? "launching and trading live" : "no curve factory yet"}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="font-mono text-[10px] text-ink-faint">{c.chainId}</span>
                      {busyKey === c.key ? (
                        <span className="text-[10px] text-ink-soft">…</span>
                      ) : active ? (
                        <Check className="h-3.5 w-3.5 text-accent" />
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {error && (
            <p className="border-t border-line bg-danger/10 px-3 py-2 text-[10px] leading-relaxed text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
