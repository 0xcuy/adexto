import { NextResponse } from "next/server";
import { listProjects, customProjectCount, marketKey, type ProjectRecord } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";
import { isDurable } from "@/lib/server-store";

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
 *     is `poolLive`, so the UI can disable trading instead of guessing.
 */
export const dynamic = "force-dynamic";

function serialize(project: ProjectRecord, all: ProjectRecord[]) {
  const chain = resolveChainOrDefault(project.chainId);

  // A one-click multi-chain launch produces one independent market per chain.
  // `alsoOn` lets a client show the sibling deployments without guessing, and
  // `marketKey` gives every row a stable identity now that the ticker alone is
  // no longer unique.
  const alsoOn = all
    .filter((p) => p.symbol === project.symbol && p.chainId !== project.chainId)
    .map((p) => ({
      chainId: p.chainId,
      chainKey: p.chainKey,
      chainName: resolveChainOrDefault(p.chainId).name,
      tokenAddress: p.tokenAddress,
      poolAddress: p.poolAddress,
      priceNative: p.priceNative,
      nativeSymbol: p.nativeSymbol,
      tradable: p.poolLive && Boolean(p.poolAddress),
    }));

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

    priceNative: project.priceNative,
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
    teeAttestationRoot: project.teeRoot,
    daStorageTx: project.daStorageTx,
    deployedAt: String(project.deployedAt),

    verified: project.verified,
    curated: project.curated,
    poolLive: project.poolLive,
    tradable: project.poolLive && Boolean(project.poolAddress),
  };
}

function payload() {
  const records = listProjects();
  const projects = records.map((r) => serialize(r, records));
  const distinctSymbols = new Set(records.map((r) => r.symbol)).size;

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
      },
      registry: {
        durable: isDurable(),
      },
    },
  };
}

export async function POST() {
  try {
    return NextResponse.json(payload());
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    return NextResponse.json(payload());
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
