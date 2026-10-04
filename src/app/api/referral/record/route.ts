import { NextResponse } from "next/server";
import { recordReferral } from "@/lib/referral";
import { clientIp, rateLimit, rateLimitHeaders, secretEquals } from "@/lib/rate-limit";
import { BodyTooLargeError, payloadTooLarge, readJsonBody } from "@/lib/body-limit";

/**
 * `POST /api/referral/record { txHash, chainId, ref, source }` — antarmuka bersama README rencana §4.
 *
 * - `source: "ui"`: dipanggil UI sesudah trade terkonfirmasi. Tanpa rahasia; yang membuktikan
 *   atribusinya adalah ekor calldata di tx itu sendiri (`src/lib/referral.ts`).
 * - `source: "x402" | "mcp"`: dipanggil gateway Plan 1, dengan header `x-referral-secret` yang sama
 *   dengan env `REFERRAL_RECORD_SECRET`.
 *
 * Jawaban 200 `{ ok, duplicate, record }`; penolakan membawa `code` yang stabil supaya pemanggil
 * bisa membedakan "belum terkonfirmasi" (404 `TX_NOT_FOUND`, coba lagi) dari "tidak dihitung".
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const verdict = rateLimit(`referral-record:${clientIp(req)}`, 60, 10 * 60 * 1000);
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
  const secret = process.env.REFERRAL_RECORD_SECRET ?? "";
  const given = req.headers.get("x-referral-secret") ?? "";
  const trusted = secret.length >= 16 && given.length > 0 && secretEquals(given, secret);
  try {
    const result = await recordReferral({ txHash: body?.txHash, chainId: body?.chainId, ref: body?.ref, source: body?.source, trusted });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json({ ok: true, duplicate: result.duplicate, record: result.record });
  } catch (error: any) {
    const message = String(error?.shortMessage ?? error?.message ?? error).slice(0, 200);
    return NextResponse.json({ ok: false, code: "CHAIN_READ_FAILED", error: message }, { status: 502 });
  }
}
