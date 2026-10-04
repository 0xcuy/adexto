import { NextResponse } from "next/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { SwapRouteError, readTransferStatus } from "@/lib/lifi-server";
import { isSwapChainId } from "@/config/swap-assets";

/**
 * GET /api/swap/status?txHash=0x…&fromChainId=8453&toChainId=4663&bridge=relaydepository
 *
 * Where a cross-chain transfer is, as LI.FI reports it: PENDING, DONE or FAILED, plus the
 * receiving transaction once it exists. The client polls this after sending.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const verdict = rateLimit(`swap-status:${clientIp(req)}`, 150, 5 * 60 * 1000);
  if (!verdict.ok) {
    return NextResponse.json({ error: "Too many status checks. Wait a minute and try again." }, { status: 429, headers: rateLimitHeaders(verdict) });
  }
  const shared = rateLimit("swap-status:all", 1500, 5 * 60 * 1000);
  if (!shared.ok) {
    return NextResponse.json({ error: "Status checks are busy right now. Try again in a minute." }, { status: 503, headers: rateLimitHeaders(shared) });
  }
  const { searchParams } = new URL(req.url);
  const txHash = searchParams.get("txHash") ?? "";
  const fromChainId = Number(searchParams.get("fromChainId"));
  const toChainId = Number(searchParams.get("toChainId"));
  const bridge = searchParams.get("bridge");
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return NextResponse.json({ error: "A transaction hash is required." }, { status: 400 });
  if (!isSwapChainId(fromChainId) || !isSwapChainId(toChainId)) {
    return NextResponse.json({ error: "Both chains must be one of ADEXTO's five chains." }, { status: 400 });
  }
  if (bridge !== null && !/^[A-Za-z0-9]{2,40}$/.test(bridge)) return NextResponse.json({ error: "Unknown bridge." }, { status: 400 });
  try {
    const status = await readTransferStatus({ txHash, fromChainId, toChainId, bridge });
    return NextResponse.json(status, { headers: { "cache-control": "no-store", ...rateLimitHeaders(verdict) } });
  } catch (error: any) {
    if (error instanceof SwapRouteError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not read the transfer status." }, { status: 502 });
  }
}
