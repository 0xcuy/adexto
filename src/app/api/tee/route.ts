import { NextResponse } from "next/server";
import { agentAttestation, attestationSummary } from "@/lib/og-attestation";

/**
 * Status attestation TEE model agen, dibaca dari router 0G.
 *
 * Server-side karena `OG_ROUTER_API_KEY` tidak boleh sampai ke peramban. Sebagai
 * imbalannya, jawaban ini bisa diperiksa siapa pun tanpa kunci:
 *
 *   curl -s https://adexto.xyz/api/tee
 *
 * `live: false` berarti routernya tidak terjangkau, dan pemanggil harus
 * menampilkannya sebagai "tidak diketahui" — bukan sebagai aman. Itu pelajaran
 * dari `/api/prices` versi lama, yang membalas `success: true` walaupun setiap
 * feed gagal dan seluruh angkanya berasal dari nilai cadangan.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await agentAttestation();
  return NextResponse.json(
    {
      ...report,
      summary: attestationSummary(report),
      /** Dinyatakan di dalam jawaban, bukan hanya di halaman web. */
      scope:
        "This reports what the 0G router declares per model. ADEXTO does not fetch or verify a raw TDX quote: " +
        "the router exposes no attestation endpoint and completion responses carry no attestation material. " +
        "Independent quote verification requires the dstack verifier.",
    },
    {
      status: 200,
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    }
  );
}
