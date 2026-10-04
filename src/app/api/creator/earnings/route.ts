import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { readCreatorEarnings } from "@/lib/creator-earnings";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * GET /api/creator/earnings?address=0x…
 *
 * Hanya-baca dan publik dengan sengaja: semua yang dijawabnya adalah data chain yang siapa
 * pun bisa baca sendiri (creator, creatorOwed, totalCreatorFeesPaid). Tidak ada kunci, tidak
 * ada tulisan, dan tidak ada yang dipercaya dari permintaan selain alamat yang divalidasi.
 *
 * Biayanya ke RPC: fakta immutable per kurva dibaca sekali per proses (lihat
 * `creator-earnings.ts`), jadi alamat acak hanya memicu bacaan dinamis untuk pasar yang memang
 * miliknya — nol untuk alamat yang bukan creator siapa pun.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Setiap panggilan membaca kurva milik creator itu dari RPC publik, tanpa autentikasi. Dasbor
  // creator memanggilnya sekali per kunjungan; 30 per menit per alamat menutup loop tanpa
  // menyentuh pemakaian itu.
  const gate = rateLimit(`creator-earnings:${clientIp(req)}`, 30, 60_000);
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(gate) });
  }

  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!ethers.isAddress(address)) {
    return NextResponse.json({ success: false, error: "A valid 0x address is required." }, { status: 400 });
  }
  try {
    const data = await readCreatorEarnings(address);
    // Angka uang yang bergerak tiap swap: tidak di-cache di mana pun.
    return NextResponse.json({ success: true, source: "chain", ...data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message.slice(0, 200) : "Could not read earnings." },
      { status: 502 }
    );
  }
}
