import { NextResponse } from "next/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { SwapRouteError, findRoutes, parseRouteRequest } from "@/lib/lifi-server";

/**
 * POST /api/swap/routes
 *
 * Body: { fromChainId, toChainId, fromToken, toToken, amount (base units), address?, order?,
 *         slippage?, denyBridges? }
 *
 * Up to three single-step routes from LI.FI between two of ADEXTO's five chains, for allowlisted
 * assets only (src/config/swap-assets.ts). Without `address` the routes are priced for a
 * placeholder and marked `quoteOnly`: they can be shown, not executed.
 *
 * Two limits: per client, and one shared by everyone, because every request here becomes a
 * request from this server to LI.FI and they all share the server's quota.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const verdict = rateLimit(`swap-routes:${clientIp(req)}`, 40, 5 * 60 * 1000);
  if (!verdict.ok) {
    return NextResponse.json({ error: "Too many route requests. Wait a minute and try again." }, { status: 429, headers: rateLimitHeaders(verdict) });
  }
  const shared = rateLimit("swap-routes:all", 600, 5 * 60 * 1000);
  if (!shared.ok) {
    return NextResponse.json({ error: "Route lookups are busy right now. Try again in a minute." }, { status: 503, headers: rateLimitHeaders(shared) });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
  }
  try {
    const request = parseRouteRequest(body);
    const result = await findRoutes(request);
    return NextResponse.json(result, { headers: { "cache-control": "no-store", ...rateLimitHeaders(verdict) } });
  } catch (error: any) {
    if (error instanceof SwapRouteError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not look up routes." }, { status: 502 });
  }
}
