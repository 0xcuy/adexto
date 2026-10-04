import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { findProject } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";
import { getLaunchProof, type LaunchProof } from "@/lib/launch-proof";
import { brandMark, chainMarkImage, publicOrigin, robotImage, tokenLogoSrc } from "@/lib/share-card-assets";
import { CARD_COLORS, ShareCard, chainChipLabel } from "@/lib/share-card-layout";
import { launchProofUrlFor } from "@/lib/launch-kit";
import { serveCard } from "@/lib/share-card-cache";

/**
 * Kartu bagikan bukti launch bersih, 1200x630: gambar `og:image` untuk `/token/<slug>?chain=&proof=1`.
 *
 * Isinya hanya angka dari `getLaunchProof`, sumber yang sama dengan panel "Clean launch" di halaman
 * token, jadi kartu dan halaman tidak bisa berselisih. Pasar yang generasinya tidak tercakup mendapat
 * 404, bukan kartu kosong: halaman token lalu memakai kartu pasar biasa.
 *
 * Isinya tidak berubah sesudah jendela launch lewat, tapi cache tetap lima menit seperti kartu lain:
 * gambar yang di-cache setahun di peramban tidak akan pernah menerima perbaikan teks.
 */
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, max-age=300";

function windowValue(p: LaunchProof): string {
  const w = p.launchWindow;
  const cap = `${(w.capBps / 100).toFixed(w.capBps % 100 === 0 ? 0 : 2)}%`;
  if (w.kind === "wallet-cap-seconds") return `${w.seconds}s · ${cap} max`;
  // Di Arbitrum/Robinhood token 0.11.0 menghitung blok Ethereum L1, bukan blok chain itu.
  return `${w.blocks} ${w.clock === "ethereum-blocks" ? "L1 blocks" : "blocks"} · ${cap}/tx`;
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const url = new URL(req.url);
  const chainParam = url.searchParams.get("chain");
  const chainId = chainParam && Number.isFinite(Number(chainParam)) ? Number(chainParam) : null;
  const project = findProject(token, chainId) ?? (chainId !== null ? findProject(token) : null);
  if (!project) return new Response("Market not found.", { status: 404 });

  // Penjaga render bersama; alasannya di `src/lib/share-card-cache.ts`.
  return serveCard(req, `proof:${project.slug}:${project.chainId}`, () => renderProofCard(project));
}

async function renderProofCard(project: NonNullable<ReturnType<typeof findProject>>): Promise<Response> {
  const chain = resolveChainOrDefault(project.chainId);

  let proof;
  try {
    proof = await getLaunchProof(project.chainId, project.tokenAddress);
  } catch {
    return new Response("Chain read failed; try again shortly.", { status: 503, headers: { "cache-control": "no-store" } });
  }
  if (!proof.supported) return new Response(proof.reason, { status: 404 });

  const creatorZero = proof.creatorHeldAtLaunch === "0";
  const noOwner = proof.owner === null && proof.immutable;
  const fees = `${(proof.feeSplit.totalBps / 100).toFixed(2)}% fixed`;
  const noteText = proof.clean
    ? "Read from chain: 100% of supply in the curve, no exempt wallet, no proxy."
    : "Read from chain. Some checks did not pass; the market page lists each one.";

  const marketUrl = launchProofUrlFor(publicOrigin(), project.slug, project.chainId);
  const qr = await QRCode.toDataURL(marketUrl, { margin: 1, width: 280, color: { dark: "#141110", light: CARD_COLORS.cream } });

  return new ImageResponse(
    (
      <ShareCard
        mark={brandMark(44)}
        logoSrc={tokenLogoSrc(project.image)}
        symbol={project.symbol}
        title={`$${project.symbol}`}
        subtitle={proof.clean ? "Clean launch" : "Launch facts"}
        chainLabel={chainChipLabel(chain.name)}
        chainMark={chainMarkImage(chain, 24)}
        stats={[
          { label: "creator at launch", value: creatorZero ? "0 tokens" : "not zero", tone: creatorZero ? "up" : "down" },
          { label: "launch window", value: windowValue(proof) },
          { label: "fees", value: fees },
          { label: "owner", value: noOwner ? "none" : "yes", tone: noOwner ? undefined : "down" },
        ]}
        note={{ text: noteText, color: proof.clean ? CARD_COLORS.ok : CARD_COLORS.creamSoft }}
        marketUrl={marketUrl}
        qr={qr}
        robot={robotImage(300)}
      />
    ),
    { width: 1200, height: 630, headers: { "cache-control": CACHE_CONTROL } }
  );
}
