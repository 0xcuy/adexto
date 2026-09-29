import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { findProject } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";
import { STABLE_PRICES, assetPriceUsd, formatUsd } from "@/lib/pricing";
import { cardNative, cardUsd } from "@/lib/share-card-format";

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
 * saat kartu dibuat: harga, kapitalisasi, chain.
 *
 * `runtime` dibiarkan Node (bawaan) karena registry membaca berkas dari disk.
 */

export const dynamic = "force-dynamic";

const CHARCOAL = "#17120d";
const PANEL = "#221b15";
const CREAM = "#f7f2e9";
const CREAM_SOFT = "#dbcfbd";
const CREAM_FAINT = "#bdab95";
const VIOLET = "#b193ff";

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
   * Harga USD dibaca lewat endpoint kurs milik situs ini, bukan dari pihak ketiga langsung.
   *
   * Kalau pembacaan itu gagal, kartunya TIDAK menebak: baris harga berbunyi apa adanya.
   * Kartu yang diam-diam memakai kurs nol akan mencetak "$0.00" untuk pasar yang hidup, dan
   * itu jenis kesalahan yang paling mungkin dibagikan ke mana-mana.
   */
  let prices = STABLE_PRICES;
  try {
    const res = await fetch(`${url.origin}/api/prices`, { cache: "no-store" });
    const data = await res.json();
    if (data?.prices) prices = { ...STABLE_PRICES, ...data.prices };
  } catch {
    // kurs bawaan dipakai
  }
  const nativeUsd = assetPriceUsd(chain.nativeSymbol, prices);
  const priceUsd = project.priceNative * nativeUsd;
  const mcapUsd = priceUsd * project.supply;

  const marketUrl = `${url.origin}/token/${project.slug}?chain=${project.chainId}`;
  const qr = await QRCode.toDataURL(marketUrl, {
    margin: 1,
    width: 240,
    color: { dark: "#141110", light: "#f7f2e9" },
  });

  /**
   * Satori hanya menggambar raster (PNG/JPEG/WebP), bukan SVG.
   *
   * Bawaan registry adalah `/logo.svg`, jadi tanpa cabang ini setiap pasar yang belum
   * memilih gambar akan tampil dengan kotak KOSONG di kartunya — persis di gambar yang
   * dibagikan ke luar. Kalau gambarnya bukan raster, dipakai monogram ticker.
   */
  const isRaster = project.image.startsWith("data:image/") || /\.(png|jpe?g|webp)$/i.test(project.image);
  const logo = !isRaster
    ? null
    : project.image.startsWith("data:")
    ? project.image
    : `${url.origin}${project.image.startsWith("/") ? "" : "/"}${project.image}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          background: CHARCOAL,
          color: CREAM,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/*
          Cahaya violet di kanan.
          Bukan radial-gradient: satori merendernya sebagai cakram bertepi keras, yang di
          kartu terlihat seperti bulatan ungu pekat alih-alih cahaya. Gradien linear
          didukung penuh, jadi itu yang dipakai.
        */}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: "560px",
            height: "630px",
            display: "flex",
            background: "linear-gradient(270deg, rgba(124,58,237,0.38) 0%, rgba(124,58,237,0.12) 45%, rgba(23,18,13,0) 100%)",
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", padding: "56px", width: "760px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                display: "flex",
                width: "34px",
                height: "34px",
                borderRadius: "10px",
                background: VIOLET,
                color: CHARCOAL,
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
                fontWeight: 700,
              }}
            >
              A
            </div>
            <div style={{ display: "flex", fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em" }}>adexto.</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "20px", marginTop: "44px" }}>
            {logo ? (
              <img
                src={logo}
                width={88}
                height={88}
                style={{ borderRadius: "22px", border: `1px solid ${CREAM_FAINT}`, objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  width: "88px",
                  height: "88px",
                  borderRadius: "22px",
                  border: `1px solid ${CREAM_FAINT}`,
                  background: PANEL,
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "40px",
                  fontWeight: 700,
                  color: VIOLET,
                }}
              >
                {project.symbol.slice(0, 2)}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: "58px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>
                {`$${project.symbol}`}
              </div>
              <div style={{ display: "flex", fontSize: "22px", color: CREAM_SOFT, marginTop: "8px" }}>{project.name}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "40px", marginTop: "48px" }}>
            {[
              // `cardUsd`/`cardNative`, bukan `formatUsd`: notasi subskrip tidak punya glif di
              // font bawaan satori. Alasan lengkapnya di `src/lib/share-card-format.ts`.
              ["price", priceUsd > 0 ? cardUsd(priceUsd) : cardNative(project.priceNative, chain.nativeSymbol)],
              ["market cap", mcapUsd > 0 ? formatUsd(mcapUsd, { compact: true }) : "not priced yet"],
              ["chain", chain.name],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontSize: "16px", color: CREAM_FAINT, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  {label}
                </div>
                <div style={{ display: "flex", fontSize: "34px", fontWeight: 600, marginTop: "6px" }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
            <div style={{ display: "flex", fontSize: "20px", color: CREAM_SOFT }}>
              Trading on a curve that has no withdrawal function.
            </div>
            <div style={{ display: "flex", fontSize: "20px", color: VIOLET, marginTop: "8px" }}>
              {marketUrl.replace(/^https?:\/\//, "")}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            justifyContent: "space-between",
            padding: "48px 48px 48px 0",
            width: "440px",
          }}
        >
          <img src={qr} width={132} height={132} style={{ borderRadius: "14px", background: CREAM, padding: "6px" }} />
          <img src={`${url.origin}/share/robot-celebrate.png`} height={330} style={{ objectFit: "contain" }} />
        </div>

        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: "1200px",
            height: "6px",
            background: PANEL,
            display: "flex",
          }}
        />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
