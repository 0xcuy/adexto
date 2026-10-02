/**
 * Perintah bot Telegram ADEXTO (P2.2), server saja. Dipanggil dari `/api/telegram/webhook`.
 *
 *   /market <ticker> [chain]   harga, market cap, pembeli 24 jam, holder, fee creator, tautan
 *   /alerts                    di grup: daftar / `/alerts <ticker> [chain]` / `/alerts off [ticker]`
 *   /launch [TICKER] [name]    tautan Studio terisi otomatis (pengguna menandatangani sendiri)
 *   /earnings <address>        penghasilan creator sebuah alamat
 *   /start <chainId>_<token>   dari tombol "Add the alert bot" di launch kit: pasang alert di grup itu
 *
 * Mengubah alert di grup hanya untuk admin grup (`getChatMember`). Angka pasar berasal dari
 * `getLeaderboard()`, sumber yang sama dengan /leaderboard, jadi bot dan situs tidak berselisih.
 */
import { ethers } from "ethers";
import { esc, sendMessage, tg, botUsername, type Button } from "@/lib/telegram";
import { getLeaderboard, type LeaderboardMarket } from "@/lib/leaderboard";
import { addSub, dropGroup, loadSubs, removeSub } from "@/lib/telegram-store";
import { resolveChain } from "@/lib/chains";
import { formatUsd } from "@/lib/pricing";
import { readCreatorEarnings } from "@/lib/creator-earnings";
import { buildStudioPrefillUrl } from "@/lib/studio-prefill";
import { launchProofUrlFor } from "@/lib/launch-kit";
import { marketUrlFor } from "@/lib/launch-announcement";

interface TgUser {
  id: number;
  is_bot?: boolean;
  username?: string;
}
interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: { message_id: number; from?: TgUser; chat: TgChat; text?: string };
  my_chat_member?: { chat: TgChat; new_chat_member: { status: string } };
}

const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "https://adexto.xyz").replace(/\/+$/, "");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const chainShort = (n: string) => n.replace(/\s+Mainnet$/i, "");
const usd = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : v === 0 ? "$0" : formatUsd(v, { compact: v >= 1000 }));

function marketButtons(m: LeaderboardMarket): Button[][] {
  return [
    [
      { text: `Trade $${m.symbol}`, url: marketUrlFor(origin(), m.slug, m.chainId) },
      { text: "Launch facts", url: launchProofUrlFor(origin(), m.slug, m.chainId) },
    ],
  ];
}

export function marketCard(m: LeaderboardMarket): string {
  return [
    `<b>$${esc(m.symbol)}</b> · ${esc(m.name)} · ${esc(chainShort(m.chainName))}`,
    `Price: ${m.priceUsd !== null ? esc(formatUsd(m.priceUsd)) : "—"}`,
    `Buyers 24h: <b>${m.buyers24h}</b> · trades ${m.trades24h} · volume ${esc(usd(m.volume24hUsd))}`,
    `Holders: ${m.holders ?? "—"} · creator earned ${esc(usd(m.creatorEarnedUsd))}`,
    `<i>Buyers exclude ADEXTO team wallets and the creator.</i>`,
  ].join("\n");
}

async function findMarkets(ticker: string, chainArg?: string): Promise<LeaderboardMarket[]> {
  const sym = ticker.replace(/^\$/, "").toUpperCase();
  const all = (await getLeaderboard()).trending.filter((m) => m.symbol.toUpperCase() === sym);
  if (!chainArg) return all;
  const chain = resolveChain(chainArg);
  return chain ? all.filter((m) => m.chainId === chain.chainId) : [];
}

async function isGroupAdmin(chatId: number, userId: number | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const m = await tg<{ status: string }>("getChatMember", { chat_id: chatId, user_id: userId });
    return m.status === "creator" || m.status === "administrator";
  } catch {
    return false;
  }
}

const HELP = [
  "<b>ADEXTO bot</b>: markets on Base, Arbitrum, Monad, Robinhood Chain and 0G.",
  "",
  "/market &lt;ticker&gt; [chain]: price, buyers, holders, creator fees",
  "/alerts: post every buy of a market in this group (group admins)",
  "/launch [TICKER] [name]: open the Studio with your token filled in",
  "/earnings &lt;address&gt;: what a creator has earned",
].join("\n");

async function reply(chatId: number, html: string, buttons: Button[][] = []) {
  await sendMessage(chatId, html, buttons);
}

async function subscribe(chat: TgChat, from: TgUser | undefined, markets: LeaderboardMarket[]) {
  if (!(await isGroupAdmin(chat.id, from?.id))) {
    await reply(chat.id, "Only a group admin can change alerts here.");
    return;
  }
  const lines: string[] = [];
  for (const m of markets.slice(0, 5)) {
    const r = addSub(chat.id, chat.title ?? "", { chainId: m.chainId, token: m.token, symbol: m.symbol }, from?.id ?? 0);
    lines.push(
      r.ok
        ? `${r.already ? "Already on" : "On"}: every buy of <b>$${esc(m.symbol)}</b> on ${esc(chainShort(m.chainName))} will be posted here.`
        : esc(r.error)
    );
  }
  lines.push("", "<i>Buys by ADEXTO team wallets are left out. Stop with /alerts off.</i>");
  await reply(chat.id, lines.join("\n"));
}

