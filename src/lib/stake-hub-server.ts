/**
 * Server side of the stake hubs: which markets stake in a hub, and how much compute each market's
 * own trading has paid for.
 *
 * SOURCES COME FROM THE REGISTRY, NOT FROM A LIST
 *
 * Every live, tradable market on a chain with a hub becomes a compute source, except the tokens
 * the hub refuses (the four with their own AdextoAgentStake, which stay in COMPUTE_STAKES with
 * their tiers). So a market launched a minute ago is a source as soon as the registry lists it,
 * and nobody edits a config file for it.
 *
 * THE BUDGET IS READ FROM THE CURVE
 *
 * `totalProtocolFeesPaid()` plus `protocolOwed()` is everything the curve has taken for the
 * protocol leg (0.10% of each trade) since launch, claimed or not; both views exist on 0.11.0 and
 * 1.0.0 curves. Half of it, valued at the native price when read, is the market's compute budget.
 * The pool turns increases of that number into allowances for the market's keys.
 */
import { ethers } from "ethers";
import {
  COMPUTE_STAKES,
  HUB_COMPUTE_SHARE_BPS,
  hubComputeStakeId,
  hubTokensForUsd,
  type ComputeStake,
} from "@/config/agent-compute";
import { hubMinStake, hubRefuses, stakeHubFor } from "@/config/stake-hubs";
import { CHAIN_LIST } from "@/lib/chains";
import { nativePrices } from "@/lib/native-price";
import { listServedProjects } from "@/lib/registry";
import { decodeBool, decodeUint, multiReadAll } from "@/lib/multicall-read";

/** The short chain names the Agent Compute page already uses for the four tiered sources. */
const CHAIN_NAME: Record<number, string> = {
  143: "Monad",
  42161: "Arbitrum One",
  4663: "Robinhood Chain",
  8453: "Base",
  5042: "Arc",
  16661: "0G",
};

/** One compute source per live market that stakes in its chain's hub. */
export function hubComputeSources(): ComputeStake[] {
  const out: ComputeStake[] = [];
  const seen = new Set<string>();
  // Pasar yang dicabut tidak lagi menjadi sumber compute baru.
  for (const p of listServedProjects()) {
    if (!p.poolLive || !p.poolAddress || !p.tokenAddress) continue;
    const hub = stakeHubFor(p.chainId);
    if (!hub || hubRefuses(p.chainId, p.tokenAddress)) continue;
    const id = hubComputeStakeId(p.chainId, p.symbol);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: "hub",
      chainId: Number(p.chainId),
      chainName: CHAIN_NAME[Number(p.chainId)] ?? p.chainLabel,
      symbol: String(p.symbol).toUpperCase(),
      name: p.name,
      token: p.tokenAddress,
      decimals: 18,
      contract: hub.address,
      minStake: hubMinStake(p.supply),
      tiers: [],
      buyHref: `/token/${p.slug}?chain=${p.chainId}`,
      curve: p.poolAddress,
      nativeSymbol: p.nativeSymbol,
    });
  }
  return out;
}

/** The four tiered sources first, then every hub market. */
export function allComputeSources(): ComputeStake[] {
  return [...COMPUTE_STAKES, ...hubComputeSources()];
}

/**
 * A source by id, or null. Deliberately no fallback: `computeStake()` in the config falls back to
 * $ADEXTO, which is right for the page's static list and wrong for a key, which would then be
 * swept against a stake it never had.
 */
export function findComputeSource(id: string | null | undefined): ComputeStake | null {
  if (!id) return null;
  return allComputeSources().find((s) => s.id === id) ?? null;
}

export type HubBudget = {
  /** Protocol fees the curve has taken since launch, in wei of the chain's native asset. */
  feesWei: string;
  feesNative: number;
  nativeSymbol: string;
  priceUsd: number | null;
  /** Half of the fees in USD, at the price read now. */
  budgetUsd: number | null;
  /** That budget in model tokens. */
  budgetTokens: number | null;
  shareBps: number;
  error: string | null;
};

function provider(chainId: number): ethers.JsonRpcProvider | null {
  const chain = CHAIN_LIST.find((c) => c.chainId === Number(chainId));
  return chain ? new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId, { staticNetwork: true, batchMaxCount: 1 }) : null;
}

/** Protocol fees collected by a hub market's curve, in wei. Null when the curve cannot be read. */
export async function protocolFeesWei(source: ComputeStake): Promise<bigint | null> {
  if (source.kind !== "hub" || !source.curve) return null;
  const p = provider(source.chainId);
  if (!p) return null;
  const curve = new ethers.Contract(
    source.curve,
    ["function totalProtocolFeesPaid() view returns (uint256)", "function protocolOwed() view returns (uint256)"],
    p
  );
  try {
    const [paid, owed] = (await Promise.race([
      Promise.all([curve.totalProtocolFeesPaid(), curve.protocolOwed()]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("curve read timed out")), 12_000)),
    ])) as [bigint, bigint];
    return paid + owed;
  } catch {
    return null;
  }
}

