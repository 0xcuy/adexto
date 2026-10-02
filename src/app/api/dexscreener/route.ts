import { NextResponse } from "next/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { CHAIN_ORDER, DEX_KEY, SPEC_VERSION, adapterChain, maxBlocksPerRequest } from "./_lib/adapter";
import { CORS_HEADERS, preflight } from "./_lib/respond";
import { confirmationsFor } from "@/lib/market-index";
import { logSpanFor } from "@/lib/onchain-trades";

export const dynamic = "force-dynamic";

/**
 * Index of the ADEXTO DEX Screener adapter. Static: no RPC calls, so it is cheap to read and
 * cannot fail when a chain's RPC does.
 */
export async function GET(req: Request) {
  const verdict = rateLimit(`dexscreener:index:${clientIp(req)}`, 30, 60_000);
  const headers = { ...CORS_HEADERS, ...rateLimitHeaders(verdict), "cache-control": "no-store" };
  if (!verdict.ok) return NextResponse.json({ error: "Too many requests from this address. Slow down and retry." }, { status: 429, headers });

  const origin = "https://adexto.xyz";
  const chains = CHAIN_ORDER.map((slug) => {
    const cfg = adapterChain(slug)!;
    return {
      slug,
      chainId: cfg.chain.chainId,
      name: cfg.chain.name,
      root: `${origin}/api/dexscreener/${slug}`,
      confirmations: confirmationsFor(cfg.chain.chainId),
      recommendedChunkBlocks: logSpanFor(cfg.chain.chainId),
      maxBlocksPerRequest: maxBlocksPerRequest(cfg.chain.chainId),
      asset1: cfg.wrappedNative,
      factories: cfg.factories.map((f) => f.address),
    };
  });

  return NextResponse.json(
    {
      adapter: "ADEXTO DEX Screener adapter",
      spec: SPEC_VERSION,
      dexKey: DEX_KEY,
      endpoints: ["/latest-block", "/asset?id=", "/pair?id=", "/events?fromBlock=&toBlock="],
      chains,
      notes: [
        "Each market served here is one AdextoCurve: a bonding curve that trades the token against the chain's native coin. The curve is the market's permanent venue; it never graduates or migrates.",
        "Pair id = curve address. asset0 = the market token, asset1 = the native coin, reported under the chain's canonical wrapped-native address so it can be priced. The curve itself receives and pays native, not the wrapped token.",
        "priceNative is the curve's spot price right after the event (native per token), from the pricing reserves the event carries, virtual reserve included.",
        "reserves are real: the tokens the curve still has for sale, and the native it holds as reserve (accrued fees excluded). The virtual native reserve, which only sets the opening price, is excluded.",
        "Buys report the native paid including fees (asset1In); sells report the native received after fees (asset1Out). feeBps is the curve's totalFeeBps().",
        "A buyback-and-burn (AutoBuybackExecuted) is reported as a swap with maker = the curve and metadata.kind = buyback-burn.",
        "Blocks are served only after the listed confirmations, and /latest-block never runs ahead of the factory market list.",
      ],
    },
    { headers }
  );
}

export function OPTIONS() {
  return preflight();
}
