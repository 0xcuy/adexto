import { NextResponse } from "next/server";
import { getLaunchProof } from "@/lib/launch-proof";

/**
 * `GET /api/launch-proof?chainId=&token=` — bukti launch bersih satu pasar, dibaca dari chain.
 *
 * `token` boleh alamat atau slug. Bentuk jawabannya `LaunchProofResult` dari `src/lib/launch-proof.ts`;
 * pasar yang generasinya tidak tercakup menjawab 200 dengan `supported: false`, bukan galat, karena
 * "tidak ada klaim untuk pasar ini" adalah jawaban yang benar, bukan kegagalan.
 *
 * Hanya baca, tanpa kunci. Bukti yang `final` di-cache publik satu jam (isinya tidak bisa berubah);
 * selama jendela launch masih berjalan, lima belas detik.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainId = Number(url.searchParams.get("chainId"));
  const token = (url.searchParams.get("token") ?? "").trim();
  if (!Number.isInteger(chainId) || chainId <= 0 || !token || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return NextResponse.json({ error: "Pass chainId and token (address or slug)." }, { status: 400 });
  }
  try {
    const proof = await getLaunchProof(chainId, token);
    const maxAge = proof.supported ? (proof.final ? 3600 : 15) : 600;
    return NextResponse.json(proof, { headers: { "cache-control": `public, max-age=${maxAge}` } });
  } catch (error: any) {
    // Kegagalan RPC: tidak ada jawaban yang lebih baik daripada "coba lagi". Bukan `supported: false`,
    // yang akan terbaca sebagai "pasar ini tidak bersih".
    const message = String(error?.shortMessage ?? error?.message ?? error).slice(0, 200);
    return NextResponse.json({ error: `Chain read failed: ${message}` }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
