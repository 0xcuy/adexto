import { NextResponse } from "next/server";
import { resolveRefCode } from "@/lib/referral";
import { isOurAddress } from "@/lib/agent-identities";

/**
 * `GET /api/referral/resolve?ref=` — alamat di balik sebuah kode referral, supaya UI bisa menempelkan
 * alamatnya ke calldata trade. Kode yang tidak dikenal atau milik tim menjawab `address: null`.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get("ref");
  const hit = resolveRefCode(ref);
  const address = hit && !isOurAddress(hit.address) ? hit.address : null;
  return NextResponse.json({ code: hit?.code ?? null, address }, { headers: { "cache-control": "public, max-age=60" } });
}
