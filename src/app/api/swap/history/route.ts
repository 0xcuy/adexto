import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { SwapRouteError, listTransfers } from "@/lib/lifi-server";

/**
 * GET /api/swap/history?address=0x…
 *
 * Cross-chain transfers this wallet sent through ADEXTO's routes, newest first, as LI.FI recorded
 * them for integrator "adexto". Lets the swap page show a transfer on any device, not only in the
 * browser that sent it. Public data about a public address; cached 15 s per address.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const verdict = rateLimit(`swap-history:${clientIp(req)}`, 60, 5 * 60 * 1000);
  if (!verdict.ok) {
    return NextResponse.json({ error: "Too many history reads. Wait a minute and try again." }, { status: 429, headers: rateLimitHeaders(verdict) });
  }
  const address = (new URL(req.url).searchParams.get("address") || "").trim();
  if (!ethers.isAddress(address)) return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400 });
  // Shared by everyone: each uncached read is one request from this server to LI.FI, whose public
  // limit is 100 per minute for all of its endpoints together. Status checks need the rest.
  const shared = rateLimit("swap-history:all", 250, 5 * 60 * 1000);
  if (!shared.ok) {
    return NextResponse.json({ error: "Transfer history is busy right now. Try again in a minute." }, { status: 503, headers: rateLimitHeaders(shared) });
  }
  try {
    const transfers = await listTransfers(address);
    return NextResponse.json({ transfers }, { headers: { "cache-control": "no-store", ...rateLimitHeaders(verdict) } });
  } catch (error: any) {
    if (error instanceof SwapRouteError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not read the transfer history." }, { status: 502 });
  }
}
