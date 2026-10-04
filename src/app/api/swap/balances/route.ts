import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { readSwapBalances } from "@/lib/swap-balances";

/**
 * GET /api/swap/balances?address=0x…
 *
 * What an address holds on ADEXTO's five chains: native, allowlisted stablecoins, ADEXTO market
 * tokens in the wallet and in stake (valued with the curve's sell formula), and creator fees owed.
 * Public data about a public address. A chain that could not be read comes back with `error`
 * set instead of zeros, and `partial: true` marks the total as a lower bound.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const verdict = rateLimit(`swap-balances:${clientIp(req)}`, 30, 5 * 60 * 1000);
  if (!verdict.ok) {
    return NextResponse.json({ error: "Too many balance reads. Wait a minute and try again." }, { status: 429, headers: rateLimitHeaders(verdict) });
  }
  const address = (new URL(req.url).searchParams.get("address") || "").trim();
  if (!ethers.isAddress(address)) return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400 });
  // Shared by everyone: a fresh read is ten RPC calls across five chains, so a flood of random
  // addresses must not be able to spend our RPC quota. Cached reads (20 s per address) are free.
  const shared = rateLimit("swap-balances:all", 600, 5 * 60 * 1000);
  if (!shared.ok) {
    return NextResponse.json({ error: "Balance reads are busy right now. Try again in a minute." }, { status: 503, headers: rateLimitHeaders(shared) });
  }
  try {
    const report = await readSwapBalances(address);
    return NextResponse.json(report, { headers: { "cache-control": "no-store", ...rateLimitHeaders(verdict) } });
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message ?? error).slice(0, 200) }, { status: 502 });
  }
}
