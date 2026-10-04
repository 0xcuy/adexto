import { NextResponse } from "next/server";
import { registerHandle } from "@/lib/referral";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { BodyTooLargeError, payloadTooLarge, readJsonBody } from "@/lib/body-limit";

/**
 * `POST /api/referral/handle { handle, address, issuedAt, signature }` — daftarkan handle referral.
 * Tanda tangannya atas `handleRegistrationMessage` (`src/lib/referral-tag.ts`) dari alamat itu sendiri.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const verdict = rateLimit(`referral-handle:${clientIp(req)}`, 10, 10 * 60 * 1000);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, code: "RATE_LIMITED", error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(verdict) });
  }
  let body: any;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return payloadTooLarge(e.limit);
    return NextResponse.json({ ok: false, code: "BAD_JSON", error: "Send a JSON body." }, { status: 400 });
  }
  const result = registerHandle({ handle: body?.handle, address: body?.address, issuedAt: body?.issuedAt, signature: body?.signature });
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
