import { NextResponse } from "next/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { SwapRouteError, listBridges } from "@/lib/lifi-server";

/**
 * GET /api/swap/bridges
 *
 * The bridges LI.FI can use between ADEXTO's five chains, with the chain pairs each one serves.
 * Feeds the provider switches in the swap settings. Cached for an hour on the server.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const verdict = rateLimit(`swap-bridges:${clientIp(req)}`, 30, 5 * 60 * 1000);
  if (!verdict.ok) {
    return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429, headers: rateLimitHeaders(verdict) });
  }
  try {
    const bridges = await listBridges();
    return NextResponse.json({ bridges }, { headers: { "cache-control": "public, max-age=600", ...rateLimitHeaders(verdict) } });
  } catch (error: any) {
    if (error instanceof SwapRouteError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not list bridges." }, { status: 502 });
  }
}
