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
/**
 * Avatar dua warna yang diturunkan DARI alamatnya sendiri.
 *
 * Bukan hiasan. Tombol ini menampilkan `0x8a3c…ee7d`, dan enam karakter di tengah yang
 * dipotong itulah yang membedakan satu akun dari akun lain — dua alamat dari dompet yang sama
 * sering berbagi awalan, jadi bentuk terpotongnya bisa terlihat nyaris identik. Warna yang
 * ditentukan alamat bisa dikenali dalam sekali lihat, sehingga "saya di akun yang salah"
 * terlihat tanpa membaca hex.
 *
 * Dihitung, bukan diambil dari layanan: tidak ada permintaan jaringan, dan alamat yang sama
 * selalu memberi warna yang sama di perangkat mana pun.
 *
 * KENAPA PALET TERKURASI, BUKAN HSL ACAK
 *
 * Percobaan pertama memetakan alamat ke seluruh roda warna: `hsl(hue 58% 60%)` dengan hue apa
 * saja dari 0 sampai 359. Hasilnya benar secara fungsi dan salah secara tampilan — alamat yang
 * dipotret pertama kali menghasilkan gradien hijau ke merah di tengah navbar krem dan ungu, dan
 * satu petak warna yang bukan bagian dari palet mana pun justru membuat sudut itu terlihat
 * lebih murah, bukan lebih mahal. Warna acak bukan kemewahan.
 *
 * Dua belas duotone di bawah semuanya duduk di dalam keluarga situs ini: ungu, indigo, teal,
 * amber, rose, sekam — jenuh sedang, terang sedang. Alamat memilih SALAH SATU, jadi sifat
 * "bisa dikenali" tetap ada sementara hasilnya tidak mungkin bertabrakan dengan halamannya.
 */
const AVATAR_DUOTONES: ReadonlyArray<readonly [string, string]> = [
  ["#8b5cf6", "#5b21b6"], // violet
  ["#6366f1", "#3730a3"], // indigo
  ["#0ea5e9", "#0c4a6e"], // sky
  ["#14b8a6", "#0f766e"], // teal
  ["#10b981", "#065f46"], // emerald
  ["#84cc16", "#3f6212"], // lime, ditenangkan
  ["#f59e0b", "#b45309"], // amber
  ["#f97316", "#9a3412"], // orange
  ["#f43f5e", "#9f1239"], // rose
  ["#ec4899", "#9d174d"], // pink
  ["#a78bfa", "#6d28d9"], // violet terang
  ["#64748b", "#334155"], // slate, untuk yang netral
];

function addressGradient(address: string): string {
  const hex = address.replace(/^0x/, "");
  // Dua ujung alamat dipakai, bukan satu: enam karakter awal yang terlihat di tombol bisa sama
  // antar akun dari dompet yang sama, jadi memilih hanya dari awalan akan memberi warna kembar
  // pada dua akun yang justru paling sering tertukar.
  const i = parseInt(hex.slice(0, 6), 16) % AVATAR_DUOTONES.length;
  const angle = 90 + (parseInt(hex.slice(-2), 16) % 4) * 45;
  const [from, to] = AVATAR_DUOTONES[i];
  return `linear-gradient(${angle}deg, ${from}, ${to})`;
}

export default function WalletMenu({
  compact = false,
  variant = "solo",
}: {
  compact?: boolean;
  /** Lihat catatan varian di `ChainSwitcher`: `grouped` melepas border dan radiusnya sendiri. */
  variant?: "solo" | "grouped";
}) {
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

  const grouped = variant === "grouped";

  return (
    <div className={grouped ? "relative flex" : "relative"} ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Wallet options"
        className={[
          "inline-flex items-center gap-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35",
          grouped
            // Pembatasnya adalah border kiri segmen ini, bukan elemen tersendiri — satu
            // hairline yang tidak bisa bergeser dari pasangannya.
            ? "h-full rounded-r-[11px] border-l border-line px-3 hover:bg-white"
            : `rounded-xl border border-line bg-white hover:border-accent/30 ${
                compact ? "w-full justify-between px-3 py-2" : "px-2.5 py-1.5"
              }`,
        ].join(" ")}
      >
        <span className="flex items-center gap-2 min-w-0">
          {activeWallet?.icon ? (
            <img src={activeWallet.icon} alt="" className="h-[18px] w-[18px] rounded-[5px] shrink-0" />
          ) : address ? (
            /* Menggantikan titik hijau berdenyut.
               Denyutnya mengaku "live" padahal yang diketahuinya cuma "ada alamat" — kritik
               yang sama sudah tercatat untuk titik berdenyut di navbar, dan berlaku di sini
               juga. Adanya alamat DI tombol sudah menjadi tanda tersambung, jadi ruang 18px
               itu lebih berguna untuk membedakan akun. */
            <span
              aria-hidden="true"
              className="h-[18px] w-[18px] shrink-0 rounded-[5px] ring-1 ring-black/[0.06]"
              style={{ backgroundImage: addressGradient(address) }}
            />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
          )}
          <span className="truncate font-mono text-[11px] font-bold tracking-tight text-ink">
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
