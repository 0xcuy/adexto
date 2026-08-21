import { NextResponse } from "next/server";
import { listProjects, customProjectCount, marketKey, type ProjectRecord } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";
import { isDurable } from "@/lib/server-store";
import { fetchCurveStats, type CurveStats, type SubgraphChainHealth } from "@/lib/subgraph";
import { ANY_SUBGRAPH_CONFIGURED } from "@/config/subgraph";

/**
 * Project index consumed by /explorer, /swap and /token/[slug].
 *
 * Changed from the previous revision:
 *   - prices are numeric and carry their unit (`priceNative` + `nativeSymbol`)
 *     instead of display strings like "0.00018 ETH" that callers stripped and
 *     then treated as USD;
 *   - the list is deduplicated and curated entries always win, so a launch can no
 *     longer shadow an official project by reusing its ticker;
 *   - every record states whether it is `verified` on-chain and whether its pool
 *     is `poolLive`, so the UI can disable trading instead of guessing;
 *   - a subgraph is consulted as a SECOND read path, described below.
 *
 * TWO READ PATHS, IN THIS ORDER
 *
 * The registry decides which markets exist. The subgraph only attaches live curve
 * state to markets the registry already returned. The subgraph cannot add,
 * remove, rename or retarget a market, and a subgraph outage cannot change this
 * endpoint's shape -- `live` goes null and every other field is untouched.
 *
 * That ordering is not a preference. An indexer trails the chain by design and
 * can be minutes behind or failed. A launch that just succeeded on-chain is in
 * the registry immediately and in the subgraph later, so a subgraph-first
 * explorer would tell the person who just paid for a token that it does not
 * exist, and no retry would fix it.
 *
 * WHY LIVE DATA IS A SEPARATE `live` OBJECT INSTEAD OF OVERWRITING FIELDS
 *
 * Registry values are launch-time facts. Subgraph values are current chain state.
 * Flattening the two would leave callers unable to tell which they were holding,
 * and would silently swap a known-good value for one from a component that may be
 * stale. The single exception is `priceNative`: when the registry has no price at
 * all (0), the indexed spot price fills the gap, because "we have a price and are
 * hiding it" is worse than either alternative. Filling an empty field is not the
 * same as overriding a populated one.
 */
export const dynamic = "force-dynamic";

/** Shape returned under `live`. Null whenever the indexer had nothing for it. */
function serializeLive(stats: CurveStats | undefined, nativeSymbol: string) {
  if (!stats) return null;
  return {
    curveAddress: stats.curveAddress,
    nativeSymbol,
    // Reserve and volume stay strings: these are wei-scale integers and a JS
    // number loses precision above 2^53.
    reserveNative: stats.reserveNative,
    reserveToken: stats.reserveToken,
    tokensSold: stats.tokensSold,
    volumeNative: stats.volumeNative,
    tokensBurned: stats.tokensBurned,
    totalDepthFees: stats.totalDepthFees,
    totalCreatorFees: stats.totalCreatorFees,
    totalTreasuryFees: stats.totalTreasuryFees,
    totalCreatorFeesClaimed: stats.totalCreatorFeesClaimed,
    // Prices are floats: they sit around 1e-9 and integer parsing would floor
    // them to zero, producing a flat chart with no error anywhere.
    spotPriceNative: stats.spotPriceNative,
    floorPriceNative: stats.floorPriceNative,
    swapCount: stats.swapCount,
    buyCount: stats.buyCount,
    sellCount: stats.sellCount,
    initialized: stats.initialized,
    lastSwapTimestamp: stats.lastSwapTimestamp,
  };
}

