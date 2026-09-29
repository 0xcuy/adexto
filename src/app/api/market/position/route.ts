import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { findProject } from "@/lib/registry";
import { readPosition } from "@/lib/position-server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * GET /api/market/position?symbol=ADEXTO&chainId=16661&wallet=0x…
 *
 * Posisi sebuah dompet di satu pasar: saldo, harga masuk rata-rata, modal, PnL terealisasi dan
 * belum terealisasi — semuanya dari perdagangan dompet itu sendiri di chain, lewat indeks pasar.
 *
 * Tidak ada yang rahasia di sini: saldo dan perdagangan sebuah alamat publik di chain. Batas laju
 * menjaga RPC kami, karena setiap permintaan membaca saldo dan keadaan kurva.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const verdict = rateLimit(`market-position:${clientIp(req)}`, 60, 5 * 60 * 1000);
  if (!verdict.ok) {
    return NextResponse.json({ error: "Too many position reads from this address." }, { status: 429, headers: rateLimitHeaders(verdict) });
  }

  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "").trim();
  const chainIdRaw = searchParams.get("chainId");
  const chainId = chainIdRaw && Number.isFinite(Number(chainIdRaw)) ? Number(chainIdRaw) : null;
  const wallet = (searchParams.get("wallet") || "").trim();

  if (!ethers.isAddress(wallet)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400 });
  }
  const project = symbol ? findProject(symbol, chainId) : null;
  if (!project) return NextResponse.json({ error: "Market not found." }, { status: 404 });

  try {
    const report = await readPosition(project, wallet);
    if (!report) {
      return NextResponse.json({ error: "This market cannot be indexed: its curve or launch block is unknown." }, { status: 422 });
    }
    return NextResponse.json(report, { headers: { "cache-control": "no-store", ...rateLimitHeaders(verdict) } });
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message ?? error).slice(0, 200) }, { status: 502 });
  }
}
