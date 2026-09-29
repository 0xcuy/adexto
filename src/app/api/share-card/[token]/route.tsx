import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { findProject } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";
import { readPoolState } from "@/lib/dex";
import { nativePrices } from "@/lib/native-price";
import { STABLE_PRICES, assetPriceUsd, formatUsd, type AssetPrices } from "@/lib/pricing";
import { cardNative, cardUsd } from "@/lib/share-card-format";
import { brandMark, publicOrigin, robotImage, tokenLogoSrc } from "@/lib/share-card-assets";
import { CARD_COLORS, ShareCard, chainChipLabel } from "@/lib/share-card-layout";

/**
 * Kartu bagikan: gambar 1200x630 untuk sebuah pasar.
 *
 * KENAPA SEBUAH GAMBAR, BUKAN HANYA TAUTAN
 *
 * Tautan yang ditempel ke X atau Telegram hanya menjadi sebaris URL kalau tidak ada gambar
 * di belakangnya. Kartu ini yang membuat bagikan terlihat seperti sesuatu, dan ia dirender
 * dari data registry yang SAMA dengan halamannya — jadi harga di kartu tidak bisa menjadi
 * angka karangan yang berbeda dari harga di halaman.
 *
 * YANG TIDAK DITULIS DI KARTU
 *
 * Tidak ada klaim performa, tidak ada "naik X%", dan tidak ada PnL. Angka seperti itu butuh
 * riwayat yang kami tidak punya untuk setiap pasar, dan kartu yang menjanjikannya akan
 * dibagikan lebih jauh daripada halaman yang bisa mengoreksinya. Yang ditulis hanya keadaan
 * saat kartu dibuat: kapitalisasi, harga, chain.
 *
 * TIDAK ADA YANG DIBACA LEWAT JARINGAN SENDIRI
 *
 * Alamat, harga, dan gambar semuanya diselesaikan di proses ini. Alasannya — `req.url` di
 * dalam kontainer adalah `https://0.0.0.0:3000` — ada di `src/lib/share-card-assets.ts`.
 *
 * `runtime` dibiarkan Node (bawaan) karena registry membaca berkas dari disk.
 */

export const dynamic = "force-dynamic";

/**
 * Lima menit, bukan setahun.
 *
 * Bawaan `ImageResponse` adalah `public, immutable, max-age=31536000` — benar untuk gambar OG
 * statis, salah untuk kartu yang memuat harga hidup: peramban menyimpan kartu pertama yang
 * dilihatnya selama setahun tanpa pernah bertanya lagi, jadi kartu yang pernah salah tetap
 * salah di peramban itu walau servernya sudah diperbaiki.
 */
const CACHE_CONTROL = "public, max-age=300";

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const url = new URL(req.url);
  const chainParam = url.searchParams.get("chain");
  const chainId = chainParam && Number.isFinite(Number(chainParam)) ? Number(chainParam) : null;

  const project = findProject(token, chainId) ?? (chainId !== null ? findProject(token) : null);
  if (!project) {
    return new Response("Market not found.", { status: 404 });
  }

  const chain = resolveChainOrDefault(project.chainId);

  /**
   * Harga USD dari pustaka yang sama dengan `/api/prices`, dengan cache yang sama.
   *
   * Kalau pembacaan gagal, kartunya TIDAK menebak: harga ditulis dalam aset native dan market
   * cap berbunyi apa adanya. Kartu yang diam-diam memakai kurs nol akan mencetak "$0.00" untuk
   * pasar yang hidup, dan itu jenis kesalahan yang paling mungkin dibagikan ke mana-mana.
   */
  let prices: AssetPrices = STABLE_PRICES;
  try {
    const read = await nativePrices();
    prices = { ...STABLE_PRICES, ...read.prices };
  } catch {
    // kurs bawaan dipakai
  }
  const nativeUsd = assetPriceUsd(chain.nativeSymbol, prices);
  /**
   * Harga SPOT kurva sekarang, bukan `project.priceNative`.
   *
   * `priceNative` di registry adalah harga PEMBUKAAN yang ditulis saat peluncuran dan tidak
   * pernah diperbarui, jadi kartu dulu menyebut market cap hari peluncuran untuk pasar yang
   * sudah bergerak. Kalau kurva tidak terbaca, harga pembukaan dipakai sebagai cadangan.
   */
  let priceNative = project.priceNative;
  if (project.poolAddress) {
    const pool = await readPoolState(chain, project.poolAddress);
    if (pool && pool.initialized && pool.spotPriceNative > 0) priceNative = pool.spotPriceNative;
  }
  const priceUsd = priceNative * nativeUsd;
  const mcapUsd = priceUsd * project.supply;

  const marketUrl = `${publicOrigin()}/token/${project.slug}?chain=${project.chainId}`;
  const qr = await QRCode.toDataURL(marketUrl, {
    margin: 1,
    width: 280,
    color: { dark: "#141110", light: CARD_COLORS.cream },
  });

  return new ImageResponse(
    (
      <ShareCard
        mark={brandMark(44)}
        logoSrc={tokenLogoSrc(project.image)}
        symbol={project.symbol}
        title={`$${project.symbol}`}
        subtitle={project.name}
        chainLabel={chainChipLabel(chain.name)}
        stats={[
          // `cardUsd`/`cardNative`, bukan `formatUsd`, untuk angka kecil: notasi subskrip tidak
          // punya glif di font bawaan satori. Alasan lengkapnya di `src/lib/share-card-format.ts`.
          // `formatUsd` ringkas hanya dipakai dari $1 ke atas, di mana ia tidak memakai subskrip.
          {
            label: "market cap",
            value: mcapUsd >= 1 ? formatUsd(mcapUsd, { compact: true }) : mcapUsd > 0 ? cardUsd(mcapUsd) : "not priced yet",
          },
          { label: "price", value: priceUsd > 0 ? cardUsd(priceUsd) : cardNative(priceNative, chain.nativeSymbol) },
        ]}
        note={{ text: "Trading on a curve that has no withdrawal function.", color: CARD_COLORS.creamSoft }}
        marketUrl={marketUrl}
        qr={qr}
        robot={robotImage(300)}
      />
    ),
    { width: 1200, height: 630, headers: { "cache-control": CACHE_CONTROL } }
  );
}
