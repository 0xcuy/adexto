"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, LayoutGrid } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { MOBILE_LAUNCH_ITEMS, MOBILE_TABS, MORE_ITEMS, isNavActive } from "@/config/nav";

/**
 * Navigasi bawah untuk ponsel (di bawah `lg`).
 *
 * Menggantikan drawer hamburger. Drawer menyembunyikan SEMUA tujuan di balik satu ketukan
 * di pojok kanan atas — area yang paling sulit dijangkau jempol — sementara lima tujuan
 * utama di sini selalu terlihat dan berada tepat di bawah jempol.
 *
 * Lembar "More" sengaja PENDEK (keputusan owner 4 Okt 14:30): hanya tujuan yang tidak ada di tab
 * bawah, di footer, atau di landing — Leaderboard, Agents, Rewards (`MORE_ITEMS` di nav.ts) — lalu
 * pilihan tema. Versi berkelompok sebelumnya (11 tujuan + sosial) terbaca seperti menu restoran.
 *
 * Tab Launch membuka lembar kecil dengan dua jalan, Studio dan Agent (`MOBILE_LAUNCH_ITEMS`, permintaan owner
 * 6 Okt), sama dengan dua kartu besar panel Launch di desktop. Hanya satu lembar terbuka pada satu waktu.
 *
 * Semua ikon tab duduk di slot setinggi pil Launch, supaya kelima label berada di satu garis.
 *
 * Murni navigasi: tidak membaca dompet, chain, atau data pasar apa pun.
 */
type SheetKey = "more" | "launch";

/** Lembar duduk di atas tab bar (tidak pernah menutupinya) dan tidak pernah lebih tinggi dari ruang di atasnya. */
const SHEET_STYLE: CSSProperties = {
  bottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom))",
  maxHeight: "calc(100dvh - var(--tabbar-h) - env(safe-area-inset-bottom) - 12px)",
};

function sheetClass(open: boolean) {
  return `fixed inset-x-0 z-[56] overflow-y-auto overscroll-contain rounded-t-card border-t border-line bg-cream-2 px-3 pb-3 pt-2 shadow-[var(--shadow-lift)] transition-[transform,opacity] duration-300 ease-settle lg:hidden ${
    open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
  }`;
}

export default function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState<SheetKey | null>(null);
  const buttons = { more: useRef<HTMLButtonElement>(null), launch: useRef<HTMLButtonElement>(null) };
  const sheets = { more: useRef<HTMLDivElement>(null), launch: useRef<HTMLDivElement>(null) };

  // Lembar ditutup setiap kali rute berubah, supaya tidak tertinggal menutupi halaman baru.
  useEffect(() => {
    setOpen(null);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    // Fokus masuk ke lembar saat dibuka (tautan pertama), dan kembali ke tombolnya saat Esc.
    sheets[open].current?.querySelector<HTMLElement>("a[href]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(null);
      buttons[open].current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // `buttons` dan `sheets` hanya membungkus ref yang stabil, jadi cukup bergantung pada `open`.
  }, [open]);

  const toggle = (key: SheetKey) => setOpen((v) => (v === key ? null : key));
  const moreOpen = open === "more";
  const launchOpen = open === "launch";
  const moreActive = MORE_ITEMS.some((i) => isNavActive(pathname, i));

  return (
    <>
      {/* Latar lembar. Menutup saat diketuk di luar lembar. */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(null)}
        className={`fixed inset-0 z-[55] bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Lembar "Launch" — dua jalan: Studio dan Agent. */}
      <div
        ref={sheets.launch}
        id="mobile-launch-sheet"
        role="dialog"
        aria-label="Launch"
        aria-hidden={!launchOpen}
        data-shell
        className={sheetClass(launchOpen)}
        style={SHEET_STYLE}
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
        <p className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Launch</p>
        <ul className="grid grid-cols-2 gap-2">
          {MOBILE_LAUNCH_ITEMS.map((item) => {
            const active = isNavActive(pathname, item);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex">
                <Link
                  href={item.href}
                  tabIndex={launchOpen ? 0 : -1}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(null)}
                  className={`flex flex-1 flex-col gap-3 rounded-panel border p-3 transition-colors ${
                    active ? "border-accent/50 bg-accent-soft" : "border-line bg-cream-3/60 hover:border-accent/40 active:bg-cream-3"
                  }`}
                >
                  <span className="flex h-[36px] w-[36px] items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <span className="block">
                    <span className="flex items-center gap-1.5 text-[16px] font-semibold text-ink">
                      {item.short ?? item.label}
                      <ArrowRight className="h-[14px] w-[14px] text-ink-faint" aria-hidden="true" />
                    </span>
                    <span className="mt-1 block text-[12px] leading-snug text-ink-soft">{item.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Lembar "More" — naik dari balik tab bar. */}
      <div
        ref={sheets.more}
        id="mobile-more-sheet"
        role="dialog"
        aria-label="More"
        aria-hidden={!moreOpen}
        className={sheetClass(moreOpen)}
        // Di HP pendek (640 px) isinya digulir di dalam lembar, bukan terpotong.
        style={SHEET_STYLE}
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
        <nav aria-label="More pages">
          <ul className="space-y-0.5">
            {MORE_ITEMS.map((item) => {
              const active = isNavActive(pathname, item);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    tabIndex={moreOpen ? 0 : -1}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(null)}
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
        </nav>
        <div className="mt-2 border-t border-line pt-2">
          {moreOpen && <ThemeToggle variant="row" />}
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
            const tone = active || (primary && launchOpen) ? "text-accent" : "text-ink-soft hover:text-ink";
            const tabClass = `group flex flex-1 flex-col items-center justify-center gap-1 text-[12px] font-medium transition-colors ${tone}`;
            if (primary) {
              return (
                <li key={href} className="flex">
                  <button
                    ref={buttons.launch}
                    type="button"
                    onClick={() => toggle("launch")}
                    aria-expanded={launchOpen}
                    aria-controls="mobile-launch-sheet"
                    aria-current={active ? "page" : undefined}
                    className={tabClass}
                  >
                    <span className="flex h-8 w-12 items-center justify-center rounded-full bg-accent text-white shadow-[var(--glow-accent)] transition-transform duration-150 group-active:scale-95">
                      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <span>{label}</span>
                  </button>
                </li>
              );
            }
            return (
              <li key={href} className="flex">
                <Link href={href} aria-current={active ? "page" : undefined} className={tabClass}>
                  <span className="flex h-8 items-center justify-center">
                    <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                  </span>
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex">
            <button
              ref={buttons.more}
              type="button"
              onClick={() => toggle("more")}
              aria-expanded={moreOpen}
              aria-controls="mobile-more-sheet"
              className={`flex flex-1 flex-col items-center justify-center gap-1 text-[12px] font-medium transition-colors ${
                moreOpen || moreActive ? "text-accent" : "text-ink-soft hover:text-ink"
              }`}
            >
              <span className="flex h-8 items-center justify-center">
                <LayoutGrid className="h-5 w-5" strokeWidth={moreOpen ? 2.2 : 1.8} aria-hidden="true" />
              </span>
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
