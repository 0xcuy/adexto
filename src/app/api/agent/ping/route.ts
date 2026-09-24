/**
 * Ping endpoint pool Agent Compute.
 *
 * APA YANG DIUKUR, DAN APA YANG TIDAK
 *
 * Satu permintaan ke `/api/health` router, diukur dari SERVER ini. Itu saja. Ia BUKAN:
 *
 *   - latensi dari peramban pengunjung — jaringan mereka tidak ikut terukur di sini
 *   - latensi inferensi — panggilan model berjalan beberapa detik, bukan puluhan milidetik
 *   - bukti kunci mana pun masih berlaku
 *
 * Perbedaan itu bukan rincian kecil. Indikator "42 ms" di sebelah nama model akan dibaca sebagai
 * kecepatan model kalau labelnya tidak menyebutkan yang diukur, dan angka kecil yang mengiklankan
 * hal yang salah lebih buruk daripada tidak ada angka. Halaman menyebutnya "origin → router".
 *
 * Inferensi TIDAK dipakai sebagai ping justru karena ia berbiaya: satu ping per 30 detik per tab
 * akan membelanjakan token pool untuk menggambar satu titik hijau.
 */
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ROUTER_URL = (process.env.AGENT_COMPUTE_ROUTER_URL || "https://compute.adexto.xyz").replace(
  /\/+$/,
  ""
);

/**
 * Hasil di-cache di proses selama 10 detik.
 *
 * Halaman menyegarkan tiap 30 detik per tab, jadi tanpa cache jumlah permintaan ke router tumbuh
 * sebanding dengan jumlah tab yang terbuka — endpoint ini akan menjadi cara memakai kami untuk
 * membebani layanan kami sendiri.
 */
type Shot = { ok: boolean; ms: number; status: number; at: number };
let last: Shot | null = null;
const TTL_MS = 10_000;

export async function GET(req: Request) {
  const gate = rateLimit(`agentping:${clientIp(req)}`, 30, 60_000);
  if (!gate.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  if (last && Date.now() - last.at < TTL_MS) {
    return NextResponse.json({ ok: last.ok, ms: last.ms, status: last.status, cached: true });
  }

  const started = Date.now();
  let ok = false;
  let status = 0;
  try {
    const res = await fetch(`${ROUTER_URL}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    status = res.status;
    ok = res.ok;
  } catch {
    ok = false;
  }
  const ms = Date.now() - started;
  last = { ok, ms, status, at: Date.now() };

  return NextResponse.json({ ok, ms, status, cached: false, measuredFrom: "origin" });
}
