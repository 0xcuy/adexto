import { ImageResponse } from "next/og";
import { ethers } from "ethers";
import QRCode from "qrcode";
import { findProject } from "@/lib/registry";
import { readProvider, resolveChainOrDefault } from "@/lib/chains";
import { ERC20_ABI } from "@/lib/dex";
import { STABLE_PRICES, assetPriceUsd, formatTokenAmount } from "@/lib/pricing";
import { cardNative, cardUsd } from "@/lib/share-card-format";
import { robotImage } from "@/lib/share-card-assets";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * Kartu posisi: "i just bought $X", dengan jumlah yang DIBACA DARI CHAIN.
 *
 * KENAPA SALDONYA DIBACA SERVER, BUKAN DIKIRIM KLIEN
 *
 * Jalur termudah adalah menerima jumlahnya sebagai query dan menggambarnya. Itu berarti kartu
 * ini menjadi generator angka bebas: siapa pun bisa membuat gambar bermerek ADEXTO yang
 * menyatakan posisi yang tidak pernah ada, dan gambar itu beredar jauh lebih luas daripada
 * halaman yang bisa membantahnya. Jadi yang diterima hanya ALAMAT, lalu `balanceOf` dibaca dari
 * chain pasar itu. Angka di kartu karena itu bisa diperiksa siapa pun terhadap chain.
 *
 * YANG TIDAK ADA DI KARTU, DAN ITU KEPUTUSAN
 *
 *   - Alamat pemegang. Ia ada di URL karena harus (server perlu tahu saldo siapa), tetapi TIDAK
 *     digambar. Gambar dibagikan ke tempat yang tidak bisa ditarik kembali, dan menempelkan
 *     alamat seseorang di sana menautkan seluruh riwayat on-chain-nya ke akun sosialnya secara
 *     permanen — akibat yang jauh lebih besar daripada manfaat hiasannya.
 *   - PnL dan harga masuk. Kami tidak menyimpan basis biaya per pemegang, jadi setiap angka
 *     untung/rugi di sini akan karangan. Yang ditulis hanya keadaan sekarang.
 *   - Tautan rujukan. Tidak ada program rujukan, jadi tidak ada `?ref=`.
 *
 * Nol saldo dijawab 404, bukan kartu bertuliskan nol: kartu "saya memegang 0" hanya berguna
 * untuk menyesatkan.
 */

export const dynamic = "force-dynamic";

