/**
 * Satu-satunya daftar tujuan navigasi situs (UI-POLISH §6, Plan UI-1).
 *
 * Dibaca header (mega menu desktop + tombol Launch terbelah) dan tab bar bawah + lembar More.
 * Footer TIDAK membaca berkas ini: atas permintaan owner (4 Okt 14:30) footer kembali ke susunan lamanya
 * sendiri (Protocol & Apps / Architecture & Trust / Company / EVM chains).
 *
 * ATURAN
 * - Semua teks di sini (label DAN description) adalah teks publik: English, tanpa klaim yang belum
 *   benar (UI-POLISH §2.4, `audit_claims.mjs`). Deskripsi muncul di panel mega menu.
 * - `href` adalah URL yang sudah dikirim ke luar (UI-POLISH §2.1, `tools/check-frozen-links.mjs`).
 *   Mengganti label boleh; mengganti alamat tidak. "Agents masuk Launch" hanya pengelompokan:
 *   /agents tetap /agents.
 * - Tujuan baru dari UI-2 → `MINTA → UI-1` di LOG. Berkas ini milik UI-1.
 *
 * BENTUK
 *   NAV            lima grup: markets · launch · build · verify · company
 *   HEADER_MENUS   panel desktop di kiri: Markets, Build (Build memuat kolom Verify)
 *   LAUNCH_MENU    panel dari ▾ di tombol Launch; `featured` = dua kartu besar
 *   MOBILE_TABS    empat tab bawah (Markets · Swap · Launch · Compute); slot kelima = tombol More
 *   MORE_ITEMS     isi lembar More: hanya yang tidak ada di tab, footer, atau landing (keputusan owner 4 Okt)
 *   isNavActive()  pencocokan rute aktif yang dipakai header dan tab bar
 */
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownUp,
  BookOpen,
  Bot,
  BotMessageSquare,
  CloudLightning,
  Coins,
  Compass,
  Cpu,
  CreditCard,
  FileText,
  Gift,
  Info,
  Lock,
  Mail,
  Plug,
  Rocket,
  Scale,
  ShieldCheck,
  TriangleAlert,
  Trophy,
} from "lucide-react";

export type NavGroupKey = "markets" | "launch" | "build" | "verify" | "company";

export interface NavItem {
  /** Alamat yang sudah dikirim; boleh membawa #anchor (`/agents#launch`). */
  href: string;
  label: string;
  /** Satu baris, ≤ ±56 karakter, untuk kartu mega menu. Teks publik. */
  description: string;
  icon: LucideIcon;
  /** Awalan path yang membuat item ini aktif. Bawaan: path dari `href`. */
  match?: readonly string[];
}

export interface NavGroup {
  key: NavGroupKey;
  label: string;
  items: readonly NavItem[];
}

// ── Item ────────────────────────────────────────────────────────────────────────────────────────

const EXPLORE: NavItem = {
  href: "/explorer",
  label: "Explore markets",
  description: "Browse markets on all five chains",
  icon: Compass,
  match: ["/explorer", "/token"],
};
const SWAP: NavItem = { href: "/swap", label: "Swap", description: "Buy and sell on each market's own curve", icon: ArrowDownUp };
const LEADERBOARD: NavItem = {
  href: "/leaderboard",
  label: "Leaderboard",
  description: "Markets ranked by unique buyers, not volume",
  icon: Trophy,
};

const LAUNCH_TOKEN: NavItem = { href: "/studio", label: "Launch a token", description: "Gas only, with no liquidity deposit", icon: Rocket };
const LAUNCH_AGENT: NavItem = {
  href: "/agents#launch",
  label: "Launch with your agent",
  description: "Over MCP, your agent signs the launch with its own key",
  icon: BotMessageSquare,
  // Anchor ke seksi /agents: tidak pernah ditandai aktif, supaya "Agents" yang menandai halaman itu.
  match: [],
};
const AGENTS: NavItem = { href: "/agents", label: "Agents", description: "Launch with your agent, and agent markets", icon: Bot };
const CREATOR: NavItem = {
  href: "/creator",
  label: "Creator earnings",
  description: "What your markets have earned, and how to claim",
  icon: Coins,
};
const REWARDS: NavItem = {
  href: "/rewards",
  label: "Rewards",
  description: "Share a link and get credit for the trades it brings",
  icon: Gift,
};

const MCP: NavItem = { href: "/mcp", label: "MCP server", description: "Tools for agents to list, buy, launch and stake", icon: Plug };
const X402: NavItem = { href: "/x402", label: "x402 API", description: "Pay USDC on Base, receive the token on its chain", icon: CreditCard };
const COMPUTE: NavItem = {
  href: "/agent-compute",
  label: "Agent Compute",
  description: "Stake for an API key with a compute allowance on 0G",
  icon: Cpu,
};
const DOCS: NavItem = { href: "/docs", label: "Docs", description: "Guides, contract addresses and technical status", icon: BookOpen };
const DEMO: NavItem = {
  href: "/agent/demo",
  label: "Agent demo",
  description: "An endpoint that quotes its own price over x402",
  icon: CloudLightning,
};

