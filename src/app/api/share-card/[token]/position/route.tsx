import { ImageResponse } from "next/og";
import { ethers } from "ethers";
import QRCode from "qrcode";
import { findProject } from "@/lib/registry";
import { readProvider, resolveChainOrDefault } from "@/lib/chains";
import { ERC20_ABI } from "@/lib/dex";
import { nativePrices } from "@/lib/native-price";
import { STABLE_PRICES, assetPriceUsd, formatTokenAmount, type AssetPrices } from "@/lib/pricing";
import { cardNative, cardUsd } from "@/lib/share-card-format";
import { brandMark, chainMarkImage, publicOrigin, robotImage, tokenLogoSrc } from "@/lib/share-card-assets";
import { CARD_COLORS, ShareCard, chainChipLabel } from "@/lib/share-card-layout";
import { readPosition } from "@/lib/position-server";
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
 *   - PnL, KECUALI yang bisa dibuktikan. PnL dihitung dari perdagangan alamat itu sendiri lewat
 *     indeks pasar (`src/lib/position-server.ts`), dan hanya digambar bila (1) riwayat sejak
 *     peluncuran sudah terpindai utuh dan (2) seluruh saldonya berasal dari pembelian di kurva.
 *     Token yang masuk lewat transfer tidak punya harga masuk; kartu yang tetap mencetak PnL
 *     untuknya akan mencetak angka karangan dengan merek kami di atasnya.
 *   - Tautan rujukan. Tidak ada program rujukan, jadi tidak ada `?ref=`.
 *
 * Nol saldo dijawab 404, bukan kartu bertuliskan nol: kartu "saya memegang 0" hanya berguna
 * untuk menyesatkan.
 *
 * Alamat, harga, dan gambar diselesaikan di proses ini, bukan lewat jaringan ke situs sendiri.
 * Alasannya ada di `src/lib/share-card-assets.ts`.
 */

export const dynamic = "force-dynamic";

/**
 * Tidak disimpan sama sekali. Saldo berubah setiap kali pemegangnya berdagang, dan bawaan
 * `ImageResponse` (`immutable`, setahun) akan membuat peramban menunjukkan saldo kartu pertama
 * selamanya. Batas laju di bawah sudah menjaga RPC dari permintaan berulang.
 */
const CACHE_CONTROL = "no-store";

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

  // Kurs dari pustaka yang sama dengan `/api/prices`. Kalau gagal, nilai USD TIDAK dicetak —
  // nilainya ditulis dalam aset native, bukan dicetak sebagai nol.
  let prices: AssetPrices = STABLE_PRICES;
  try {
    const read = await nativePrices();
    prices = { ...STABLE_PRICES, ...read.prices };
  } catch {
    // kurs bawaan
  }
  const nativeUsd = assetPriceUsd(chain.nativeSymbol, prices);

  /**
   * Nilai dan PnL dari laporan posisi yang sama dengan panel "Your position".
   *
   * Nilai dulu dihitung dari `project.priceNative` — harga PEMBUKAAN kurva di registry, yang
   * tidak pernah diperbarui — jadi kartu posisi menilai saldo dengan harga hari peluncuran.
   * Laporan posisi membaca harga spot kurva sekarang.
   */
  let report: Awaited<ReturnType<typeof readPosition>> = null;
  try {
    report = await readPosition(project, holder, { waitMs: 6_000 });
  } catch {
    report = null;
  }
  const spotNative = report && report.spotNative > 0 ? report.spotNative : project.priceNative;
  const valueNative = amount * spotNative;
  const valueUsd = valueNative * nativeUsd;
  const pos = report?.position;
  const provable = Boolean(report?.complete && pos && pos.buys > 0 && pos.untrackedTokens === 0 && pos.unrealizedNative !== null);
  const pnlUsd = provable && pos!.unrealizedUsd !== null ? pos!.unrealizedUsd : null;
  const pnlNative = provable ? pos!.unrealizedNative! : null;
  const pnlPct = provable ? (pos!.unrealizedPctUsd ?? pos!.unrealizedPct) : null;
  const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
  // `cardUsd`/`cardNative` menjawab "—" untuk nol; PnL nol adalah angka, bukan ketiadaan.
  const usdAbs = (v: number) => (Math.abs(v) > 0 ? cardUsd(Math.abs(v)) : "$0.00");
  const nativeAbs = (v: number) => (Math.abs(v) > 0 ? cardNative(Math.abs(v), chain.nativeSymbol) : `0 ${chain.nativeSymbol}`);
  const pnlText =
    pnlNative === null
      ? null
      : `${pnlUsd !== null ? `${sign(pnlUsd)}${usdAbs(pnlUsd)}` : `${sign(pnlNative)}${nativeAbs(pnlNative)}`}${
          pnlPct !== null ? ` (${sign(pnlPct)}${Math.abs(pnlPct).toFixed(2)}%)` : ""
        }`;
  const pnlTone = (pnlUsd ?? pnlNative ?? 0) >= 0 ? ("up" as const) : ("down" as const);

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
        title={`I hold $${project.symbol}`}
        subtitle={project.name}
        chainLabel={chainChipLabel(chain.name)}
        chainMark={chainMarkImage(chain, 24)}
        stats={[
          {
            label: "value now",
            value: valueUsd > 0 ? cardUsd(valueUsd) : cardNative(valueNative, chain.nativeSymbol),
          },
          { label: "position", value: `${formatTokenAmount(amount)} ${project.symbol}` },
          ...(pnlText ? [{ label: "pnl", value: pnlText, tone: pnlTone }] : []),
        ]}
        note={{ text: "Read from the chain, not typed in.", color: CARD_COLORS.ok }}
        marketUrl={marketUrl}
        qr={qr}
        robot={robotImage(300)}
      />
    ),
    {
      width: 1200,
      height: 630,
      headers: { ...rateLimitHeaders(verdict), "cache-control": CACHE_CONTROL },
    }
  );
}
