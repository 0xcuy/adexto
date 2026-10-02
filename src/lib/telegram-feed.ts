/**
 * Feed Telegram (P2.2), server saja. Dipanggil cron tiap menit lewat `/api/telegram/tick`.
 *
 * - Launch baru (pasar registry yang lahir sesudah feed pertama kali jalan) ke chat feed
 *   (`TELEGRAM_FEED_CHAT`, mis. `@adexto`).
 * - Setiap beli ke grup yang mengikuti pasar itu (`/alerts`), dan beli bernilai paling sedikit
 *   `TELEGRAM_FEED_MIN_USD` (bawaan $1) ke chat feed.
 *
 * Beli oleh wallet tim tidak pernah diposting: feed yang mengulang perdagangan kita sendiri akan
 * terbaca sebagai aktivitas luar. Wallet pembeli = penerima, jadi beli lewat relayer x402
 * diatribusikan ke pembelinya.
 *
 * Tidak ada riwayat lama yang diposting: kursor sebuah pasar dimulai di ujung riwayatnya saat pertama
 * terlihat, kecuali pasar yang lahir sesudah feed jalan, yang dimulai dari launch-nya.
 */
import { listProjects, type ProjectRecord } from "@/lib/registry";
import { ensureMarketIndex, indexable, swapsWithTimes } from "@/lib/market-index";
import { chainFromId, explorerTxUrl } from "@/lib/chains";
import { isOurAddress } from "@/lib/agent-identities";
import { nativePrices } from "@/lib/native-price";
import { STABLE_PRICES, assetPriceUsd, formatUsd, type AssetPrices } from "@/lib/pricing";
import { esc, sendMessage, TelegramError, type Button } from "@/lib/telegram";
import { dropGroup, loadFeed, saveFeed, subscribersOf } from "@/lib/telegram-store";
import { launchProofUrlFor } from "@/lib/launch-kit";
import { marketUrlFor } from "@/lib/launch-announcement";

const MAX_PER_CHAT_PER_TICK = 12;

declare global {
  var __ADEXTO_TG_TICK__: Promise<TickResult> | undefined;
}

export interface TickResult {
  markets: number;
  launches: number;
  buys: number;
  sent: number;
  errors: string[];
}

const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "https://adexto.xyz").replace(/\/+$/, "");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pos = (s: { blockNumber: number; logIndex: number }) => `${s.blockNumber}:${s.logIndex}`;
const after = (s: { blockNumber: number; logIndex: number }, cursor: string) => {
  const [b, i] = cursor.split(":").map(Number);
  return s.blockNumber > b || (s.blockNumber === b && s.logIndex > i);
};

function amount(v: number): string {
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return v.toPrecision(3);
}

export function runFeedTick(): Promise<TickResult> {
  if (globalThis.__ADEXTO_TG_TICK__) return globalThis.__ADEXTO_TG_TICK__;
  const run = tick().finally(() => {
    globalThis.__ADEXTO_TG_TICK__ = undefined;
  });
  globalThis.__ADEXTO_TG_TICK__ = run;
  return run;
}

