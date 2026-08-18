/**
 * Trade telemetry store.
 *
 * Two problems are fixed here:
 *   - `POST /api/agent/telemetry` had no authentication at all. Anyone could inject
 *     a fabricated trade (verified in the audit: `999,999,999 @ $9.99`) which then
 *     drove the Live Trade Feed and the price the chart displayed. Writes now
 *     require a bearer secret and fail closed when it is not configured.
 *   - The route wrote the whole array back, so a single injected record replaced
 *     the entire feed. Writes are append-only with a hard cap.
 */
import { readJson, writeJson } from "@/lib/server-store";
import { CHAINS, resolveChainOrDefault } from "@/lib/chains";

const STORE_FILE = "telemetry.json";
const MAX_TRADES = 1000;

export type TradeType = "BUY" | "SELL" | "AUTO_BUYBACK";

export interface TradeEvent {
  id: string;
  txHash: string;
  type: TradeType;
  symbol: string;
  /** Whole tokens moved. */
  amountToken: number;
  /** Native asset moved. */
  amountNative: number;
  nativeSymbol: string;
  /** Price of one token denominated in the native asset. */
  priceNative: number;
  trader: string;
  timestamp: string;
  blockNumber: number | null;
  chainId: number;
  teeAttestationRoot?: string | null;
  /** Where the record came from, so the UI never presents seeds as live fills. */
  source: "onchain" | "agent" | "genesis";
}

declare global {
  var __ADEXTO_TELEMETRY_CACHE__: TradeEvent[] | undefined;
}

function load(): TradeEvent[] {
  if (globalThis.__ADEXTO_TELEMETRY_CACHE__) return globalThis.__ADEXTO_TELEMETRY_CACHE__;
  const stored = readJson<TradeEvent[]>(STORE_FILE, []);
  const clean = Array.isArray(stored) ? stored.filter((t) => t && t.txHash && t.symbol) : [];
  globalThis.__ADEXTO_TELEMETRY_CACHE__ = clean;
  return clean;
}

function persist(trades: TradeEvent[]): boolean {
  globalThis.__ADEXTO_TELEMETRY_CACHE__ = trades;
  return writeJson(STORE_FILE, trades);
}

/**
 * Seed records for the curated 0G genesis flow. Flagged `source: "genesis"` so the
 * frontend can label them instead of passing them off as live market activity.
 */
export const GENESIS_TRADES: TradeEvent[] = [
  {
    id: "genesis_aegis_buyback",
    txHash: "0x917353cc0649ebe7b081bf6a7974923537914dd4cfa1ea4ac1eed9f9394b3fe3",
    type: "AUTO_BUYBACK",
    symbol: "AEGIS",
    amountToken: 54347.82,
    amountNative: 1,
    nativeSymbol: "0G",
    priceNative: 0.0184,
    trader: "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D",
    timestamp: "2026-08-17T00:00:00.000Z",
    blockNumber: 41896821,
    chainId: 16661,
    teeAttestationRoot: "0xafa3f6735b37bf0117bd792ce7cd4a63ffca59d7d8d601bd9a002749e5b6b1e8",
    source: "genesis",
  },
  {
    id: "genesis_aegis_da_anchor",
    txHash: "0xcfac6cd412f69cefeb2d509edf5dbdeef5dc0fb4613932223b99a4ce535b8c55",
    type: "BUY",
    symbol: "AEGIS",
    amountToken: 16304.34,
    amountNative: 0.3,
    nativeSymbol: "0G",
    priceNative: 0.0184,
    trader: "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D",
    timestamp: "2026-08-17T00:07:00.000Z",
    blockNumber: 41896840,
    chainId: 16661,
    source: "genesis",
  },
];