export async function handleUpdate(u: TgUpdate): Promise<void> {
  if (u.my_chat_member) {
    const s = u.my_chat_member.new_chat_member.status;
    if (s === "left" || s === "kicked") dropGroup(u.my_chat_member.chat.id);
    return;
  }
  const msg = u.message;
  if (!msg?.text || !msg.text.startsWith("/")) return;
  const chat = msg.chat;
  const group = chat.type === "group" || chat.type === "supergroup";
  const [head, ...args] = msg.text.trim().split(/\s+/);
  const [cmdRaw, mention] = head.slice(1).split("@");
  const me = await botUsername();
  // Perintah untuk bot lain di grup yang sama bukan urusan kita.
  if (mention && me && mention.toLowerCase() !== me.toLowerCase()) return;
  const cmd = cmdRaw.toLowerCase();

  if (cmd === "start") {
    const param = args[0] ?? "";
    const deep = param.match(/^(\d{1,7})_(0x[0-9a-fA-F]{40})$/);
    if (deep && group) {
      const all = (await getLeaderboard()).trending;
      const m = all.find((x) => x.chainId === Number(deep[1]) && x.token.toLowerCase() === deep[2].toLowerCase());
      if (!m) return reply(chat.id, "That market is not listed on ADEXTO.");
      return subscribe(chat, msg.from, [m]);
    }
    if (deep) {
      const all = (await getLeaderboard()).trending;
      const m = all.find((x) => x.chainId === Number(deep[1]) && x.token.toLowerCase() === deep[2].toLowerCase());
      if (m) return reply(chat.id, marketCard(m), marketButtons(m));
    }
    return reply(chat.id, HELP, me ? [[{ text: "Add to a group", url: `https://t.me/${me}?startgroup=start` }]] : []);
  }

  if (cmd === "help") return reply(chat.id, HELP);

  if (cmd === "market" || cmd === "price") {
    if (!args[0]) return reply(chat.id, "Usage: /market &lt;ticker&gt; [chain], for example /market SAI monad");
    const found = await findMarkets(args[0], args[1]);
    if (found.length === 0) return reply(chat.id, `No ADEXTO market for ${esc(args[0].toUpperCase())}${args[1] ? ` on ${esc(args[1])}` : ""}.`);
    for (const m of found.slice(0, 5)) await reply(chat.id, marketCard(m), marketButtons(m));
    return;
  }

  if (cmd === "alerts") {
    if (!group) {
      return reply(
        chat.id,
        "Alerts post every buy of a market in your Telegram group. Add this bot to the group, then send /alerts &lt;ticker&gt; [chain] there as an admin.",
        me ? [[{ text: "Add to a group", url: `https://t.me/${me}?startgroup=start` }]] : []
      );
    }
    if (!args[0]) {
      const g = loadSubs().groups[String(chat.id)];
      if (!g || g.markets.length === 0) return reply(chat.id, "No alerts in this group yet. An admin can send /alerts &lt;ticker&gt; [chain].");
      return reply(
        chat.id,
        ["Alerts in this group:", ...g.markets.map((m) => `• $${esc(m.symbol)} on ${esc(chainShort(resolveChain(m.chainId)?.name ?? `chain ${m.chainId}`))}`)].join("\n")
      );
    }
    if (args[0].toLowerCase() === "off") {
      if (!(await isGroupAdmin(chat.id, msg.from?.id))) return reply(chat.id, "Only a group admin can change alerts here.");
      const sym = args[1]?.replace(/^\$/, "").toUpperCase();
      const n = removeSub(chat.id, (m) => !sym || m.symbol.toUpperCase() === sym);
      return reply(chat.id, n ? `Removed ${n} alert${n === 1 ? "" : "s"}.` : "Nothing to remove.");
    }
    const found = await findMarkets(args[0], args[1]);
    if (found.length === 0) return reply(chat.id, `No ADEXTO market for ${esc(args[0].toUpperCase())}${args[1] ? ` on ${esc(args[1])}` : ""}.`);
    return subscribe(chat, msg.from, found);
  }

  if (cmd === "launch") {
    const symbol = args[0] ?? null;
    const name = args.slice(1).join(" ") || null;
    const url = buildStudioPrefillUrl(origin(), { symbol, name });
    return reply(
      chat.id,
      "Launch a token on a bonding curve with no liquidity deposit and no creator allocation. You sign the launch yourself in the Studio; you pay gas only and earn a share of every swap.",
      [[{ text: "Open the Studio", url }]]
    );
  }

  if (cmd === "earnings") {
    const address = args[0];
    if (!address || !ethers.isAddress(address)) return reply(chat.id, "Usage: /earnings &lt;0x address&gt;");
    let e;
    try {
      e = await readCreatorEarnings(address);
    } catch {
      return reply(chat.id, "Could not read the chains right now. Try again in a minute.");
    }
    if (e.totals.markets === 0) return reply(chat.id, `${esc(short(address))} has not created an ADEXTO market.`);
    const rows = e.markets
      .filter((m) => m.lifetime !== null)
      .slice(0, 10)
      .map((m) => `• $${esc(m.symbol)} on ${esc(chainShort(m.chainName))}: ${m.lifetime!.toPrecision(3)} ${esc(m.nativeSymbol)}${m.owed ? ` (${m.owed.toPrecision(3)} unclaimed)` : ""}`);
    return reply(
      chat.id,
      [`<b>${esc(short(address))}</b>: ${esc(usd(e.totals.lifetimeUsd))} earned, ${esc(usd(e.totals.owedUsd))} unclaimed, ${e.totals.markets} market${e.totals.markets === 1 ? "" : "s"}`, ...rows].join("\n"),
      [[{ text: "Creator earnings", url: `${origin()}/creator?address=${address}` }]]
    );
  }

  // Di chat pribadi, perintah yang tidak dikenal mendapat bantuan; di grup didiamkan.
  if (!group) return reply(chat.id, HELP);
}
