/**
 * Sapuan penegakan jatah, untuk cron.
 *
 * Jalur baca `/api/agent/keys` juga menjalankan sapuan, tapi hanya kalau ada yang membuka
 * halaman. Itu tidak cukup sebagai penegakan: pemegang kunci yang membelanjakan jatahnya lewat
 * skrip tidak pernah membuka halaman apa pun. Endpoint ini memberi cron satu cara memanggil
 * sapuan yang sama tanpa sesi admin dan tanpa dompet.
 *
 * Dijaga satu rahasia bersama, BUKAN dibiarkan terbuka. Sapuan berbicara ke API admin router dan
 * membaca chain pada setiap kunci; dibiarkan terbuka ia menjadi cara gratis membuat server ini
 * bekerja keras dari luar.
 *
 * Cron yang dimaksud, dijalankan di kotak yang sama dengan aplikasinya:
 *   * * * * * curl -fsS -m 30 -X POST -H "x-sweep-secret: $SECRET" \
 *       http://127.0.0.1:3000/api/agent/keys/sweep >/dev/null
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { poolConfigured, sweep } from "@/lib/agent-compute-pool";

export const dynamic = "force-dynamic";

const SWEEP_SECRET = process.env.AGENT_COMPUTE_SWEEP_SECRET || "";

export async function POST(req: Request) {
  if (!SWEEP_SECRET) {
    return NextResponse.json(
      { error: "AGENT_COMPUTE_SWEEP_SECRET is not set, so the sweep endpoint is closed." },
      { status: 503 }
    );
  }
  const offered = req.headers.get("x-sweep-secret") || "";
  /**
   * Perbandingan waktu-tetap. Rahasia ini tidak berotasi sendiri, jadi kebocoran lewat waktu
   * respons adalah kebocoran permanen — murah untuk ditutup, mahal untuk diabaikan.
   */
  const a = Buffer.from(offered);
  const b = Buffer.from(SWEEP_SECRET);
  const match = a.length === b.length && timingSafeEqual(a, b);
  if (!match) return NextResponse.json({ error: "Not authorised." }, { status: 401 });

  if (!poolConfigured()) {
    return NextResponse.json({ error: "The agent compute pool is not configured." }, { status: 503 });
  }

  const result = await sweep(true);
  return NextResponse.json(result);
}
