import { NextResponse } from "next/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { confirmationsFor } from "@/lib/market-index";
import { logSpanFor } from "@/lib/onchain-trades";
import { CHAIN_ORDER, adapterChain, maxBlocksPerRequest } from "../dexscreener/_lib/adapter";
import { DEXTOOLS_SPEC, EXCHANGE_LOGO, EXCHANGE_NAME } from "../dexscreener/_lib/dextools";
import { CORS_HEADERS, errorBody, preflight } from "../dexscreener/_lib/respond";

export const dynamic = "force-dynamic";

/**
 * Index of the ADEXTO DEXTools adapter. Static: no RPC calls, so it is cheap to read and cannot
 * fail when a chain's RPC does.
 */
export async function GET(req: Request) {
  const verdict = rateLimit(`dextools:index:${clientIp(req)}`, 30, 60_000);
  const headers = { ...CORS_HEADERS, ...rateLimitHeaders(verdict), "cache-control": "no-store" };
  if (!verdict.ok) {
    return NextResponse.json(errorBody("dextools", 429, "Too many requests from this address. Slow down and retry."), {
      status: 429,
      headers,
    });
  }

  const origin = "https://adexto.xyz";
  const chains = CHAIN_ORDER.map((slug) => {
    const cfg = adapterChain(slug)!;
    return {
      slug,
      chainId: cfg.chain.chainId,
      name: cfg.chain.name,
      root: `${origin}/api/dextools/${slug}`,
      confirmations: confirmationsFor(cfg.chain.chainId),
      recommendedChunkBlocks: logSpanFor(cfg.chain.chainId),
      maxBlocksPerRequest: maxBlocksPerRequest(cfg.chain.chainId),
      asset1: cfg.wrappedNative,
      factories: cfg.factories.map((f) => f.address),
    };
  });

  return NextResponse.json(
    {
      adapter: "ADEXTO DEXTools adapter",
      spec: DEXTOOLS_SPEC,
      exchange: { name: EXCHANGE_NAME, logoURL: EXCHANGE_LOGO },
      endpoints: [
        "/latest-block",
        "/block?number=|timestamp=",
        "/asset?id=",
        "/asset/holders?id=&page=&pageSize=",
        "/exchange?id=",
        "/pair?id=",
        "/events?fromBlock=&toBlock=",
      ],
      chains,
      notes: [
        "DEX-level integration, one root per chain. Each market is one AdextoCurve: a bonding curve that trades the token against the chain's native coin. It never graduates or migrates.",
        "Pair id = curve address, asset0 = the market token, asset1 = the native coin under the chain's canonical wrapped-native address. The curve itself receives and pays native, not the wrapped token.",
        "Swap events carry no reserves on purpose. The curve prices against a virtual native reserve, so the ratio of its real reserves is not the price. Each swap carries priceNative instead: the spot price right after the event, in native per token.",
        "Buys report the native paid including fees (asset1In); sells report the native received after fees (asset1Out). feeBps is the curve's totalFeeBps().",
        "A creation event is emitted from the factory's TrinityProjectDeployed log, with maker = the creator. A buyback-and-burn (AutoBuybackExecuted) is reported as a swap with maker = the curve.",
        "holders and holdersCount come from a full Transfer index since mint; holder quantity is whole tokens, rounded down, because the schema types it as an integer.",
        "Blocks are served only after the listed confirmations, and /latest-block never runs ahead of the factory market list.",
      ],
    },
    { headers }
  );
}

export function OPTIONS() {
  return preflight();
}