const CHARCOAL = "#17120d";
const PANEL = "#221b15";
const CREAM = "#f7f2e9";
const CREAM_SOFT = "#dbcfbd";
const CREAM_FAINT = "#bdab95";
const VIOLET = "#b193ff";
const OK = "#4ade80";

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req);
  // Setiap permintaan melakukan dua `eth_call` ke RPC publik. Batas ini menjaga RPC kami, bukan
  // rahasia apa pun — tidak ada rahasia di sini.
  const verdict = rateLimit(`share-position:${ip}`, 30, 5 * 60 * 1000);
  if (!verdict.ok) {
    return new Response("Too many position cards from this address.", {
      status: 429,
      headers: rateLimitHeaders(verdict),
    });
  }

  const { token } = await ctx.params;
  const url = new URL(req.url);
  const chainParam = url.searchParams.get("chain");
  const holder = (url.searchParams.get("holder") ?? "").trim();
  const chainId = chainParam && Number.isFinite(Number(chainParam)) ? Number(chainParam) : null;

  if (!ethers.isAddress(holder)) {
    return new Response("A valid holder address is required.", { status: 400 });
  }

  const project = findProject(token, chainId) ?? (chainId !== null ? findProject(token) : null);
  if (!project) return new Response("Market not found.", { status: 404 });

  const chain = resolveChainOrDefault(project.chainId);

  let balance = 0n;
  let decimals = 18;
  try {
    const provider = readProvider(chain);
    const erc20 = new ethers.Contract(project.tokenAddress, ERC20_ABI, provider);
    const [raw, dec] = await Promise.all([erc20.balanceOf(holder), erc20.decimals().catch(() => 18)]);
    balance = BigInt(raw);
    decimals = Number(dec);
  } catch {
    // RPC menolak: lebih baik tidak ada kartu daripada kartu berisi angka yang tidak terbaca.
    return new Response("The chain did not answer, so no position could be read.", { status: 502 });
  }

  if (balance === 0n) {
    return new Response("That address holds none of this token.", { status: 404 });
  }

  const amount = Number(ethers.formatUnits(balance, decimals));

  // Nilai USD dibaca lewat endpoint kurs situs ini. Kalau gagal, nilainya TIDAK dicetak —
  // bukan dicetak sebagai nol.
  let prices = STABLE_PRICES;
  try {
    const res = await fetch(`${url.origin}/api/prices`, { cache: "no-store" });
    const data = await res.json();
    if (data?.prices) prices = { ...STABLE_PRICES, ...data.prices };
  } catch {
    // kurs bawaan
  }
  const nativeUsd = assetPriceUsd(chain.nativeSymbol, prices);
  const valueUsd = amount * project.priceNative * nativeUsd;

  const marketUrl = `${url.origin}/token/${project.slug}?chain=${project.chainId}`;
  const qr = await QRCode.toDataURL(marketUrl, {
    margin: 1,
    width: 240,
    color: { dark: "#141110", light: CREAM },
  });

  // Satori tidak menggambar SVG; bawaan registry `/logo.svg` karena itu jatuh ke monogram.
  const isRaster = project.image.startsWith("data:image/") || /\.(png|jpe?g|webp)$/i.test(project.image);
  const logo = !isRaster
    ? null
    : project.image.startsWith("data:")
    ? project.image
    : `${url.origin}${project.image.startsWith("/") ? "" : "/"}${project.image}`;

  const robot = robotImage(280);

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
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: "560px",
            height: "630px",
            display: "flex",
            background:
              "linear-gradient(270deg, rgba(124,58,237,0.38) 0%, rgba(124,58,237,0.12) 45%, rgba(23,18,13,0) 100%)",
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", padding: "56px", width: "700px" }}>
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
            <div style={{ display: "flex", fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em" }}>
              adexto.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "20px", marginTop: "40px" }}>
            {logo ? (
              <img
                src={logo}
                width={72}
                height={72}
                style={{ borderRadius: "18px", border: `1px solid ${CREAM_FAINT}`, objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  width: "72px",
                  height: "72px",
                  borderRadius: "18px",
                  border: `1px solid ${CREAM_FAINT}`,
                  background: PANEL,
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "32px",
                  fontWeight: 700,
                  color: VIOLET,
                }}
              >
                {project.symbol.slice(0, 2)}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: "44px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
                {`I hold $${project.symbol}`}
              </div>
              <div style={{ display: "flex", fontSize: "20px", color: CREAM_SOFT, marginTop: "8px" }}>
                {project.name}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "34px", marginTop: "44px" }}>
            {[
              ["position", `${formatTokenAmount(amount)} ${project.symbol}`],
              ["value now", valueUsd > 0 ? cardUsd(valueUsd) : cardNative(amount * project.priceNative, chain.nativeSymbol)],
              ["chain", chain.name],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: "15px",
                    color: CREAM_FAINT,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {label}
                </div>
                <div style={{ display: "flex", fontSize: "30px", fontWeight: 600, marginTop: "6px" }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
            <div style={{ display: "flex", fontSize: "18px", color: OK }}>
              Read from the chain, not typed in.
            </div>
            <div style={{ display: "flex", fontSize: "19px", color: VIOLET, marginTop: "8px" }}>
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
            padding: "40px 44px 40px 0",
            width: "500px",
          }}
        >
          <img src={qr} width={132} height={132} style={{ borderRadius: "14px", background: CREAM, padding: "6px" }} />
          {robot ? (
            // Dibaca dari disk dengan lebar DAN tinggi eksplisit. Alasannya di
            // `src/lib/share-card-assets.ts`: mengambilnya lewat URL membuat satori
            // mengukur berkasnya sendiri lewat jaringan, dan itu gagal di produksi.
            <img src={robot.src} width={robot.width} height={robot.height} style={{ objectFit: "contain" }} />
          ) : null}
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
    { width: 1200, height: 630, headers: rateLimitHeaders(verdict) }
  );
}
