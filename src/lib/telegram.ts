/**
 * Klien Bot API Telegram yang tipis (P2.2), server saja. Token dari `TELEGRAM_BOT_TOKEN`.
 *
 * Hanya pesan HTML dan tombol URL biasa. Mini App (`web_app`) untuk kripto wajib TON menurut aturan
 * Telegram, jadi sengaja tidak dipakai di mana pun.
 */

const API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return /^\d+:[A-Za-z0-9_-]{30,}$/.test(process.env.TELEGRAM_BOT_TOKEN ?? "");
}

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly retryAfter: number | null
  ) {
    super(message);
  }
}

export async function tg<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramError("TELEGRAM_BOT_TOKEN is not set", null, null);
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } } | null;
  if (!body?.ok) {
    // Pesan galat Telegram tidak pernah memuat token, jadi aman diteruskan ke log.
    throw new TelegramError(body?.description ?? `HTTP ${res.status}`, body?.error_code ?? res.status, body?.parameters?.retry_after ?? null);
  }
  return body.result as T;
}

/** Escape untuk `parse_mode: "HTML"`: hanya tiga karakter ini yang bermakna. */
export function esc(s: string | number): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type Button = { text: string; url: string };

export async function sendMessage(chatId: number | string, html: string, buttons: Button[][] = []): Promise<void> {
  await tg("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

declare global {
  var __ADEXTO_TG_ME__: { at: number; username: string } | undefined;
}

/** Username bot (tanpa @), dari `getMe`, di-cache satu jam. Null bila bot belum dikonfigurasi. */
export async function botUsername(): Promise<string | null> {
  if (!telegramConfigured()) return null;
  const hit = globalThis.__ADEXTO_TG_ME__;
  if (hit && Date.now() - hit.at < 3_600_000) return hit.username;
  try {
    const me = await tg<{ username: string }>("getMe");
    globalThis.__ADEXTO_TG_ME__ = { at: Date.now(), username: me.username };
    return me.username;
  } catch {
    return hit?.username ?? null;
  }
}
