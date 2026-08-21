/**
 * Subgraph read path — the SECOND one.
 *
 * ORDERING IS THE WHOLE DESIGN, AND IT IS NOT NEGOTIABLE
 *
 * The registry answers first and alone decides which markets exist. This module
 * only attaches live curve state to markets the registry already returned. It can
 * never add, remove, rename or retarget a market.
 *
 * Inverting that would break the explorer in a way that looks like a data
 * problem rather than an architecture problem: an indexer is always behind the
 * chain, and it can be minutes behind or failed outright. A launch that just
 * succeeded on-chain is in the registry immediately and in the subgraph later, so
 * a subgraph-first explorer shows "your token does not exist" to the person who
 * just paid to create it. There is no retry that fixes that, only a wait.
 *
 * Consequences of that ordering, enforced here:
 *   - every function returns data or empty, and none of them throw;
 *   - each chain is fetched independently, so one dead endpoint costs one chain's
 *     enrichment and nothing else;
 *   - a hard timeout per chain, because the response is already complete without
 *     us and a slow indexer must only cost latency;
 *   - `Promise.allSettled`, never `Promise.all`.
 */
import {
  SUBGRAPH_CACHE_MS,
  SUBGRAPH_ENDPOINTS,
  SUBGRAPH_ENV_NAMES,
  SUBGRAPH_TIMEOUT_MS,
} from "@/config/subgraph";
import { CHAINS, type ChainKey } from "@/lib/chains";

/** Live curve state, entirely derived from indexed events. */
export interface CurveStats {
  curveAddress: string;
  /** virtualNative + real native. Includes the reserve that was never real money. */
  reserveNative: string;
  reserveToken: string;
  tokensSold: string;
  /** reserveNative / reserveToken. Decimal string; may be far below 1e-9. */
  spotPriceNative: number;
  /** (virtualNative + totalDepthFees) / curveTokens. Rises monotonically. */
  floorPriceNative: number;
  volumeNative: string;
  swapCount: number;
  buyCount: number;
  sellCount: number;
  tokensBurned: string;
  totalDepthFees: string;
  totalCreatorFees: string;
  totalTreasuryFees: string;
  totalCreatorFeesClaimed: string;
  initialized: boolean;
  lastSwapTimestamp: number | null;
}

/** Per-chain reachability, reported so a stale explorer is diagnosable. */
export interface SubgraphChainHealth {
  chainKey: ChainKey;
  chainId: number;
  configured: boolean;
  /** Name of the env var that would configure this chain, for the "not set" case. */
  envVar: string;
  reachable: boolean;
  /** Latest block the indexer has processed. Null when unreachable. */
  indexedBlock: number | null;
  hasIndexingErrors: boolean | null;
  curvesReturned: number;
  latencyMs: number | null;
  error: string | null;
}

export interface SubgraphResult {
  /** Keyed by lowercase curve address. */
  stats: Map<string, CurveStats>;
  health: SubgraphChainHealth[];
  /** True when every configured chain answered. */
  complete: boolean;
  fromCache: boolean;
}

const QUERY = `query CurveStats($ids: [ID!]!) {
  curves(where: { id_in: $ids }, first: 1000) {
    id
    reserveNative
    reserveToken
    tokensSold
    spotPriceNative
    floorPriceNative
    volumeNative
    swapCount
    buyCount
    sellCount
    tokensBurned
    totalDepthFees
    totalCreatorFees
    totalTreasuryFees
    totalCreatorFeesClaimed
    initialized
    lastSwapTimestamp
  }
  _meta { block { number } hasIndexingErrors }
}`;

interface RawCurve {
  id: string;
  reserveNative: string;
  reserveToken: string;
  tokensSold: string;
  spotPriceNative: string;
  floorPriceNative: string;
  volumeNative: string;
  swapCount: string;
  buyCount: string;
  sellCount: string;
  tokensBurned: string;
  totalDepthFees: string;
  totalCreatorFees: string;
  totalTreasuryFees: string;
  totalCreatorFeesClaimed: string;
  initialized: boolean;
  lastSwapTimestamp: string | null;
}

/**
 * Prices are BigDecimal strings and routinely land around 1e-9, so they are
 * parsed as floats rather than integers. Parsing them as BigInt would floor an
 * opening price of 0.0000000012 to 0 and produce a chart that is flat with no
 * error anywhere -- the failure mode this avoids.
 */
