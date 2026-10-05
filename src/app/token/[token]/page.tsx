import { notFound } from "next/navigation";
import type { Metadata } from "next";
import TokenTerminal, { type TerminalProject, type TerminalDeployment } from "@/components/TokenTerminal";
import Link from "next/link";
import { findDelisted, findProject, findProjectGroup, type ProjectRecord } from "@/lib/registry";
import { logoUrlFor } from "@/lib/logo-image";
import { explorerAddressUrl, resolveChainOrDefault } from "@/lib/chains";
import { SHARE_CARD_VERSION } from "@/lib/share-card-format";
import { getLaunchProof } from "@/lib/launch-proof";

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
  searchParams: Promise<{ chain?: string; proof?: string }>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const { chain: chainParam, proof: proofParam } = await searchParams;
  const wantsProof = proofParam === "1";
  // Pratinjau mengikuti `?chain=` tautannya. Tanpa ini, tautan pasar Base untuk ticker yang juga
  // ada di chain lain membawa kartu chain yang kebetulan terdaftar pertama.
  const chainId = chainParam && Number.isFinite(Number(chainParam)) ? Number(chainParam) : null;
  const project = (chainId !== null ? findProject(token, chainId) : null) ?? findProject(token);
  if (!project) {
    const delisted = (chainId !== null ? findDelisted(token, chainId) : null) ?? findDelisted(token);
    if (delisted) return { title: `$${delisted.project.symbol} was removed from this site · ADEXTO`, robots: { index: false } };
    return { title: "Market not found · ADEXTO" };
  }
  /**
   * `og:image` menunjuk kartu yang dirender server, bukan gambar statis.
   *
   * Artinya tautan pasar yang ditempel ke X atau Telegram membawa harga dan kapitalisasi
   * pasar ITU, bukan satu gambar merek yang sama untuk semua pasar. Kartunya dibangun dari
   * registry yang sama dengan halamannya, jadi keduanya tidak bisa menyebut angka berbeda.
   */
  const marketCard = `/api/share-card/${encodeURIComponent(project.slug)}?chain=${project.chainId}&v=${SHARE_CARD_VERSION}`;
  /**
   * `?proof=1` adalah tautan "Share proof": pratinjaunya kartu bukti launch bersih, bukan kartu harga.
   * Hanya bila pasarnya tercakup bukti; pasar generasi lain tetap memakai kartu pasar. Pembacaan
   * chain dibatasi empat detik supaya halaman tidak tertahan: kalau belum terjawab, kartu bukti
   * tetap dipakai, karena rute gambarnya membaca sendiri (dan pembacaannya sudah berjalan di cache).
   */
  if (wantsProof) {
    const proof = await Promise.race([
      getLaunchProof(project.chainId, project.tokenAddress).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000)),
    ]);
    if (!proof || proof.supported) {
      const proofCard = `/api/share-card/${encodeURIComponent(project.slug)}/launch-proof?chain=${project.chainId}&v=${SHARE_CARD_VERSION}`;
      return {
        title: `$${project.symbol} launch proof · ADEXTO`,
        description: `Launch facts for $${project.symbol} on ${project.chainLabel}, read from chain: creator balance at launch, launch window, fees, owner.`,
        openGraph: {
          title: `$${project.symbol} · launch facts, read from chain`,
          description: `Creator balance at launch, launch window, fixed fees and owner of $${project.symbol} on ${project.chainLabel}.`,
          images: [{ url: proofCard, width: 1200, height: 630 }],
        },
        twitter: { card: "summary_large_image", images: [proofCard] },
      };
    }
  }
  const card = marketCard;
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
  if (!project) {
    // Pasar yang dicabut (src/config/delisted-markets.ts) mendapat pemberitahuan dengan alasannya,
    // bukan 404 biasa: pemegangnya perlu tahu apa yang terjadi dan bahwa kontraknya tetap ada.
    const delisted = findDelisted(token, requestedChainId) ?? (requestedChainId !== null ? findDelisted(token) : null);
    if (delisted) return <DelistedNotice {...delisted} />;
    notFound();
  }

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

/**
 * Halaman pasar yang dicabut. Tanpa terminal, tanpa tombol beli, tanpa pitch atau tautan creator:
 * yang ditolak tidak boleh tetap dipajang lewat jalan belakang. Yang ditampilkan hanya alasannya,
 * alamat kontraknya (supaya pemegang bisa memeriksanya di explorer), dan apa yang tidak bisa dilakukan.
 */
function DelistedNotice({ project, reason, decidedAt }: { project: ProjectRecord; reason: string; decidedAt: string }) {
  const chain = resolveChainOrDefault(project.chainId);
  const link = "font-semibold text-accent hover:underline";
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <p className="kicker mb-2">Removed from this site</p>
      <h1 className="font-display text-2xl font-light tracking-tight text-ink">
        ${project.symbol} on {chain.name}
      </h1>
      <div className="mt-6 space-y-4 text-[14px] leading-relaxed text-ink-soft">
        <p>
          <strong className="text-ink">Reason:</strong> {reason}
          {decidedAt ? ` (${decidedAt})` : ""}
        </p>
        <p>
          ADEXTO no longer lists, sells or announces this market: not on this site, not through the x402 gateway, and not
          through the MCP or A2A agent tools. See the{" "}
          <Link href="/acceptable-use" className={link}>
            acceptable use policy
          </Link>
          .
        </p>
        <p>
          The contracts still exist on chain and nobody, including us, can freeze them, stop trades made directly against
          the curve, or return funds. Check them yourself:
        </p>
        <ul className="list-disc space-y-1 pl-5 font-mono text-[12px]">
          <li>
            token{" "}
            <a href={explorerAddressUrl(project.chainId, project.tokenAddress)} target="_blank" rel="noopener noreferrer" className={link}>
              {project.tokenAddress}
            </a>
          </li>
          {project.poolAddress ? (
            <li>
              curve{" "}
              <a href={explorerAddressUrl(project.chainId, project.poolAddress)} target="_blank" rel="noopener noreferrer" className={link}>
                {project.poolAddress}
              </a>
            </li>
          ) : null}
        </ul>
        <p>
          If you were defrauded, report it to the police where you live with the transaction hashes. Questions:{" "}
          <Link href="/report" className={link}>
            Report a market
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
