import { NextResponse } from "next/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import type { IpHeaders } from "@/lib/agent-launch";

/**
 * Bagian bersama rute REST peluncuran agen (`/api/agents/launch/*`): batas laju per IP dan header IP
 * yang diteruskan ke tahap Studio, sama dengan yang diteruskan server MCP (`[transport]/route.ts`).
 * Rute REST ini pembungkus tipis `prepareLaunch`/`registerLaunch`; aturan dan batasnya sama dengan MCP.
 */
const IP_HEADERS = ["x-peer-ip", "x-real-ip", "cf-connecting-ip", "x-forwarded-for"] as const;

export function ipHeadersOf(req: Request): IpHeaders {
  const out: IpHeaders = {};
  for (const name of IP_HEADERS) {
    const value = req.headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

/** Null bila boleh lanjut, atau jawaban 429. */
export function limitLaunchRoute(req: Request, name: string, limit: number, windowMs: number): Response | null {
  const gate = rateLimit(`agents-launch-${name}:${clientIp(req)}`, limit, windowMs);
  if (gate.ok) return null;
  return NextResponse.json(
    { error: "rate_limited", detail: `At most ${limit} calls per ${Math.round(windowMs / 60_000)} minutes from one address.`, retryAfterSeconds: gate.retryAfter },
    { status: 429, headers: rateLimitHeaders(gate) }
  );
}

/** Jawaban alat apa adanya: 200 untuk hasil, 400 untuk `error` yang ditolak alat. */
export function toolResponse(result: Record<string, unknown>): Response {
  return NextResponse.json(result, { status: result.error ? 400 : 200, headers: { "cache-control": "no-store" } });
}