function decimal(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function count(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toStats(raw: RawCurve): CurveStats {
  return {
    curveAddress: raw.id.toLowerCase(),
    reserveNative: raw.reserveNative ?? "0",
    reserveToken: raw.reserveToken ?? "0",
    tokensSold: raw.tokensSold ?? "0",
    spotPriceNative: decimal(raw.spotPriceNative),
    floorPriceNative: decimal(raw.floorPriceNative),
    volumeNative: raw.volumeNative ?? "0",
    swapCount: count(raw.swapCount),
    buyCount: count(raw.buyCount),
    sellCount: count(raw.sellCount),
    tokensBurned: raw.tokensBurned ?? "0",
    totalDepthFees: raw.totalDepthFees ?? "0",
    totalCreatorFees: raw.totalCreatorFees ?? "0",
    totalTreasuryFees: raw.totalTreasuryFees ?? "0",
    totalCreatorFeesClaimed: raw.totalCreatorFeesClaimed ?? "0",
    initialized: Boolean(raw.initialized),
    lastSwapTimestamp: raw.lastSwapTimestamp ? count(raw.lastSwapTimestamp) : null,
  };
}

/** One chain. Resolves to a health record plus whatever curves came back. */
async function queryChain(
  chainKey: ChainKey,
  endpoint: string,
  ids: string[],
): Promise<{ health: SubgraphChainHealth; curves: CurveStats[] }> {
  const chain = CHAINS[chainKey];
  const base: SubgraphChainHealth = {
    chainKey,
    chainId: chain.chainId,
    configured: true,
    envVar: SUBGRAPH_ENV_NAMES[chainKey],
    reachable: false,
    indexedBlock: null,
    hasIndexingErrors: null,
    curvesReturned: 0,
    latencyMs: null,
    error: null,
  };

  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { ids } }),
      // Hard budget. AbortSignal.timeout rejects rather than hanging, which is
      // what we want: the caller already has a complete answer.
      signal: AbortSignal.timeout(SUBGRAPH_TIMEOUT_MS),
      cache: "no-store",
    });

    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { health: { ...base, latencyMs, error: `HTTP ${response.status}` }, curves: [] };
    }

    const body = (await response.json()) as {
      data?: { curves?: RawCurve[]; _meta?: { block?: { number?: number }; hasIndexingErrors?: boolean } };
      errors?: Array<{ message?: string }>;
    };

    // A GraphQL 200 with an `errors` array is the normal shape for an auth
    // failure or an unsynced deployment, so it must be treated as a failure even
    // though the transport succeeded.
    if (body.errors?.length) {
      return {
        health: {
          ...base,
          latencyMs,
          error: body.errors.map((e) => e.message ?? "unknown").join("; ").slice(0, 200),
        },
        curves: [],
      };
    }

    const curves = (body.data?.curves ?? []).map(toStats);
    return {
      health: {
        ...base,
        reachable: true,
        indexedBlock: body.data?._meta?.block?.number ?? null,
        hasIndexingErrors: body.data?._meta?.hasIndexingErrors ?? null,
        curvesReturned: curves.length,
        latencyMs,
      },
      curves,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      health: {
        ...base,
        latencyMs: Date.now() - started,
        error: message.includes("timeout") || message.includes("abort")
          ? `timeout after ${SUBGRAPH_TIMEOUT_MS}ms`
          : message.slice(0, 200),
      },
      curves: [],
    };
  }
}

/**
 * Cache entry for ONE chain.
 *
 * WHY THE CACHE IS PER CHAIN AND WHY FAILURES ARE NEVER STORED
 *
 * The first version kept a single entry covering every chain in one request, and
 * it stored the result whether or not the fetch had succeeded. Both were wrong,
 * and the harness caught it:
 *
 *   - Storing failures turns a momentary blip into a full cache window of
 *     downtime. The indexer recovers, the next request still serves "no live
 *     data" because the failure is cached, and nothing in the response explains
 *     why. Only successes are stored now, so recovery takes effect immediately.
 *
 *   - One entry for all chains means a single failing chain invalidates the
 *     healthy ones, and a change in the set of markets on one chain throws away
 *     every other chain's data. Each chain is now cached under its own key.
 */
interface ChainCacheEntry {
  at: number;
  /** The exact question this answer belongs to: sorted, joined curve ids. */
  ids: string;
  curves: CurveStats[];
  health: SubgraphChainHealth;
}

declare global {
  var __ADEXTO_SUBGRAPH_CACHE__: Map<ChainKey, ChainCacheEntry> | undefined;
}

/**
 * Fetch live curve state for a set of (chain, curve address) pairs.
 *
 * Never throws and never rejects. Callers merge whatever comes back.
 */
