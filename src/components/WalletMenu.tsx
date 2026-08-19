"use client";

import { useEffect, useRef, useState } from "react";
import { Wallet, LogOut, Copy, Check, RefreshCw, ChevronDown, Users } from "lucide-react";
import { useWallet } from "@/context/WalletContext";

/**
 * Menu wallet: sambung, ganti wallet, ganti akun, salin alamat, putuskan.
 *
 * Sebelumnya UI hanya punya tombol "Connect" dan ikon logout di navbar, sehingga
 * di halaman trading tidak ada cara mengganti wallet atau akun sama sekali.
 * Wallet ditemukan lewat EIP-6963, jadi kalau terpasang beberapa (MetaMask, Rabby,
 * OKX) semuanya bisa dipilih — bukan hanya pemenang lomba injeksi `window.ethereum`.
 */
export default function WalletMenu({ compact = false }: { compact?: boolean }) {
  const {
    address,
    isConnected,
    isConnecting,
    connectWallet,
    disconnectWallet,
    availableWallets,
    activeWallet,
    switchWallet,
    changeAccount,
    chainName,
    walletChainId,
  } = useWallet();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard bisa ditolak; biarkan senyap, alamatnya tetap terlihat di menu
    }
  };

  // ── Belum tersambung ──────────────────────────────────────────────────────
  if (!isConnected) {
    const many = availableWallets.length > 1;
    return (
      <div className="relative" ref={boxRef}>
        <button
          type="button"
          onClick={() => (many ? setOpen((v) => !v) : connectWallet())}
          disabled={isConnecting}
          aria-haspopup={many ? "menu" : undefined}
          aria-expanded={many ? open : undefined}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-accent hover:bg-accent-strong font-semibold text-white shadow-lg shadow-accent/10 transition-all hover:shadow-accent/10 disabled:opacity-60 ${
            compact ? "w-full justify-center py-2.5 text-xs" : "px-3.5 py-2 text-[11px] sm:text-xs"
          }`}
        >
          <Wallet className="h-3.5 w-3.5 shrink-0" />
          {isConnecting ? "Connecting…" : many ? "Choose wallet" : "Connect wallet"}
          {many && <ChevronDown className="h-3 w-3 shrink-0" />}
        </button>

        {open && many && (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-line bg-white p-1.5 shadow-2xl"
          >
            <p className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-faint">
              {availableWallets.length} wallets detected
            </p>
            {availableWallets.map((w) => (
              <button
                key={w.info.rdns}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  connectWallet(w.info.rdns);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs font-bold text-ink hover:bg-cream-3"
              >
                {w.info.icon ? (
                  <img src={w.info.icon} alt="" className="h-5 w-5 rounded" />
                ) : (
                  <Wallet className="h-5 w-5 text-accent" />
                )}
                <span className="truncate">{w.info.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Sudah tersambung ──────────────────────────────────────────────────────
  const others = availableWallets.filter((w) => w.info.rdns !== activeWallet?.rdns);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Wallet options"
        className={`inline-flex items-center gap-2 rounded-xl border border-line bg-white transition-colors hover:border-accent/30 ${
          compact ? "w-full justify-between px-3 py-2" : "px-2.5 py-1.5"
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {activeWallet?.icon ? (
            <img src={activeWallet.icon} alt="" className="h-4 w-4 rounded shrink-0" />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-ok" />
          )}
          <span className="truncate font-mono text-[11px] font-bold text-ink">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </span>
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-ink-soft" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-line bg-white p-1.5 shadow-2xl"
        >
          <div className="border-b border-line px-2 pb-2 pt-1.5">
            <p className="text-[10px] font-mono uppercase tracking-wider text-ink-faint">
              {activeWallet?.name ?? "Injected wallet"}
            </p>
            <p className="mt-0.5 break-all font-mono text-[10px] text-ink-soft">{address}</p>
            <p className="mt-1 font-mono text-[10px] text-accent">
              {chainName}
              {walletChainId !== null && <span className="text-ink-faint"> · wallet on {walletChainId}</span>}
            </p>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={copy}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-bold text-ink hover:bg-cream-3"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Address copied" : "Copy address"}
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              changeAccount();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-bold text-ink hover:bg-cream-3"
          >
            <Users className="h-3.5 w-3.5 text-accent" />
            Change account
          </button>

          {others.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[10px] font-mono uppercase tracking-wider text-ink-faint">
                Switch wallet
              </p>
              {others.map((w) => (
                <button
                  key={w.info.rdns}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    switchWallet(w.info.rdns);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs font-bold text-ink hover:bg-cream-3"
                >
                  {w.info.icon ? (
                    <img src={w.info.icon} alt="" className="h-4 w-4 rounded" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate">{w.info.name}</span>
                </button>
              ))}
            </>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              disconnectWallet();
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-line px-2 py-2 text-left text-xs font-bold text-danger hover:bg-danger/10"
          >
            <LogOut className="h-3.5 w-3.5" />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
