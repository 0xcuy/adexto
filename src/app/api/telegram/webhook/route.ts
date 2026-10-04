import { NextResponse } from "next/server";
import { handleUpdate, type TgUpdate } from "@/lib/telegram-bot";
import { secretEquals } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/body-limit";
import { telegramConfigured } from "@/lib/telegram";

/**
 * Webhook bot Telegram. Telegram mengirim header `X-Telegram-Bot-Api-Secret-Token` dengan nilai yang
 * didaftarkan lewat `setWebhook(secret_token)`; tanpa nilai itu (env `TELEGRAM_WEBHOOK_SECRET`)
 * permintaan ditolak, jadi orang lain tidak bisa menyuruh bot memposting.
 *
 * Selalu menjawab 200 untuk update yang sah, juga bila perintahnya gagal: Telegram mengulang update
 * yang dijawab non-200, dan perintah yang gagal tidak akan berhasil dengan diulang.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!telegramConfigured() || secret.length < 16) return NextResponse.json({ error: "Bot not configured." }, { status: 503 });
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!given || !secretEquals(given, secret)) return NextResponse.json({ error: "Forbidden." }, { status: 401 });
  let update: TgUpdate;
  try {
    // Update Telegram berukuran beberapa KB; badan yang lebih besar dari batas dijawab sama
    // seperti badan rusak (200, diabaikan) supaya Telegram tidak mengirimnya ulang terus.
    update = await readJsonBody<TgUpdate>(req);
  } catch {
    return NextResponse.json({ ok: true });
  }
  try {
    await handleUpdate(update);
  } catch (e: any) {
    console.error("[telegram] update failed:", String(e?.message ?? e).slice(0, 200));
  }
  return NextResponse.json({ ok: true });
}