const SECURITY: NavItem = {
  href: "/security",
  label: "Security",
  description: "Guarantees read from the contracts, with analyser output",
  icon: ShieldCheck,
};
const WHITEPAPER: NavItem = {
  href: "/whitepaper",
  label: "Whitepaper",
  description: "How the curve, the fees and the supply work",
  icon: FileText,
};

const ABOUT: NavItem = { href: "/about", label: "About", description: "What ADEXTO is and who builds it", icon: Info };
const CONTACT: NavItem = { href: "/contact", label: "Contact", description: "How to reach us", icon: Mail };
const PRIVACY: NavItem = { href: "/privacy", label: "Privacy", description: "What this site stores, and why", icon: Lock };
const TERMS: NavItem = { href: "/terms", label: "Terms", description: "Terms of use", icon: Scale };
const DISCLAIMER: NavItem = { href: "/disclaimer", label: "Disclaimer", description: "The risks of trading these tokens", icon: TriangleAlert };

// ── Grup ────────────────────────────────────────────────────────────────────────────────────────

export const NAV: Readonly<Record<NavGroupKey, NavGroup>> = {
  markets: { key: "markets", label: "Markets", items: [EXPLORE, SWAP, LEADERBOARD] },
  launch: { key: "launch", label: "Launch", items: [LAUNCH_TOKEN, LAUNCH_AGENT, AGENTS, CREATOR, REWARDS] },
  build: { key: "build", label: "Build", items: [MCP, X402, COMPUTE, DOCS, DEMO] },
  verify: { key: "verify", label: "Verify", items: [SECURITY, WHITEPAPER] },
  company: { key: "company", label: "Company", items: [ABOUT, CONTACT, PRIVACY, TERMS, DISCLAIMER] },
};

export interface NavMenu {
  key: "markets" | "build" | "launch";
  label: string;
  /** Kolom panel, kiri ke kanan. */
  columns: readonly NavGroup[];
  /** Item yang tampil sebagai kartu besar di atas kolom (hanya panel Launch). */
  featured?: readonly NavItem[];
}

/** Panel desktop di kiri header: `Markets ▾  Build ▾`. */
export const HEADER_MENUS: readonly NavMenu[] = [
  { key: "markets", label: "Markets", columns: [NAV.markets] },
  { key: "build", label: "Build", columns: [NAV.build, NAV.verify] },
];

/**
 * Panel dari ▾ di tombol Launch. Bagian kiri tombol tetap tautan langsung ke /studio (satu klik).
 * Dua kartu besar di atas, sisanya daftar biasa.
 */
export const LAUNCH_MENU: NavMenu = {
  key: "launch",
  label: "Launch",
  featured: [LAUNCH_TOKEN, LAUNCH_AGENT],
  columns: [{ key: "launch", label: "Launch", items: [AGENTS, CREATOR, REWARDS] }],
};

export interface MobileTab {
  href: string;
  label: string;
  icon: LucideIcon;
  match: readonly string[];
  /** Tab tengah berisi aksen (Launch). */
  primary?: boolean;
}

/** Empat tab bawah ponsel; slot kelima adalah tombol More (bukan tautan). */
export const MOBILE_TABS: readonly MobileTab[] = [
  { href: "/explorer", label: "Markets", icon: Compass, match: ["/explorer", "/token"] },
  { href: "/swap", label: "Swap", icon: ArrowDownUp, match: ["/swap"] },
  { href: "/studio", label: "Launch", icon: Rocket, match: ["/studio"], primary: true },
  { href: "/agent-compute", label: "Compute", icon: Cpu, match: ["/agent-compute"] },
];

/**
 * Lembar More di ponsel: HANYA tujuan yang tidak bisa dicapai dari tab bawah, footer, atau landing.
 *
 * Keputusan owner 4 Okt 14:30 ("yang ada di landing page dan footer link ga usah ada di More, udah kaya menu
 * restoran"). Versi berkelompok sebelumnya memuat 11 tujuan; semuanya kecuali tiga ini sudah ada di footer
 * setiap halaman (Docs, x402, MCP, Agent demo, Security, Whitepaper, Creator earnings) atau di tab bawah.
 */
export const MORE_ITEMS: readonly NavItem[] = [LEADERBOARD, AGENTS, REWARDS];

/**
 * True bila `pathname` berada di bawah tujuan ini. Item dengan `match: []` (anchor seksi) tidak
 * pernah aktif. Query dan hash di `href` diabaikan.
 */
export function isNavActive(pathname: string | null | undefined, item: Pick<NavItem, "href" | "match">): boolean {
  if (!pathname) return false;
  const prefixes = item.match ?? [item.href.split(/[?#]/)[0]];
  return prefixes.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
