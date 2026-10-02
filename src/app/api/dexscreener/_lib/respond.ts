/**
 * Pembungkus HTTP bersama untuk semua route adapter DEX Screener: batas laju, CORS, bentuk
 * galat `{ error }`, dan header cache. Semua teks yang keluar English.
 */
import { NextResponse } from "next/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { AdapterError, adapterChain, type AdapterChain } from "./adapter";

export type Endpoint = "latest-block" | "events" | "pair" | "asset" | "summary";

/**
 * Per IP, per chain, per endpoint, per menit. Indexer DEX Screener menanyai `/latest-block`
 * terus-menerus dan lajunya bisa diatur di sisi mereka, jadi batasnya longgar; pembacaan log
 * yang mahal tetap dibatasi antrean per chain di `adapter.ts`.
 */
const LIMITS: Record<Endpoint, number> = {
  "latest-block": 240,
  events: 240,
  pair: 120,
  asset: 120,
  summary: 30,
};

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function handle(
  req: Request,
  chainParam: string,
  endpoint: Endpoint,
  cacheControl: string,
  work: (cfg: AdapterChain, url: URL) => Promise<unknown>
): Promise<NextResponse> {
  const cfg = adapterChain(chainParam);
  const verdict = rateLimit(`dexscreener:${endpoint}:${cfg?.slug ?? "unknown"}:${clientIp(req)}`, LIMITS[endpoint], 60_000);
  const base = { ...CORS_HEADERS, ...rateLimitHeaders(verdict) };
  const fail = (status: number, error: string, retryAfter?: number) =>
    NextResponse.json(
      { error },
      { status, headers: { ...base, "cache-control": "no-store", ...(retryAfter ? { "retry-after": String(retryAfter) } : {}) } }
    );

  if (!verdict.ok) return fail(429, "Too many requests from this address. Slow down and retry.");
  if (!cfg) return fail(404, "Unsupported chain. Use base, arbitrum, monad or robinhood.");

  try {
    const body = await work(cfg, new URL(req.url));
    return NextResponse.json(body, { headers: { ...base, "cache-control": cacheControl } });
  } catch (error) {
    if (error instanceof AdapterError) return fail(error.status, error.message, error.retryAfter);
    console.error(`[dexscreener] ${endpoint} ${cfg.slug}:`, error);
    return fail(500, "Internal adapter error.");
  }
}