export async function fetchCurveStats(
  targets: Array<{ chainKey: ChainKey; curveAddress: string }>,
): Promise<SubgraphResult> {
  // Group first: one request per chain, not one per market. A page with 40
  // markets on one chain must not become 40 requests to the same indexer.
  const byChain = new Map<ChainKey, Set<string>>();
  for (const { chainKey, curveAddress } of targets) {
    if (!curveAddress) continue;
    const set = byChain.get(chainKey) ?? new Set<string>();
    set.add(curveAddress.toLowerCase());
    byChain.set(chainKey, set);
  }

  const health: SubgraphChainHealth[] = [];
  const stats = new Map<string, CurveStats>();

  // Chains with an endpoint but nothing to ask about, and chains with no endpoint
  // at all, are both reported rather than omitted. "Not configured" and
  // "configured but broken" are different problems and the response says which.
  const askable: Array<[ChainKey, string, string[]]> = [];
  for (const chainKey of Object.keys(SUBGRAPH_ENDPOINTS) as ChainKey[]) {
    const endpoint = SUBGRAPH_ENDPOINTS[chainKey];
    const ids = [...(byChain.get(chainKey) ?? [])];
    if (!endpoint) {
      if (ids.length > 0) {
        health.push({
          chainKey,
          chainId: CHAINS[chainKey].chainId,
          configured: false,
          envVar: SUBGRAPH_ENV_NAMES[chainKey],
          reachable: false,
          indexedBlock: null,
          hasIndexingErrors: null,
          curvesReturned: 0,
          latencyMs: null,
          error: `${SUBGRAPH_ENV_NAMES[chainKey]} not set`,
        });
      }
      continue;
    }
    if (ids.length === 0) continue;
    askable.push([chainKey, endpoint, ids]);
  }

  if (askable.length === 0) {
    return { stats, health, complete: health.length === 0, fromCache: false };
  }

  // Shape check, not just a nullish check. `??=` alone would keep whatever is
  // already on globalThis, and a cache held on globalThis outlives the module
  // that created it -- across a dev hot reload, and across any deploy that
  // changes this entry's shape while the process keeps running. When the shape
  // changed from a single object to a Map, the leftover object survived and every
  // request failed with `cache.get is not a function`. Validating the shape makes
  // a stale cache a discarded cache instead of a 500.
  let cache = globalThis.__ADEXTO_SUBGRAPH_CACHE__;
  if (!(cache instanceof Map)) {
    cache = new Map<ChainKey, ChainCacheEntry>();
    globalThis.__ADEXTO_SUBGRAPH_CACHE__ = cache;
  }
  const now = Date.now();
  let servedFromCache = 0;
  const toFetch: Array<[ChainKey, string, string[]]> = [];

  for (const entry of askable) {
    const [chainKey, , ids] = entry;
    const idKey = [...ids].sort().join(",");
    const hit = cache.get(chainKey);
    // Only a successful, same-question, in-window entry may be reused.
    if (hit && hit.ids === idKey && hit.health.reachable && now - hit.at < SUBGRAPH_CACHE_MS) {
      for (const curve of hit.curves) stats.set(curve.curveAddress, curve);
      health.push(hit.health);
      servedFromCache += 1;
      continue;
    }
    toFetch.push(entry);
  }

  if (toFetch.length > 0) {
    // allSettled, not all: one rejected chain must not discard the others. Every
    // queryChain already resolves rather than rejects, so this is belt and braces
    // against a future change in there.
    const settled = await Promise.allSettled(
      toFetch.map(([chainKey, endpoint, ids]) => queryChain(chainKey, endpoint, ids)),
    );

    settled.forEach((outcome, index) => {
      const [chainKey, , ids] = toFetch[index];
      if (outcome.status === "rejected") {
        health.push({
          chainKey,
          chainId: CHAINS[chainKey].chainId,
          configured: true,
          envVar: SUBGRAPH_ENV_NAMES[chainKey],
          reachable: false,
          indexedBlock: null,
          hasIndexingErrors: null,
          curvesReturned: 0,
          latencyMs: null,
          error: String(outcome.reason).slice(0, 200),
        });
        return;
      }

      health.push(outcome.value.health);
      for (const curve of outcome.value.curves) {
        stats.set(curve.curveAddress, curve);
      }

      if (outcome.value.health.reachable) {
        cache.set(chainKey, {
          at: Date.now(),
          ids: [...ids].sort().join(","),
          curves: outcome.value.curves,
          health: outcome.value.health,
        });
      } else {
        // Drop any previous entry so a recovered indexer is not shadowed by a
        // stale success, and a failing one is not papered over with old numbers.
        cache.delete(chainKey);
      }
    });
  }

  return {
    stats,
    health,
    complete: health.every((h) => h.reachable),
    fromCache: servedFromCache > 0 && toFetch.length === 0,
  };
}