/**
 * A market's compute budget from fees and a price already read. Pure, and the one place the formula
 * lives: the page's catalog (`agent-compute-catalog.ts`, which reads every curve in one multicall)
 * uses it, and the sweep applies the same share and price to fee increases. (Replaced the
 * one-curve-at-a-time `hubBudget`, 7 Oct.)
 */
export function budgetFromFees(fees: bigint | null, nativeSymbol: string, priceUsd: number | null): HubBudget {
  const feesNative = fees === null ? 0 : Number(ethers.formatEther(fees));
  const budgetUsd = fees === null || priceUsd === null ? null : (feesNative * priceUsd * HUB_COMPUTE_SHARE_BPS) / 10_000;
  return {
    feesWei: fees === null ? "0" : fees.toString(),
    feesNative,
    nativeSymbol,
    priceUsd,
    budgetUsd,
    budgetTokens: budgetUsd === null ? null : hubTokensForUsd(budgetUsd),
    shareBps: HUB_COMPUTE_SHARE_BPS,
    error: fees === null ? "The curve could not be read." : priceUsd === null ? `No ${nativeSymbol} price right now.` : null,
  };
}

/** The native price for a symbol, or null when there is none right now. */
export async function nativePriceUsd(nativeSymbol: string): Promise<number | null> {
  try {
    const { prices } = await nativePrices();
    const p = prices[nativeSymbol];
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * On-chain figures for many sources at once, through Multicall3 (`multicall-read.ts`).
 *
 *   hub source     totalStaked(token), stakerCount(token) on the hub, and the curve's
 *                  totalProtocolFeesPaid() + protocolOwed()
 *   tiered source  totalStaked(), stakerCount() on its own AdextoAgentStake
 *
 * Every field is null when its read failed, never 0: "nobody staked" and "not readable" are
 * different answers, and the sweep must not act on the second as if it were the first.
 */
export type SourceMetrics = {
  totalStaked: number | null;
  stakers: number | null;
  /** Protocol fees the curve has taken since launch (wei). Hub sources only. */
  feesWei: bigint | null;
};

const HUB_READS = new ethers.Interface([
  "function totalStaked(address) view returns (uint256)",
  "function stakerCount(address) view returns (uint256)",
  "function isEligible(address) view returns (bool)",
  "function stakedOf(address,address) view returns (uint256)",
]);
const OWN_STAKE_READS = new ethers.Interface([
  "function totalStaked() view returns (uint256)",
  "function stakerCount() view returns (uint256)",
  "function stakedOf(address) view returns (uint256)",
]);
const CURVE_READS = new ethers.Interface([
  "function totalProtocolFeesPaid() view returns (uint256)",
  "function protocolOwed() view returns (uint256)",
]);

export async function sourceMetricsBatch(sources: readonly ComputeStake[]): Promise<Map<string, SourceMetrics>> {
  type K = `${string}|${"total" | "stakers" | "paid" | "owed"}`;
  const calls: Array<{ key: K; chainId: number; target: string; data: string }> = [];
  for (const s of sources) {
    if (!s.contract) continue;
    if (s.kind === "hub") {
      calls.push({ key: `${s.id}|total`, chainId: s.chainId, target: s.contract, data: HUB_READS.encodeFunctionData("totalStaked", [s.token]) });
      calls.push({ key: `${s.id}|stakers`, chainId: s.chainId, target: s.contract, data: HUB_READS.encodeFunctionData("stakerCount", [s.token]) });
      if (s.curve) {
        calls.push({ key: `${s.id}|paid`, chainId: s.chainId, target: s.curve, data: CURVE_READS.encodeFunctionData("totalProtocolFeesPaid", []) });
        calls.push({ key: `${s.id}|owed`, chainId: s.chainId, target: s.curve, data: CURVE_READS.encodeFunctionData("protocolOwed", []) });
      }
    } else {
      calls.push({ key: `${s.id}|total`, chainId: s.chainId, target: s.contract, data: OWN_STAKE_READS.encodeFunctionData("totalStaked", []) });
      calls.push({ key: `${s.id}|stakers`, chainId: s.chainId, target: s.contract, data: OWN_STAKE_READS.encodeFunctionData("stakerCount", []) });
    }
  }
  const raw = await multiReadAll(calls);
  const out = new Map<string, SourceMetrics>();
  for (const s of sources) {
    const total = decodeUint(raw.get(`${s.id}|total`));
    const stakers = decodeUint(raw.get(`${s.id}|stakers`));
    const paid = decodeUint(raw.get(`${s.id}|paid`));
    const owed = decodeUint(raw.get(`${s.id}|owed`));
    out.set(s.id, {
      totalStaked: total === null ? null : Number(ethers.formatUnits(total, s.decimals)),
      stakers: stakers === null ? null : Number(stakers),
      feesWei: s.kind === "hub" && paid !== null && owed !== null ? paid + owed : null,
    });
  }
  return out;
}

/**
 * One address's stake in many sources, keyed by source id. Null means the read failed (or the
 * source has no stake contract), not that the address holds nothing.
 */
export async function stakesOfBatch(address: string, sources: readonly ComputeStake[]): Promise<Map<string, number | null>> {
  const calls = sources
    .filter((s) => s.contract)
    .map((s) => ({
      key: s.id,
      chainId: s.chainId,
      target: s.contract as string,
      data:
        s.kind === "hub"
          ? HUB_READS.encodeFunctionData("stakedOf", [s.token, address])
          : OWN_STAKE_READS.encodeFunctionData("stakedOf", [address]),
    }));
  const raw = await multiReadAll(calls);
  const out = new Map<string, number | null>();
  for (const s of sources) {
    const v = decodeUint(raw.get(s.id));
    out.set(s.id, v === null ? null : Number(ethers.formatUnits(v, s.decimals)));
  }
  return out;
}

/**
 * Many (source, address) stakes at once, for the sweep: keyed `${sourceId}:${address}`.
 * Same null rule as `stakesOfBatch`.
 */
export async function stakePairsBatch(
  pairs: ReadonlyArray<{ source: ComputeStake; address: string }>,
): Promise<Map<string, number | null>> {
  const calls = pairs
    .filter((p) => p.source.contract)
    .map((p) => ({
      key: `${p.source.id}:${p.address}`,
      chainId: p.source.chainId,
      target: p.source.contract as string,
      data:
        p.source.kind === "hub"
          ? HUB_READS.encodeFunctionData("stakedOf", [p.source.token, p.address])
          : OWN_STAKE_READS.encodeFunctionData("stakedOf", [p.address]),
    }));
  const raw = await multiReadAll(calls);
  const out = new Map<string, number | null>();
  for (const p of pairs) {
    const key = `${p.source.id}:${p.address}`;
    const v = decodeUint(raw.get(key));
    out.set(key, v === null ? null : Number(ethers.formatUnits(v, p.source.decimals)));
  }
  return out;
}

/**
 * Whether the hub accepts each market's token (`isEligible`), in one multicall per chain; null when
 * the hub could not be read.
 *
 * Cached for good: `curveOf` is written once, by the launch that made the token, and the factory
 * and exclusion lists were fixed in the hub's constructor, so the answer for a token never changes.
 * It is false for a market from a factory the hub does not know, such as one deployed after it.
 * Sources already cached cost nothing; a source whose read failed stays unknown and is read again
 * on the next call. (Replaced the one-read-per-market `hubEligible`, 7 Oct.)
 */
const eligibleCache = new Map<string, boolean>();

export async function hubEligibleBatch(sources: readonly ComputeStake[]): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  const todo: ComputeStake[] = [];
  for (const s of sources) {
    if (s.kind !== "hub" || !s.contract) {
      out.set(s.id, null);
      continue;
    }
    const hit = eligibleCache.get(`${s.chainId}:${s.token.toLowerCase()}`);
    if (hit !== undefined) out.set(s.id, hit);
    else todo.push(s);
  }
  if (todo.length) {
    const raw = await multiReadAll(
      todo.map((s) => ({
        key: s.id,
        chainId: s.chainId,
        target: s.contract as string,
        data: HUB_READS.encodeFunctionData("isEligible", [s.token]),
      })),
    );
    for (const s of todo) {
      const ok = decodeBool(raw.get(s.id));
      if (ok !== null) eligibleCache.set(`${s.chainId}:${s.token.toLowerCase()}`, ok);
      out.set(s.id, ok);
    }
  }
  return out;
}

/** Total staked in a hub market, in whole tokens. Null when the hub cannot be read. */
export async function hubTotalStaked(source: ComputeStake): Promise<number | null> {
  if (source.kind !== "hub" || !source.contract) return null;
  const p = provider(source.chainId);
  if (!p) return null;
  try {
    const hub = new ethers.Contract(source.contract, ["function totalStaked(address) view returns (uint256)"], p);
    const raw = (await hub.totalStaked(source.token)) as bigint;
    return Number(ethers.formatUnits(raw, source.decimals));
  } catch {
    return null;
  }
}
