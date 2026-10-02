/**
 * Status bot Telegram yang disimpan (P2.2), server saja: langganan alert per grup dan kursor feed.
 *
 * `telegram-subs.json`: grup → pasar yang alert belinya diposting ke grup itu.
 * `telegram-feed.json`: kursor per pasar (swap terakhir yang sudah diproses) dan launch yang sudah
 * diumumkan. Kursor dimulai di ujung riwayat saat pertama terlihat, jadi memasang bot tidak
 * membanjiri chat dengan riwayat lama.
 */
import { readJson, writeJson } from "@/lib/server-store";

const SUBS_FILE = "telegram-subs.json";
const FEED_FILE = "telegram-feed.json";

export interface GroupSub {
  chatId: number;
  title: string;
  markets: Array<{ chainId: number; token: string; symbol: string; addedBy: number; addedAt: number }>;
}

interface SubsFile {
  version: 1;
  groups: Record<string, GroupSub>;
}

/** Kursor: `${blockNumber}:${logIndex}` swap terakhir yang sudah diproses. */
export interface FeedFile {
  version: 1;
  initializedAt: number;
  cursors: Record<string, string>;
  announcedLaunches: string[];
}

/** Paling banyak pasar per grup: cukup untuk creator dengan beberapa chain, tidak cukup untuk dijadikan spam feed. */
export const MAX_MARKETS_PER_GROUP = 10;

export function loadSubs(): SubsFile {
  const f = readJson<SubsFile>(SUBS_FILE, { version: 1, groups: {} });
  return f && typeof f.groups === "object" ? f : { version: 1, groups: {} };
}

export function saveSubs(f: SubsFile): boolean {
  return writeJson(SUBS_FILE, f);
}

export type SubResult = { ok: true; already: boolean } | { ok: false; error: string };

export function addSub(chatId: number, title: string, m: { chainId: number; token: string; symbol: string }, by: number): SubResult {
  const f = loadSubs();
  const g = (f.groups[String(chatId)] ??= { chatId, title, markets: [] });
  g.title = title;
  const token = m.token.toLowerCase();
  if (g.markets.some((x) => x.chainId === m.chainId && x.token === token)) return { ok: true, already: true };
  if (g.markets.length >= MAX_MARKETS_PER_GROUP) return { ok: false, error: `This group already follows ${MAX_MARKETS_PER_GROUP} markets. Remove one with /alerts off.` };
  g.markets.push({ chainId: m.chainId, token, symbol: m.symbol, addedBy: by, addedAt: Math.floor(Date.now() / 1000) });
  return saveSubs(f) ? { ok: true, already: false } : { ok: false, error: "Could not save the subscription." };
}

export function removeSub(chatId: number, match: (m: { chainId: number; token: string; symbol: string }) => boolean): number {
  const f = loadSubs();
  const g = f.groups[String(chatId)];
  if (!g) return 0;
  const before = g.markets.length;
  g.markets = g.markets.filter((m) => !match(m));
  const removed = before - g.markets.length;
  if (g.markets.length === 0) delete f.groups[String(chatId)];
  if (removed) saveSubs(f);
  return removed;
}

/** Bot dikeluarkan dari grup: semua langganannya dibuang. */
export function dropGroup(chatId: number): void {
  const f = loadSubs();
  if (f.groups[String(chatId)]) {
    delete f.groups[String(chatId)];
    saveSubs(f);
  }
}

/** Grup yang mengikuti pasar ini. */
export function subscribersOf(chainId: number, token: string): number[] {
  const t = token.toLowerCase();
  return Object.values(loadSubs().groups)
    .filter((g) => g.markets.some((m) => m.chainId === chainId && m.token === t))
    .map((g) => g.chatId);
}

export function loadFeed(): FeedFile {
  const f = readJson<FeedFile | null>(FEED_FILE, null);
  if (f && typeof f.cursors === "object" && Array.isArray(f.announcedLaunches)) return f;
  return { version: 1, initializedAt: Math.floor(Date.now() / 1000), cursors: {}, announcedLaunches: [] };
}

export function saveFeed(f: FeedFile): boolean {
  return writeJson(FEED_FILE, f);
}
