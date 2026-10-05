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

const BUDGET_TTL_MS = 60_000;
const budgetCache = new Map<string, { at: number; value: HubBudget }>();

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

/** The market's compute budget so far, cached for a minute. */
export async function hubBudget(source: ComputeStake): Promise<HubBudget> {
  const hit = budgetCache.get(source.id);
  if (hit && Date.now() - hit.at < BUDGET_TTL_MS) return hit.value;

  const nativeSymbol = source.nativeSymbol ?? "";
  const fees = await protocolFeesWei(source);
  let priceUsd: number | null = null;
  try {
    const { prices } = await nativePrices();
    const p = prices[nativeSymbol];
    priceUsd = typeof p === "number" && p > 0 ? p : null;
  } catch {
    priceUsd = null;
  }
  const feesNative = fees === null ? 0 : Number(ethers.formatEther(fees));
  const budgetUsd = fees === null || priceUsd === null ? null : (feesNative * priceUsd * HUB_COMPUTE_SHARE_BPS) / 10_000;
  const value: HubBudget = {
    feesWei: fees === null ? "0" : fees.toString(),
    feesNative,
    nativeSymbol,
    priceUsd,
    budgetUsd,
    budgetTokens: budgetUsd === null ? null : hubTokensForUsd(budgetUsd),
    shareBps: HUB_COMPUTE_SHARE_BPS,
    error: fees === null ? "The curve could not be read." : priceUsd === null ? `No ${nativeSymbol} price right now.` : null,
  };
  budgetCache.set(source.id, { at: Date.now(), value });
  return value;
}

/**
 * Whether the hub accepts this market's token, or null when the hub cannot be read.
 *
 * Cached for good: `curveOf` is written once, by the launch that made the token, and the factory
 * and exclusion lists were fixed in the hub's constructor, so the answer for a token never changes.
 * It is false for a market from a factory the hub does not know, such as one deployed after it.
 */
const eligibleCache = new Map<string, boolean>();

export async function hubEligible(source: ComputeStake): Promise<boolean | null> {
  if (source.kind !== "hub" || !source.contract) return null;
  const k = `${source.chainId}:${source.token.toLowerCase()}`;
  const hit = eligibleCache.get(k);
  if (hit !== undefined) return hit;
  const p = provider(source.chainId);
  if (!p) return null;
  try {
    const hub = new ethers.Contract(source.contract, ["function isEligible(address) view returns (bool)"], p);
    const ok = Boolean(await hub.isEligible(source.token));
    eligibleCache.set(k, ok);
    return ok;
  } catch {
    return null;
  }
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
