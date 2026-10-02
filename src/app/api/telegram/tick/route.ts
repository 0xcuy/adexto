import { NextResponse } from "next/server";
import { runFeedTick } from "@/lib/telegram-feed";
import { secretEquals } from "@/lib/rate-limit";
import { telegramConfigured } from "@/lib/telegram";

/**
 * `POST /api/telegram/tick` — satu putaran feed Telegram (`src/lib/telegram-feed.ts`). Dipanggil cron
 * VPS tiap menit dengan header `x-telegram-tick-secret` (env `TELEGRAM_TICK_SECRET`), pola yang sama
 * dengan sapuan Agent Compute. Gagal-tertutup: tanpa rahasia di server 503, rahasia salah 401.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_TICK_SECRET ?? "";
  if (!telegramConfigured() || secret.length < 16) return NextResponse.json({ error: "Feed not configured." }, { status: 503 });
  const given = req.headers.get("x-telegram-tick-secret") ?? "";
  if (!given || !secretEquals(given, secret)) return NextResponse.json({ error: "Forbidden." }, { status: 401 });
  try {
    return NextResponse.json(await runFeedTick());
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
