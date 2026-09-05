"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass, ArrowDownUp, CloudLightning,
  Award, ShieldCheck, Sparkles, Vote, Menu, X, Twitter, Github
} from "lucide-react";
import WalletMenu from "@/components/WalletMenu";
import ChainSwitcher from "@/components/ChainSwitcher";

export default function Navbar() {
  const pathname = usePathname();
  // `useWallet` is no longer read here: the chain indicator became ChainSwitcher,
  // which owns that state itself, so the navbar no longer re-renders on every
  // wallet event just to print one word.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  /**
   * Label dipendekkan menjadi satu kata di mana pun mungkin.
   *
   * Sebelumnya: "Live Explorer", "DEX Swap", "DAO Governance", "TEE Demo (x402)",
   * "Grant Deck", "Specs" — enam label, masing-masing dengan ikon, di sebelah blok
   * merek dua baris yang juga membawa pil "adexto.xyz". Pada 1280 px semuanya
   * mepet dan bar itu sendiri sudah terasa seperti halaman.
   * "Live", "DEX", "DAO" dan "TEE" adalah kata sifat pemasaran di dalam navigasi;
   * tujuannya tetap sama tanpa kata-kata itu. Ikon juga dilepas di desktop —
   * dengan enam label yang sudah jelas, ikon hanya menambah bentuk untuk dipilah
   * mata. Di drawer mobile ikon tetap ada, karena di sana ia jadi target sentuh.
   */
  const links = [
    { href: "/explorer", label: "Explorer", icon: Compass },
    { href: "/swap", label: "Swap", icon: ArrowDownUp },
    { href: "/governance", label: "Governance", icon: Vote },
    { href: "/agent/demo", label: "Agent demo", icon: CloudLightning },
    { href: "/docs", label: "Docs", icon: ShieldCheck },
    { href: "/pitch", label: "Deck", icon: Award },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-line bg-cream-2/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 group shrink-0" onClick={() => setMobileMenuOpen(false)}>
            <img src="/logo.svg" alt="" aria-hidden="true" className="w-7 h-7 object-contain shrink-0" />
            <span className="font-semibold tracking-tight text-ink text-[15px]">ADEXTO</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                    active ? "text-ink bg-cream-3" : "text-ink-soft hover:text-ink hover:bg-cream-3"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Social Icons Desktop */}
          <div className="hidden md:flex items-center gap-1.5 border-r border-line pr-2 mr-1">
            <a
              href="https://x.com/adexto_"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-xl text-ink-soft hover:text-accent hover:bg-cream-3 transition-colors"
              title="X (Twitter) @adexto_"
            >
              <Twitter className="w-4 h-4" />
            </a>
            <a
              href="https://github.com/0xcuy/adexto"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-xl text-ink-soft hover:text-accent hover:bg-cream-3 transition-colors"
              title="GitHub Open-Source Repo"
            >
              <Github className="w-4 h-4" />
            </a>
          </div>

          {/* Network + wallet.
              The network used to be an unclickable label — a pulsing green dot and
              a truncated chain name jammed against the wallet button. On a site
              where every chain is an independent market, the network decides which
              token a buy would actually hit, so it has to be changeable from here.
              It is also rendered whether or not a wallet is connected: the
              selection still drives prices, explorer links and which market /swap
              opens on. */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <ChainSwitcher />
            </div>
            <WalletMenu />
          </div>

          {/* Satu-satunya tombol berwarna di bar ini. Sebelumnya berupa isian
              aksen-lembut dengan ikon percikan; sekarang isian pekat, karena inilah
              langkah berikutnya di seluruh situs dan tidak ada yang boleh
              menyainginya secara visual. */}
          <Link
            href="/studio"
            className="hidden sm:inline-flex items-center px-4 py-2 rounded-lg text-[13px] font-semibold bg-accent hover:bg-accent-strong text-white transition-colors"
          >
            Studio
          </Link>

          {/* Mobile Hamburger Toggle Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-xl bg-white border border-line text-ink hover:text-ink hover:bg-cream-3 transition-colors"
            aria-label="Toggle Mobile Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5 text-accent" /> : <Menu className="w-5 h-5 text-ink" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-cream-2 border-b border-line px-4 py-4 space-y-2 shadow-lg">
          {/* The switcher belongs here too. It is hidden in the top bar below the
              `sm` breakpoint for room, and leaving it out of the drawer would mean a
              phone user could not change network at all — on a site where the
              network decides which token a buy hits. */}
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-line">
            <span className="text-[11px] font-semibold text-ink-soft">Network</span>
            <ChainSwitcher />
          </div>

          <div className="grid grid-cols-2 gap-2 pb-2 border-b border-line">
            <Link
              href="/studio"
              onClick={() => setMobileMenuOpen(false)}
              className="p-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-semibold text-xs flex items-center gap-2 transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              <span>Studio</span>
            </Link>
            <Link
              href="/swap"
              onClick={() => setMobileMenuOpen(false)}
              className="p-3 rounded-xl bg-white border border-line text-ink font-semibold text-xs flex items-center gap-2"
            >
              <ArrowDownUp className="w-4 h-4 text-accent" />
              <span>Swap</span>
            </Link>
          </div>

          {/* /swap DIKELUARKAN dari daftar ini, bukan dari navigasinya.
              Ia sudah jadi tombol besar di grid dua kolom persis di atas, jadi kalau
              ikut di-map di sini drawer memuat "Swap" dua kali berjarak sekitar 50 px
              — pembaca berhenti untuk memastikan keduanya menuju tempat yang sama.
              Desktop tetap memakai `links` utuh, jadi urutan enam tautannya tidak
              berubah. */}
          <div className="space-y-1 pt-1 font-mono text-xs">
            {links.filter((link) => link.href !== "/swap").map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${
                    active
                      ? "bg-accent-soft text-accent font-bold border border-accent/30"
                      : "text-ink-soft hover:bg-cream-3 hover:text-ink"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 text-accent" />
                    <span>{link.label}</span>
                  </div>
                  <span className="text-[10px] text-ink-faint">→</span>
                </Link>
              );
            })}
          </div>

          {/* Social Links on Mobile */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line font-mono text-xs">
            <a
              href="https://x.com/adexto_"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-cream-3 text-ink-soft hover:text-accent flex items-center justify-center gap-2"
            >
              <Twitter className="w-4 h-4" />
              <span>@adexto_</span>
            </a>
            <a
              href="https://github.com/0xcuy/adexto"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-cream-3 text-ink-soft hover:text-accent flex items-center justify-center gap-2"
            >
              <Github className="w-4 h-4" />
              <span>GitHub</span>
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