export function listTrades(symbol?: string | null): TradeEvent[] {
  const stored = load();
  const pool = stored.length > 0 ? stored : GENESIS_TRADES;
  const filtered =
    !symbol || symbol.toUpperCase() === "ALL"
      ? pool
      : pool.filter((t) => t.symbol.toUpperCase() === symbol.toUpperCase());

  return [...filtered].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export type TelemetryAuth = { ok: true } | { ok: false; status: number; message: string };

/** Fails closed: without ADEXTO_TELEMETRY_SECRET the endpoint accepts nothing. */
export function authorizeTelemetryWrite(request: Request): TelemetryAuth {
  const secret = process.env.ADEXTO_TELEMETRY_SECRET;
  if (!secret || secret.length < 16) {
    return {
      ok: false,
      status: 503,
      message:
        "Telemetry ingestion is disabled: ADEXTO_TELEMETRY_SECRET is not configured (minimum 16 characters).",
    };
  }

  const header = request.headers.get("authorization") || "";
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  if (!provided) {
    return { ok: false, status: 401, message: "Missing Authorization: Bearer <ADEXTO_TELEMETRY_SECRET>." };
  }
  if (!timingSafeEqual(provided, secret)) {
    return { ok: false, status: 403, message: "Invalid telemetry credential." };
  }
  return { ok: true };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type ValidationResult = { ok: true; trade: TradeEvent } | { ok: false; message: string };

export function validateTrade(input: any): ValidationResult {
  if (!input || typeof input !== "object") return { ok: false, message: "Body must be a JSON object." };

  const txHash = String(input.txHash || "");
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) return { ok: false, message: "txHash must be a 32-byte hex hash." };

  const symbol = String(input.symbol || "").toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) return { ok: false, message: "symbol must be 2-12 alphanumeric characters." };

  const type = String(input.type || "").toUpperCase();
  if (!["BUY", "SELL", "AUTO_BUYBACK"].includes(type)) {
    return { ok: false, message: "type must be BUY, SELL or AUTO_BUYBACK." };
  }

  const amountToken = Number(input.amountToken);
  const amountNative = Number(input.amountNative);
  if (!Number.isFinite(amountToken) || amountToken <= 0) return { ok: false, message: "amountToken must be > 0." };
  if (!Number.isFinite(amountNative) || amountNative <= 0) return { ok: false, message: "amountNative must be > 0." };

  const chainId = Number(input.chainId);
  const chain = resolveChainOrDefault(Number.isFinite(chainId) ? chainId : null);

  const timestamp = input.timestamp ? new Date(input.timestamp) : new Date();
  if (Number.isNaN(timestamp.getTime())) return { ok: false, message: "timestamp is not a valid date." };
  if (timestamp.getTime() > Date.now() + 60_000) return { ok: false, message: "timestamp is in the future." };

  return {
    ok: true,
    trade: {
      id: `agent_${txHash.slice(2, 14)}_${type.toLowerCase()}`,
      txHash,
      type: type as TradeType,
      symbol,
      amountToken,
      amountNative,
      nativeSymbol: chain.nativeSymbol,
      priceNative: amountToken > 0 ? amountNative / amountToken : 0,
      trader: /^0x[a-fA-F0-9]{40}$/.test(String(input.trader || "")) ? String(input.trader) : "unknown",
      timestamp: timestamp.toISOString(),
      blockNumber: Number.isFinite(Number(input.blockNumber)) ? Number(input.blockNumber) : null,
      chainId: chain.chainId,
      teeAttestationRoot: /^0x[a-fA-F0-9]{64}$/.test(String(input.teeAttestationRoot || ""))
        ? String(input.teeAttestationRoot)
        : null,
      source: "agent",
    },
  };
}

export interface AppendResult {
  stored: boolean;
  duplicate: boolean;
  total: number;
}

/** Append-only. Never replaces existing history. */
export function appendTrade(trade: TradeEvent): AppendResult {
  const existing = load();
  if (existing.some((t) => t.txHash === trade.txHash && t.type === trade.type)) {
    return { stored: false, duplicate: true, total: existing.length };
  }
  const next = [trade, ...existing].slice(0, MAX_TRADES);
  const stored = persist(next);
  return { stored, duplicate: false, total: next.length };
}

export function chainNativeSymbol(chainId: number): string {
  return resolveChainOrDefault(chainId).nativeSymbol ?? CHAINS["0G"].nativeSymbol;
}
