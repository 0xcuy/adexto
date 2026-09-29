import { notFound } from "next/navigation";
import type { Metadata } from "next";
import TokenTerminal, { type TerminalProject, type TerminalDeployment } from "@/components/TokenTerminal";
import { findProject, findProjectGroup } from "@/lib/registry";
import { logoUrlFor } from "@/lib/logo-image";
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
  /**
   * `og:image` menunjuk kartu yang dirender server, bukan gambar statis.
   *
   * Artinya tautan pasar yang ditempel ke X atau Telegram membawa harga dan kapitalisasi
   * pasar ITU, bukan satu gambar merek yang sama untuk semua pasar. Kartunya dibangun dari
   * registry yang sama dengan halamannya, jadi keduanya tidak bisa menyebut angka berbeda.
   */
  const card = `/api/share-card/${encodeURIComponent(project.slug)}?chain=${project.chainId}`;
  return {
    title: `${project.name} ($${project.symbol}) · ADEXTO Terminal`,
    description: `Trade $${project.symbol} on the ADEXTO Sovereign DEX (${project.chainLabel}).`,
    openGraph: {
      title: `$${project.symbol} · ${project.name}`,
      description: `Trading on ${project.chainLabel} against a curve with no withdrawal function.`,
      images: [{ url: card, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: [card] },
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
    deployedAt: project.deployedAt,
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
    // Pitch dan tautan milik creator. Sudah dibersihkan registry saat dibaca, jadi apa
    // yang sampai ke komponen tidak pernah berupa `javascript:` atau host palsu X.
    description: project.description,
    links: project.links,
    // Alamat peluncur. Dikirim ke klien HANYA untuk memutuskan apakah tombol sunting
    // ditawarkan; yang menegakkan siapa boleh menyunting adalah tanda tangan yang
    // diverifikasi `/api/market/update` terhadap nilai ini di registry.
    creator: project.creator,
    // URL, bukan data URI: alasannya di `src/lib/logo-image.ts`. Tanpa ini halaman token
    // tetap menyisipkan 34 KB base64 ke dalam payload RSC-nya sendiri.
    image: logoUrlFor(project),
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
