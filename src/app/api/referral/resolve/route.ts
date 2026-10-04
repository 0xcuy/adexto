import { NextResponse } from "next/server";
import { resolveRefCode } from "@/lib/referral";
import { isOurAddress } from "@/lib/agent-identities";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * `GET /api/referral/resolve?ref=` — alamat di balik sebuah kode referral, supaya UI bisa menempelkan
 * alamatnya ke calldata trade. Kode yang tidak dikenal atau milik tim menjawab `address: null`.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Setiap panggilan mem-parse ulang seluruh berkas referral dari disk, tanpa autentikasi.
  // 120 per menit per alamat jauh di atas satu kunjungan yang menyelesaikan satu kode.
  const gate = rateLimit(`referral-resolve:${clientIp(req)}`, 120, 60_000);
  if (!gate.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(gate) });

  const ref = new URL(req.url).searchParams.get("ref");
  const hit = resolveRefCode(ref);
  const address = hit && !isOurAddress(hit.address) ? hit.address : null;
  return NextResponse.json({ code: hit?.code ?? null, address }, { headers: { "cache-control": "public, max-age=60" } });
}
