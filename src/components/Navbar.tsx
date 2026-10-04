"use client";

import Link from "next/link";
import WalletMenu from "@/components/WalletMenu";
import ChainSwitcher from "@/components/ChainSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import MegaMenu from "@/components/nav/MegaMenu";
import LaunchSplitButton from "@/components/nav/LaunchSplitButton";
import { NavMenuProvider } from "@/components/nav/MenuState";

/**
 * Header situs.
 *
 * Sejak U1.2 (4 Okt) tujuan navigasi TIDAK ditulis di sini lagi: semuanya di `src/config/nav.ts`,
 * satu sumber dengan tab bar ponsel dan footer. Desktop memakai dua panel (`Markets ▾  Build ▾`, lihat
 * `nav/MegaMenu.tsx`) dan tombol terbelah `Launch | ▾` (`nav/LaunchSplitButton.tsx`). Sebelumnya lima
 * tautan berderet (Explorer, Swap, Leaderboard, Agent Compute, Agents) dan bar itu sudah mepet di
 * 1024 px; Agents kini ada di panel Launch, Agent Compute di panel Build.
 *
 * Catatan lama yang masih berlaku: "Governance" dan "Deck" (/pitch) sengaja tidak ada di navigasi.
 * Halaman governance hanya menjelaskan kenapa voting tidak mungkin di desain ini, dan /pitch sudah
 * dikeluarkan dari routing (`src/app/_pitch/`).
 *
 * `useWallet` tidak dibaca di sini: ChainSwitcher dan WalletMenu memegang state-nya sendiri, jadi header
 * tidak dirender ulang di setiap event dompet.
 */
export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-line bg-cream/80 backdrop-blur-xl">
      <NavMenuProvider>
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        {/* self-stretch: <nav> mega menu setinggi header, supaya panel mulai tepat di bawah header dan
            kursor yang turun dari trigger tidak pernah keluar dari wadahnya. */}
        <div className="flex min-w-0 items-center gap-6 self-stretch xl:gap-8">
          {/* aria-label karena di bawah 440 px wordmark disembunyikan dan logonya aria-hidden:
              tanpa label tautan ini tidak punya nama sama sekali. */}
          <Link href="/" aria-label="ADEXTO home" className="flex h-[40px] min-w-[40px] items-center gap-2.5 group shrink-0 lg:h-auto">
            {/* Slot 2.5rem. Yang penting bukan angka slotnya tapi tinggi tinta yang
                terlihat: sekitar 30px di header yang tingginya 57px. Di tema gelap
                tinta #141110 dibalik oleh aturan `img[src="/logo.svg"]` di globals.css. */}
            <img src="/logo.svg" alt="" aria-hidden="true" className="w-9 h-9 object-contain shrink-0" />
            {/* Disembunyikan di bawah 440 px. Baseline 3 Okt: di 320 px "adexto." menimpa tombol
                chain di setiap halaman (62 ERROR). Batas 380 px dari plan diukur ulang 4 Okt: di 380 px
                dengan dompet tersambung dan chain "Robinhood" logo masih tertimpa 11 px, jadi batasnya
                dinaikkan ke 440 px (sisa ruang ≥ 30 px di keadaan terlebar). Logo saja sudah cukup
                sebagai merek di ponsel. */}
            <span className="hidden font-display text-[19px] font-semibold tracking-[-0.03em] text-ink min-[440px]:inline">
              adexto<span className="text-accent">.</span>
            </span>
          </Link>

          {/* Desktop: Markets ▾  Build ▾ (≥ lg). Di bawah lg navigasi ada di tab bar bawah. */}
          <MegaMenu />
        </div>

        {/* Right Action Bar. self-stretch untuk alasan yang sama dengan sisi kiri: panel Launch. */}
        <div className="flex shrink-0 items-center gap-2 self-stretch sm:gap-3">
          {/* Tema, desktop. Ikon X dan GitHub dicabut dari header (2026-09-30): keduanya ada di
              baris bawah footer setiap halaman, bersama Docs. */}
          <div className="hidden md:flex items-center gap-1 border-r border-line pr-2 mr-1">
            <ThemeToggle />
          </div>
          {/* Di bawah lg (ponsel dan tablet, layar sentuh) setiap kontrol header 40 px tingginya;
              mulai lg kembali 31,5 px (`h-9`) seperti sebelumnya. */}

          {/* Network + wallet.
              Di `sm` ke atas keduanya satu segmented control. JANGAN tambahkan
              `overflow-hidden` pada wadahnya: panel dropdown kedua anaknya diposisikan
              absolut di dalam wrapper masing-masing, dan overflow-hidden pernah
              memangkasnya jadi sepotong setinggi 31px (lihat scripts/check-navbar-menus.mjs).

              Di bawah `sm` keduanya berdiri sendiri. Switcher dulu disembunyikan ke drawer
              hamburger; drawer itu diganti tab bar bawah (MobileTabBar), jadi switcher kini
              langsung terlihat di top bar — di situs ini chain menentukan token mana yang
              dibeli, jadi ia tidak boleh tersembunyi di ponsel. */}
          <div className="flex items-center gap-2">
            {/* 42 px di sm–lg: bingkai 1 px di atas-bawah, jadi kedua segmen di dalamnya tepat 40 px. */}
            <div className="hidden h-[42px] items-stretch rounded-xl border border-line bg-gradient-to-b from-surface to-cream-2 shadow-[var(--shadow-sm)] sm:inline-flex lg:h-9">
              <ChainSwitcher variant="grouped" />
              <WalletMenu variant="grouped" />
            </div>
            <div className="flex items-center gap-2 sm:hidden">
              <ChainSwitcher />
              <WalletMenu />
            </div>
          </div>

          {/* Satu-satunya tombol berwarna di bar ini — langkah berikutnya di seluruh situs.
              Bagian "Launch" tetap tautan langsung ke /studio; ▾ (≥ lg) membuka panel Launch. */}
          <LaunchSplitButton />
        </div>
      </div>
      </NavMenuProvider>
    </header>
  );
}
