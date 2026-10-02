/**
 * Pembungkus HTTP bersama untuk semua route adapter agregator (DEX Screener dan DEXTools):
 * batas laju, CORS, bentuk galat, dan header cache. Semua teks yang keluar English.
 */
import { NextResponse } from "next/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { AdapterError, adapterChain, type AdapterChain } from "./adapter";

export type Endpoint =
  | "latest-block"
  | "events"
  | "pair"
  | "asset"
  | "summary"
  | "block"
  | "holders"
  | "exchange";

/** Kontrak galat tiap agregator: DEX Screener `{ error }`, DEXTools `{ code, message }`. */
export type Api = "dexscreener" | "dextools";

/**
 * Per IP, per API, per chain, per endpoint, per menit. Indexer menanyai `/latest-block`
 * terus-menerus dan lajunya bisa diatur di sisi mereka, jadi batasnya longgar; pembacaan log
 * yang mahal tetap dibatasi antrean per chain di `adapter.ts`.
 */
const LIMITS: Record<Endpoint, number> = {
  "latest-block": 240,
  events: 240,
  pair: 120,
  asset: 120,
  summary: 30,
  block: 120,
  holders: 60,
  exchange: 60,
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

export function errorBody(api: Api, status: number, message: string): Record<string, string> {
  return api === "dextools" ? { code: String(status), message } : { error: message };
}

export async function handle(
  req: Request,
  chainParam: string,
  endpoint: Endpoint,
  cacheControl: string,
  work: (cfg: AdapterChain, url: URL) => Promise<unknown>,
  api: Api = "dexscreener"
): Promise<NextResponse> {
  const cfg = adapterChain(chainParam);
  const verdict = rateLimit(`${api}:${endpoint}:${cfg?.slug ?? "unknown"}:${clientIp(req)}`, LIMITS[endpoint], 60_000);
  const base = { ...CORS_HEADERS, ...rateLimitHeaders(verdict) };
  const fail = (status: number, message: string, retryAfter?: number) =>
    NextResponse.json(errorBody(api, status, message), {
      status,
      headers: { ...base, "cache-control": "no-store", ...(retryAfter ? { "retry-after": String(retryAfter) } : {}) },
    });

  if (!verdict.ok) return fail(429, "Too many requests from this address. Slow down and retry.");
  if (!cfg) return fail(404, "Unsupported chain. Use base, arbitrum, monad or robinhood.");

  try {
    const body = await work(cfg, new URL(req.url));
    return NextResponse.json(body, { headers: { ...base, "cache-control": cacheControl } });
  } catch (error) {
    if (error instanceof AdapterError) return fail(error.status, error.message, error.retryAfter);
    console.error(`[${api}] ${endpoint} ${cfg.slug}:`, error);
    return fail(500, "Internal adapter error.");
  }
}
