import { notFound } from "next/navigation";
import type { Metadata } from "next";
import TokenTerminal, { type TerminalProject, type TerminalDeployment } from "@/components/TokenTerminal";
import { findProject, findProjectGroup } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";

/**
 * Server-resolved market page.
 *
 * Previously this was a client component with a hardcoded three-token database and
 * a catch-all fallback: any slug produced a plausible-looking market. `/token/
 * tidakada` rendered "TIDAKADA Autonomous Agent" at $0.15 with a $150,000,000 market
 * cap and a live Buy button pointing at the shared hook address. Unknown slugs now
 * return a real 404.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ chain?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const project = findProject(token);
  if (!project) return { title: "Market not found · ADEXTO" };
  return {
    title: `${project.name} ($${project.symbol}) · ADEXTO Terminal`,
    description: `Trade $${project.symbol} on the ADEXTO Sovereign DEX (${project.chainLabel}).`,
  };
}

export default async function TokenPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { chain: chainParam } = await searchParams;

  // A ticker can be deployed on several chains as independent markets, so `?chain=`
  // pins one. Without it the primary (tradable, then oldest) deployment is used.
  const requestedChainId = chainParam && Number.isFinite(Number(chainParam)) ? Number(chainParam) : null;
  // `findProject` sengaja KETAT saat chainId diberikan: /api/pool dan telemetry
  // memakainya, dan mengembalikan pool chain lain di sana akan menampilkan harga
  // serta reserve yang salah. Di halaman ini kelonggaran justru benar — tautan
  // dengan ?chain= basi tetap harus membuka token yang diminta, bukan 404, dan
  // tanpa pernah berpindah ke symbol lain karena fallback tetap di dalam grup
  // symbol yang sama.
  const project = findProject(token, requestedChainId) ?? (requestedChainId !== null ? findProject(token) : null);
  if (!project) notFound();

  const chain = resolveChainOrDefault(project.chainId);
  const group = findProjectGroup(project.symbol);
  const deployments: TerminalDeployment[] = group.map((p) => {
    const c = resolveChainOrDefault(p.chainId);
    return {
      chainId: p.chainId,
      chainKey: p.chainKey,
      chainName: c.name,
      nativeSymbol: c.nativeSymbol,
      tokenAddress: p.tokenAddress,
      poolAddress: p.poolAddress,
      priceNative: p.priceNative,
      tradable: p.poolLive && Boolean(p.poolAddress),
      isCurrent: p.chainId === project.chainId,
    };
  });

  const serialized: TerminalProject = {
    symbol: project.symbol,
    slug: project.slug,
    name: project.name,
    tokenAddress: project.tokenAddress,
    poolAddress: project.poolAddress,
    chainId: chain.chainId,
    chainLabel: project.chainLabel,
    nativeSymbol: chain.nativeSymbol,
    priceNative: project.priceNative,
    supply: project.supply,
    lpFeeBps: project.lpFeeBps,
    treasuryBuybackBps: project.treasuryBuybackBps,
    agentModel: project.agentModel,
    agentPersona: project.agentPersona,
    agentStatus: project.agentStatus,
    image: project.image,
    teeRoot: project.teeRoot,
    txHash: project.txHash,
    verified: project.verified,
    curated: project.curated,
    poolLive: project.poolLive,
    edgeProvider: project.edgeProvider,
    mcpTools: project.mcpTools,
  };

  return <TokenTerminal project={serialized} deployments={deployments} />;
}
