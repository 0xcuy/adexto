"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { MOBILE_TABS, MORE_GROUPS, SOCIAL_LINKS, isNavActive } from "@/config/nav";

/**
 * Navigasi bawah untuk ponsel (di bawah `lg`).
 *
 * Menggantikan drawer hamburger. Drawer menyembunyikan SEMUA tujuan di balik satu ketukan
 * di pojok kanan atas — area yang paling sulit dijangkau jempol — sementara lima tujuan
 * utama di sini selalu terlihat dan berada tepat di bawah jempol. Tujuan sisanya masuk ke
 * lembar "More", bersama tautan sosial dan pilihan tema.
 *
 * Isi tab dan lembar More datang dari `src/config/nav.ts` (U1.3, 4 Okt), satu sumber dengan mega menu
 * desktop dan footer. Lembar More dikelompokkan sama dengan panel desktop: Markets, Launch, Build,
 * Verify. Setiap baris 48 px, dan lembarnya digulir di dalam dirinya sendiri bila layar pendek.
 *
 * Murni navigasi: tidak membaca dompet, chain, atau data pasar apa pun.
 */
export default function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  // Lembar ditutup setiap kali rute berubah, supaya tidak tertinggal menutupi halaman baru.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    // Fokus masuk ke lembar saat dibuka (tautan pertama), dan kembali ke tombol More saat Esc.
    sheet.current?.querySelector<HTMLElement>("a[href]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMoreOpen(false);
      moreButton.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const moreActive = MORE_GROUPS.some((g) => g.items.some((i) => isNavActive(pathname, i)));

  return (
    <>
      {/* Latar lembar. Menutup saat diketuk di luar lembar. */}
      <div
        aria-hidden="true"
        onClick={() => setMoreOpen(false)}
        className={`fixed inset-0 z-[55] bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${
          moreOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Lembar "More" — naik dari balik tab bar. */}
      <div
        ref={sheet}
        id="mobile-more-sheet"
        role="dialog"
        aria-label="More"
        aria-hidden={!moreOpen}
        className={`fixed inset-x-0 z-[56] overflow-y-auto overscroll-contain rounded-t-card border-t border-line bg-cream-2 px-3 pb-3 pt-2 shadow-[var(--shadow-lift)] transition-[transform,opacity] duration-300 ease-settle lg:hidden ${
          moreOpen ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
        }`}
        // Duduk di atas tab bar (tidak pernah menutupinya) dan tidak pernah lebih tinggi dari ruang
        // di atasnya: di HP pendek (640 px) isinya digulir di dalam lembar, bukan terpotong.
        style={{
          bottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom))",
          maxHeight: "calc(100dvh - var(--tabbar-h) - env(safe-area-inset-bottom) - 12px)",
        }}
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
        <nav aria-label="More pages" className="space-y-2">
          {MORE_GROUPS.map((group) => (
            <div key={group.key} role="group" aria-labelledby={`more-group-${group.key}`}>
              <p
                id={`more-group-${group.key}`}
                className="px-3 pb-0.5 pt-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint"
              >
                {group.label}
              </p>
              <ul>
                {group.items.map((item) => {
                  const active = isNavActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        tabIndex={moreOpen ? 0 : -1}
                        aria-current={active ? "page" : undefined}
                        // Tautan #anchor di rute yang sama tidak mengganti pathname, jadi tutup di sini juga.
                        onClick={() => setMoreOpen(false)}
                        className={`flex min-h-[48px] items-center gap-3 rounded-panel px-3 text-[14px] font-medium transition-colors ${
                          active ? "bg-accent-soft text-accent" : "text-ink hover:bg-cream-3"
                        }`}
                      >
                        <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                          <Icon className="h-[16px] w-[16px]" aria-hidden="true" />
                        </span>
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="mt-2 border-t border-line pt-2">
          {moreOpen && <ThemeToggle variant="row" />}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-line pt-3">
          {SOCIAL_LINKS.map(({ href, label, name, icon: Icon }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={moreOpen ? 0 : -1}
              title={name}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-panel bg-cream-3 text-[12px] font-medium text-ink-soft hover:text-ink"
            >
              <Icon className="h-[16px] w-[16px] shrink-0" aria-hidden="true" />
              <span>{label}</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ))}
        </div>
      </div>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-[57] border-t border-line bg-cream-2/90 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid h-[var(--tabbar-h)] max-w-lg grid-cols-5">
          {MOBILE_TABS.map(({ href, label, icon: Icon, match, primary }) => {
            const active = isNavActive(pathname, { href, match });
            return (
              <li key={href} className="flex">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`group flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                    active ? "text-accent" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {primary ? (
                    <span
                      className={`flex h-8 w-12 items-center justify-center rounded-full bg-accent text-white shadow-[var(--glow-accent)] transition-transform duration-150 group-active:scale-95`}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                  ) : (
                    <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} />
                  )}
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex">
            <button
              ref={moreButton}
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-controls="mobile-more-sheet"
              className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                moreOpen || moreActive ? "text-accent" : "text-ink-soft hover:text-ink"
              }`}
            >
              <LayoutGrid className="h-5 w-5" strokeWidth={moreOpen ? 2.2 : 1.8} />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
