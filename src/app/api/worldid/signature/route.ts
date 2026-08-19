/**
 * POST /api/worldid/signature — terbitkan tanda tangan RP untuk World ID 4.0.
 *
 * Di 4.0, setiap permintaan proof harus ditandatangani backend dengan
 * `signing_key`. Tanda tangan itu membuktikan permintaan datang dari aplikasi
 * ini, sehingga orang lain tidak bisa memakai identitas app kita untuk memanen
 * verifikasi di situs mereka.
 *
 * Kunci privatnya TIDAK pernah dikirim ke klien. Yang keluar dari sini hanya
 * hasilnya: rp_id, nonce, jendela waktu, dan tanda tangan.
 */
import { NextResponse } from "next/server";
import { issueRpContext } from "@/lib/worldid";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = issueRpContext();
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ ok: true, rpContext: result.rpContext });
}
