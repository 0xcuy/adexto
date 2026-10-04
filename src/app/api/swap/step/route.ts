import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { SwapRouteError, prepareTransfer } from "@/lib/lifi-server";

/**
 * POST /api/swap/step
 *
 * Body: { routeId, address }
 *
 * The transaction for a route this server quoted in the last ten minutes, checked against that
 * quote before it is returned: same chain, sent from `address`, sent to the route's own spender
 * contract, and no more native value than the amount plus fees paid on top. The client signs it
 * in the user's wallet; nothing here can send anything.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const verdict = rateLimit(`swap-step:${clientIp(req)}`, 30, 5 * 60 * 1000);
  if (!verdict.ok) {
    return NextResponse.json({ error: "Too many transfer requests. Wait a minute and try again." }, { status: 429, headers: rateLimitHeaders(verdict) });
  }
  // Shared by everyone: each request is a call to LI.FI plus an RPC read, all from this one server.
  const shared = rateLimit("swap-step:all", 300, 5 * 60 * 1000);
  if (!shared.ok) {
    return NextResponse.json({ error: "Transfers are busy right now. Try again in a minute." }, { status: 503, headers: rateLimitHeaders(shared) });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
  }
  const routeId = typeof body?.routeId === "string" ? body.routeId : "";
  const address = typeof body?.address === "string" ? body.address : "";
  if (!/^[A-Za-z0-9-]{8,80}$/.test(routeId)) return NextResponse.json({ error: "A route id is required." }, { status: 400 });
  if (!ethers.isAddress(address)) return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400 });
  try {
    const prepared = await prepareTransfer(routeId, ethers.getAddress(address));
    return NextResponse.json(prepared, { headers: { "cache-control": "no-store", ...rateLimitHeaders(verdict) } });
  } catch (error: any) {
    if (error instanceof SwapRouteError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not prepare the transfer." }, { status: 502 });
  }
}