async function tick(): Promise<TickResult> {
  const feedChat = (process.env.TELEGRAM_FEED_CHAT ?? "").trim() || null;
  const minUsd = Number(process.env.TELEGRAM_FEED_MIN_USD ?? "1") || 1;
  const feed = loadFeed();
  const result: TickResult = { markets: 0, launches: 0, buys: 0, sent: 0, errors: [] };
  let prices: AssetPrices = STABLE_PRICES;
  try {
    prices = { ...STABLE_PRICES, ...(await nativePrices()).prices };
  } catch {
    // kurs bawaan
  }

  // Antrean pesan per chat, dikirim di akhir dengan batas per tick.
  const outbox = new Map<string, Array<{ html: string; buttons: Button[][] }>>();
  const queue = (chat: string | number, html: string, buttons: Button[][]) => {
    const k = String(chat);
    const list = outbox.get(k) ?? [];
    list.push({ html, buttons });
    outbox.set(k, list);
  };

  const projects = listProjects().filter(indexable);
  result.markets = projects.length;
  for (const p of projects) {
    const key = `${p.chainId}:${p.tokenAddress.toLowerCase()}`;
    const chain = chainFromId(p.chainId);
    const fresh = p.deployedAt > feed.initializedAt;

    if (fresh && feedChat && !feed.announcedLaunches.includes(key)) {
      queue(feedChat, launchMessage(p, chain?.name ?? p.chainLabel), [
        [
          { text: `Trade $${p.symbol}`, url: marketUrlFor(origin(), p.slug, p.chainId) },
          { text: "Launch facts", url: launchProofUrlFor(origin(), p.slug, p.chainId) },
        ],
      ]);
      feed.announcedLaunches.push(key);
      result.launches += 1;
    }

    let swaps;
    try {
      const { index } = await ensureMarketIndex(p, { maxAgeMs: 20_000, waitMs: 6_000 });
      swaps = index ? swapsWithTimes(index) : [];
    } catch (e: any) {
      result.errors.push(`${p.symbol}/${p.chainId}: ${String(e?.message ?? e).slice(0, 80)}`);
      continue;
    }
    const cursor = feed.cursors[key];
    if (cursor === undefined) {
      // Pertama kali terlihat: pasar lama mulai dari ujung, pasar baru dari launch.
      feed.cursors[key] = fresh || swaps.length === 0 ? "0:0" : pos(swaps[swaps.length - 1]);
      if (!fresh) continue;
    }
    const from = feed.cursors[key];
    const pending = swaps.filter((s) => after(s, from));
    if (pending.length === 0) continue;
    feed.cursors[key] = pos(pending[pending.length - 1]);

    const nativeUsd = assetPriceUsd(chain?.nativeSymbol ?? "", prices);
    const groups = subscribersOf(p.chainId, p.tokenAddress);
    for (const s of pending) {
      if (!s.isBuy) continue;
      const wallet = (s.recipient || s.trader).toLowerCase();
      if (isOurAddress(wallet)) continue;
      result.buys += 1;
      const valueUsd = s.amountNative * nativeUsd;
      const html = [
        `🟢 <b>Buy $${esc(p.symbol)}</b> on ${esc((chain?.name ?? p.chainLabel).replace(/\s+Mainnet$/i, ""))}`,
        `${esc(amount(s.amountNative))} ${esc(chain?.nativeSymbol ?? "")}${nativeUsd > 0 ? ` (${esc(formatUsd(valueUsd))})` : ""} for ${esc(amount(s.amountToken))} $${esc(p.symbol)}`,
        `by <code>${esc(short(wallet))}</code>`,
      ].join("\n");
      const buttons: Button[][] = [
        [
          { text: `Trade $${p.symbol}`, url: marketUrlFor(origin(), p.slug, p.chainId) },
          { text: "Transaction", url: explorerTxUrl(p.chainId, s.txHash) },
        ],
      ];
      for (const g of groups) queue(g, html, buttons);
      if (feedChat && valueUsd >= minUsd) queue(feedChat, html, buttons);
    }
  }

  for (const [chat, messages] of outbox) {
    const send = messages.slice(0, MAX_PER_CHAT_PER_TICK);
    for (const m of send) {
      try {
        await sendMessage(chat, m.html, m.buttons);
        result.sent += 1;
      } catch (e) {
        const err = e as TelegramError;
        result.errors.push(`${chat}: ${err.message}`.slice(0, 120));
        // Bot dikeluarkan atau grup dihapus: langganannya tidak berguna lagi.
        if (err.code === 403 && /^-?\d+$/.test(chat)) dropGroup(Number(chat));
        if (err.code === 403 || err.code === 400) break;
        if (err.retryAfter) break;
      }
    }
    if (messages.length > send.length) {
      try {
        await sendMessage(chat, `…and ${messages.length - send.length} more in the last minute.`);
      } catch {
        // abaikan
      }
    }
  }
  saveFeed(feed);
  return result;
}

function launchMessage(p: ProjectRecord, chainName: string): string {
  return [
    `🚀 <b>New launch: $${esc(p.symbol)}</b>${p.name && p.name.toUpperCase() !== p.symbol ? ` · ${esc(p.name)}` : ""}`,
    `on ${esc(chainName.replace(/\s+Mainnet$/i, ""))} · token <code>${esc(short(p.tokenAddress))}</code>`,
    "100% of the supply is in the bonding curve; the creator starts with none.",
  ].join("\n");
}

