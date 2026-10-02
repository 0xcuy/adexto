"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  ArrowDownUp,
  Rocket,
  Cpu,
  LayoutGrid,
  CloudLightning,
  BookOpen,
  ShieldCheck,
  FileText,
  Plug,
  Bot,
  Twitter,
  Github,
  ArrowUpRight,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

/**
 * Navigasi bawah untuk ponsel (di bawah `lg`).
 *
 * Menggantikan drawer hamburger. Drawer menyembunyikan SEMUA tujuan di balik satu ketukan
 * di pojok kanan atas — area yang paling sulit dijangkau jempol — sementara lima tujuan
 * utama di sini selalu terlihat dan berada tepat di bawah jempol. Tujuan sisanya masuk ke
 * lembar "More", bersama tautan sosial dan pilihan tema.
 *
 * Urutannya mengikuti navbar desktop: Markets dan Swap untuk orang yang datang berdagang,
 * Launch di tengah sebagai langkah utama situs, lalu Compute.
 *
 * Murni navigasi: tidak membaca dompet, chain, atau data pasar apa pun.
 */

const TABS = [
  { href: "/explorer", label: "Markets", icon: Compass, match: ["/explorer", "/token"] },
  { href: "/swap", label: "Swap", icon: ArrowDownUp, match: ["/swap"] },
  { href: "/studio", label: "Launch", icon: Rocket, match: ["/studio"], primary: true },
  { href: "/agent-compute", label: "Compute", icon: Cpu, match: ["/agent-compute"] },
];

const MORE_LINKS = [
  { href: "/agent/demo", label: "Agent demo", icon: CloudLightning },
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/x402", label: "x402 API", icon: Plug },
  // Plan 1: direktori agen, tepat sesudah "x402 API" (posisi dipatok di .kiro/plans/README.md §3).
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/security", label: "Security", icon: ShieldCheck },
  { href: "/whitepaper", label: "Whitepaper", icon: FileText },
];

export default function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);

  // Lembar ditutup setiap kali rute berubah, supaya tidak tertinggal menutupi halaman baru.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const isActive = (match: string[]) => match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
  const moreActive = MORE_LINKS.some((l) => pathname === l.href || pathname.startsWith(`${l.href}/`));

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
        id="mobile-more-sheet"
        role="dialog"
        aria-label="More"
        aria-hidden={!moreOpen}
        className={`fixed inset-x-0 z-[56] rounded-t-card border-t border-line bg-cream-2 px-3 pb-3 pt-2 shadow-[var(--shadow-lift)] transition-[transform,opacity] duration-300 ease-settle lg:hidden ${
          moreOpen ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
        }`}
        style={{ bottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom))" }}
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
        <nav aria-label="More pages" className="space-y-0.5">
          {MORE_LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                tabIndex={moreOpen ? 0 : -1}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-panel px-3 py-3 text-[14px] font-medium transition-colors ${
                  active ? "bg-accent-soft text-accent" : "text-ink hover:bg-cream-3"
                }`}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-2 border-t border-line pt-2">
          {moreOpen && <ThemeToggle variant="row" />}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line pt-3">
          <a
            href="https://x.com/adexto_"
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={moreOpen ? 0 : -1}
            className="flex items-center justify-center gap-2 rounded-panel bg-cream-3 py-2.5 text-[12px] font-medium text-ink-soft hover:text-ink"
          >
            <Twitter className="h-4 w-4" /> @adexto_ <ArrowUpRight className="h-3 w-3" />
          </a>
          <a
            href="https://github.com/0xcuy/adexto"
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={moreOpen ? 0 : -1}
            className="flex items-center justify-center gap-2 rounded-panel bg-cream-3 py-2.5 text-[12px] font-medium text-ink-soft hover:text-ink"
          >
            <Github className="h-4 w-4" /> GitHub <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </div>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-[57] border-t border-line bg-cream-2/90 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid h-[var(--tabbar-h)] max-w-lg grid-cols-5">
          {TABS.map(({ href, label, icon: Icon, match, primary }) => {
            const active = isActive(match);
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
