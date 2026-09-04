import { NextResponse } from "next/server";
import { findProject } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";
import { readOnChainSwaps, buildCandles } from "@/lib/onchain-trades";
import { appendTrade, authorizeTelemetryWrite, listTrades, validateTrade, type TradeEvent } from "@/lib/telemetry";

/**
 * GET  — trade history for a symbol. Prefers real `Swap` events read from the
 *        token's SovereignHook pool, falls back to the agent-reported store, and
 *        only then to the labelled genesis seeds. Also returns OHLC candles so the
 *        chart no longer has to synthesise a flat series.
 *
 * POST — append a trade reported by the autonomous agent. Requires
 *        `Authorization: Bearer $ADEXTO_TELEMETRY_SECRET`. Previously this endpoint
 *        was completely open and overwrote the whole feed on every call.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "AEGIS").toUpperCase();
    const bucketSeconds = Math.max(60, Number(searchParams.get("bucket") || 300));

    // Each chain's deployment has its own pool and therefore its own price
    // history, so the chart must be able to pin a chain.
    const chainIdParam = searchParams.get("chainId");
    const chainId = chainIdParam && Number.isFinite(Number(chainIdParam)) ? Number(chainIdParam) : null;

    const project = findProject(symbol, chainId);
    const chain = resolveChainOrDefault(project?.chainId ?? null);

    let trades: TradeEvent[] = [];
    let source: "onchain" | "agent" | "genesis" | "empty" = "empty";

    if (project?.poolAddress && project.poolLive) {
      trades = await readOnChainSwaps(chain, project.poolAddress, symbol);
      if (trades.length > 0) source = "onchain";
    }

    if (trades.length === 0) {
      const stored = listTrades(symbol);
      if (stored.length > 0) {
        trades = stored;
        source = stored[0].source === "genesis" ? "genesis" : "agent";
      }
    }

    const fallbackPrice = project?.priceNative ?? 0;
    /**
     * 240 buckets rather than 48, because indicators need bars to exist.
     * SMA(50) needs 50 of them and MACD needs 34, so a 48-bucket window left the
     * longer indicators unable to ever produce a value. Empty buckets before the
     * first trade are not emitted, so a wider window costs nothing on a young
     * market — it only extends how far back a busy one can be read.
     */
    const candles = buildCandles(trades, { bucketSeconds, buckets: 240, fallbackPrice });

    /**
     * Latest price is found by TIMESTAMP, not by taking `trades[0]`.
     *
     * Both trade sources happen to sort newest-first today, so indexing worked by
     * coincidence. That coincidence is exactly what broke the candles, and it would
     * break this readout the moment a source changed its ordering. It is also
     * `priceNativeAfter` — the curve's spot price after that trade — so this figure
     * matches the spot price the trade panel reads from the contract, instead of an
     * execution price that sits above it on a buy.
     */
    const newest = trades.reduce<TradeEvent | null>((best, t) => {
      if (!Number.isFinite(Date.parse(t.timestamp))) return best;
      if (!best) return t;
      const d = Date.parse(t.timestamp) - Date.parse(best.timestamp);
      return d > 0 || (d === 0 && (t.blockNumber ?? 0) > (best.blockNumber ?? 0)) ? t : best;
    }, null);

    const latestPrice = newest?.priceNativeAfter ?? newest?.priceNative ?? fallbackPrice;
    // Measured from the curve's opening price when we know it, so the percentage
    // answers "how far has this token moved since launch" rather than "since the
    // oldest trade still inside the lookback window".
    const openingPrice = fallbackPrice > 0 ? fallbackPrice : candles.length > 0 ? candles[0].open : latestPrice;
    const changePct = openingPrice > 0 ? ((latestPrice - openingPrice) / openingPrice) * 100 : 0;

    return NextResponse.json({
      success: true,
      symbol,
      source,
      agentActive: Boolean(project?.poolLive),
      agentModel: project?.agentModel ?? "0G Router (glm-5.2 + AMD SEV-SNP)",
      chainId: chain.chainId,
      nativeSymbol: chain.nativeSymbol,
      poolAddress: project?.poolAddress ?? null,
      poolLive: Boolean(project?.poolLive),
      totalTrades: trades.length,
      priceNative: latestPrice,
      changePct,
      volumeNative: trades.reduce((sum, t) => sum + (t.amountNative || 0), 0),
      candles,
      trades,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = authorizeTelemetryWrite(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const validation = validateTrade(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: 422 });
  }

  const result = appendTrade(validation.trade);
  if (result.duplicate) {
    return NextResponse.json({ success: true, duplicate: true, message: "Trade already recorded.", total: result.total });
  }
  if (!result.stored) {
    return NextResponse.json(
      { error: "Telemetry store is not writable. Mount a volume and set ADEXTO_DATA_DIR." },
      { status: 507 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Autonomous trade appended.",
    trade: validation.trade,
    total: result.total,
  });
}