function serialize(
  project: ProjectRecord,
  all: ProjectRecord[],
  stats: Map<string, CurveStats>,
) {
  const chain = resolveChainOrDefault(project.chainId);
  const live = project.poolAddress
    ? serializeLive(stats.get(project.poolAddress.toLowerCase()), project.nativeSymbol)
    : null;

  // A one-click multi-chain launch produces one independent market per chain.
  // `alsoOn` lets a client show the sibling deployments without guessing, and
  // `marketKey` gives every row a stable identity now that the ticker alone is
  // no longer unique.
  const alsoOn = all
    .filter((p) => p.symbol === project.symbol && p.chainId !== project.chainId)
    .map((p) => {
      const sibling = p.poolAddress ? stats.get(p.poolAddress.toLowerCase()) : undefined;
      return {
        chainId: p.chainId,
        chainKey: p.chainKey,
        chainName: resolveChainOrDefault(p.chainId).name,
        tokenAddress: p.tokenAddress,
        poolAddress: p.poolAddress,
        priceNative: p.priceNative || (sibling?.spotPriceNative ?? 0),
        nativeSymbol: p.nativeSymbol,
        tradable: p.poolLive && Boolean(p.poolAddress),
      };
    });

  return {
    id: project.id,
    marketKey: marketKey(project.chainId, project.symbol),
    alsoOn,
    deployedChainCount: alsoOn.length + 1,
    tokenAddress: project.tokenAddress,
    poolAddress: project.poolAddress,
    creator: project.creator,
    name: project.name,
    symbol: project.symbol,
    slug: project.slug,

    chainId: project.chainId,
    chainKey: project.chainKey,
    chain: project.chainLabel,
    targetChainIds: project.targetChainIds,
    nativeSymbol: project.nativeSymbol,
    blockExplorer: chain.blockExplorer,

    // Registry value wins. The indexed spot price only fills a genuine zero.
    priceNative: project.priceNative || (live?.spotPriceNative ?? 0),
    /** Which read path produced `priceNative`, so a caller can tell. */
    priceSource: project.priceNative ? "registry" : live?.spotPriceNative ? "subgraph" : "none",
    supply: project.supply,
    lpFeeBps: project.lpFeeBps,
    treasuryBuybackBps: project.treasuryBuybackBps,

    agentModel: project.agentModel,
    agentPersona: project.agentPersona,
    agentStatus: project.agentStatus,
    edgeProvider: project.edgeProvider,
    mcpTools: project.mcpTools,
    category: project.category,
    image: project.image,

    transactionHash: project.txHash,
    blockNumber: project.blockNumber,
    /**
     * The 0G DA storage root of the launch metadata: a content hash. It is not a
     * hardware attestation report, and the old name `teeAttestationRoot` is what
     * let the product pages claim an attestation nobody ever verified. Kept as an
     * alias only because existing clients read it.
     */
    metadataRoot: project.teeRoot,
    teeAttestationRoot: project.teeRoot,
    daStorageTx: project.daStorageTx,
    deployedAt: String(project.deployedAt),

    verified: project.verified,
    curated: project.curated,
    poolLive: project.poolLive,
    tradable: project.poolLive && Boolean(project.poolAddress),

    /** Current chain state from the indexer. Null when unavailable. */
    live,
  };
}

function indexerSummary(health: SubgraphChainHealth[], fromCache: boolean) {
  const reachable = health.filter((h) => h.reachable);
  return {
    /** False when no SUBGRAPH_URL_* is set at all; the app runs fine without. */
    configured: ANY_SUBGRAPH_CONFIGURED,
    /** Registry is always first; this states it rather than leaving it implied. */
    primarySource: "registry",
    secondarySource: reachable.length > 0 ? "subgraph" : null,
    chainsReachable: reachable.length,
    chainsQueried: health.length,
    fromCache,
    chains: health.map((h) => ({
      chainKey: h.chainKey,
      chainId: h.chainId,
      configured: h.configured,
      envVar: h.envVar,
      reachable: h.reachable,
      indexedBlock: h.indexedBlock,
      hasIndexingErrors: h.hasIndexingErrors,
      curvesReturned: h.curvesReturned,
      latencyMs: h.latencyMs,
      error: h.error,
    })),
  };
}

async function payload() {
  // Path one. Complete on its own, and everything below is additive.
  const records = listProjects();

  // Path two. Only curves the registry already knows about are ever asked for.
  const targets = records
    .filter((r) => r.poolAddress)
    .map((r) => ({ chainKey: r.chainKey, curveAddress: r.poolAddress as string }));
  const { stats, health, fromCache } = await fetchCurveStats(targets);

  const projects = records.map((r) => serialize(r, records, stats));
  const distinctSymbols = new Set(records.map((r) => r.symbol)).size;
  const withLive = projects.filter((p) => p.live !== null);

  // Global totals come from the indexer where it answered, summed across chains.
  // A subgraph is always single-network, so no single GlobalStats entity spans the
  // deployment set and summing here is the only correct place to do it.
  const sumBig = (pick: (s: CurveStats) => string) =>
    [...stats.values()].reduce((acc, s) => acc + BigInt(pick(s) || "0"), 0n).toString();

  return {
    data: {
      projects,
      globalStats: {
        id: "global",
        totalProjects: String(projects.length),
        distinctSymbols: String(distinctSymbols),
        multiChainSymbols: String(projects.filter((p) => p.deployedChainCount > 1).length),
        curatedProjects: String(projects.filter((p) => p.curated).length),
        launchedProjects: String(customProjectCount()),
        tradableProjects: String(projects.filter((p) => p.tradable).length),
        verifiedProjects: String(projects.filter((p) => p.verified).length),
        /** Markets the indexer had state for. Zero is normal without a subgraph. */
        indexedMarkets: String(withLive.length),
        totalSwaps: String([...stats.values()].reduce((a, s) => a + s.swapCount, 0)),
        totalVolumeNative: sumBig((s) => s.volumeNative),
        totalTokensBurned: sumBig((s) => s.tokensBurned),
        totalDepthFees: sumBig((s) => s.totalDepthFees),
      },
      registry: {
        durable: isDurable(),
      },
      indexer: indexerSummary(health, fromCache),
    },
  };
}

export async function POST() {
  try {
    return NextResponse.json(await payload());
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    return NextResponse.json(await payload());
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
