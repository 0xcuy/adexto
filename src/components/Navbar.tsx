"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass, ArrowDownUp, CloudLightning,
  ShieldCheck, Sparkles, Twitter, Github
} from "lucide-react";
import WalletMenu from "@/components/WalletMenu";
import ChainSwitcher from "@/components/ChainSwitcher";
import ThemeToggle from "@/components/ThemeToggle";

export default function Navbar() {
  const pathname = usePathname();
  // `useWallet` is no longer read here: the chain indicator became ChainSwitcher,
  // which owns that state itself, so the navbar no longer re-renders on every
  // wallet event just to print one word.

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
   *
   * "Governance" DICABUT, dan bukan karena halamannya belum selesai. Halaman itu
   * seluruhnya menjelaskan bahwa voting tidak mungkin — dan tidak akan pernah mungkin
   * di desain ini. Diperiksa, bukan diingat: `governanceToken` di 0G dan Arbitrum
   * menunjuk `SovereignHook`, kontrak 1.495 byte tanpa `symbol()` dan tanpa
   * `balanceOf()`, sementara di Base dan Monad ia alamat nol. Satuan suaranya "ADAI",
   * token yang tidak pernah ada. Dan target yang katanya diperintah — parameter fee
   * hook — `immutable` sejak v1.
   *
   * Yang menutup pilihannya: `execute` hanya bisa melakukan apa yang alamat governor
   * sudah diizinkan lakukan, dan tidak ada satu pun setter di jalur peluncuran.
   * Memberinya kuasa berarti menambah permukaan admin, yaitu hal yang /security
   * nyatakan tidak ada. Jadi menu yang isinya penjelasan kenapa sebuah tombol tidak
   * ada, lebih baik tidak menjadi menu.
   */
  const links = [
    { href: "/explorer", label: "Explorer", icon: Compass },
    { href: "/swap", label: "Swap", icon: ArrowDownUp },
    /**
     * Agent Compute di posisi ketiga, sesudah Swap.
     *
     * Sempat ditaruh paling depan dengan alasan ia satu-satunya butir yang bicara soal utilitas
     * token. Urutan ini lebih baik: Explorer dan Swap adalah yang dicari orang yang datang untuk
     * berdagang, dan menaruh fitur baru di depan keduanya menggeser jalur yang sudah dikenal
     * pengunjung demi menonjolkan yang belum mereka cari.
     */
    { href: "/agent-compute", label: "Agent Compute", icon: Sparkles },
    { href: "/agent/demo", label: "Agent demo", icon: CloudLightning },
    { href: "/docs", label: "Docs", icon: ShieldCheck },
    /**
     * Entri "Deck" ke /pitch DICABUT bersama rutenya.
     *
     * Halaman itu dipindahkan ke `src/app/_pitch/` — awalan garis bawah membuat Next
     * mengeluarkan folder dari routing, jadi sumbernya utuh sementara alamatnya tidak
     * ada. Tautan yang dibiarkan di sini akan menjadi 404 di navigasi utama.
     */
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-line bg-cream/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        {/* gap-6 dan px-2.5 di lg: tepat di 1024px kiri butuh 561px tapi hanya dapat 549px, dan
            "Agent Compute" / "Agent demo" patah jadi dua baris. Ukuran penuh kembali mulai xl. */}
        <div className="flex min-w-0 items-center gap-6 xl:gap-8">
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            {/* Slot 2.5rem. Yang penting bukan angka slotnya tapi tinggi tinta yang
                terlihat: sekitar 30px di header yang tingginya 57px. Di tema gelap
                tinta #141110 dibalik oleh aturan `img[src="/logo.svg"]` di globals.css. */}
            <img src="/logo.svg" alt="" aria-hidden="true" className="w-9 h-9 object-contain shrink-0" />
            <span className="font-display text-[19px] font-semibold tracking-[-0.03em] text-ink">
              adexto<span className="text-accent">.</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {links.map((link) => {
              const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap px-2.5 py-1.5 rounded-full text-[14px] font-medium transition-colors duration-150 xl:px-3 ${
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
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Social + tema, desktop.
              X dan GitHub disembunyikan di lg–xl (1024–1279px), tema tetap. Di lebar itu nav
              desktop baru muncul dan header paling sempit: sejak chain bawaan Monad (dan
              "Arbitrum" lebih lebar lagi), pil chain melebar dan "Agent Compute" kembali patah.
              Kedua tautan tetap ada di footer setiap halaman. */}
          <div className="hidden md:flex items-center gap-1 border-r border-line pr-2 mr-1">
            <a
              href="https://x.com/adexto_"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-xl text-ink-soft hover:text-accent hover:bg-cream-3 transition-colors lg:max-xl:hidden"
              title="X (Twitter) @adexto_"
            >
              <Twitter className="w-4 h-4" />
            </a>
            <a
              href="https://github.com/0xcuy/adexto"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-xl text-ink-soft hover:text-accent hover:bg-cream-3 transition-colors lg:max-xl:hidden"
              title="GitHub Open-Source Repo"
            >
              <Github className="w-4 h-4" />
            </a>
            <ThemeToggle />
          </div>

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
            <div className="hidden h-9 items-stretch rounded-xl border border-line bg-gradient-to-b from-surface to-cream-2 shadow-[var(--shadow-sm)] sm:inline-flex">
              <ChainSwitcher variant="grouped" />
              <WalletMenu variant="grouped" />
            </div>
            <div className="flex items-center gap-2 sm:hidden">
              <ChainSwitcher />
              <WalletMenu />
            </div>
          </div>

          {/* Satu-satunya tombol berwarna di bar ini — langkah berikutnya di seluruh situs.
              `h-9` sama dengan segmented control di sebelahnya (rem situs ini 14px). */}
          <Link
            href="/studio"
            className="btn-glow hidden sm:inline-flex h-9 items-center px-4 rounded-xl text-[13px] font-semibold bg-accent hover:bg-accent-strong text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          >
            Launch
          </Link>
        </div>
      </div>
    </header>
  );
}
