import { NextResponse } from "next/server";
import { botUsername } from "@/lib/telegram";

/**
 * `GET /api/telegram/info` — username bot alert, untuk tombol "Add the alert bot" di launch kit.
 * Dibaca dari `getMe` di server, bukan dari `NEXT_PUBLIC_*`, supaya mengganti bot tidak menuntut
 * build ulang dan tidak ada build arg baru di Dockerfile. `username: null` = bot belum dipasang.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ username: await botUsername() }, { headers: { "cache-control": "public, max-age=300" } });
}
