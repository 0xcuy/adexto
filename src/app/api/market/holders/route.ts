import { NextResponse } from "next/server";
import { findProject } from "@/lib/registry";
import { ensureMarketIndex, indexable } from "@/lib/market-index";
import { computeHolders } from "@/lib/holders";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { publicErrorMessage } from "@/lib/public-error";

/**
 * GET /api/market/holders?symbol=ADEXTO&chainId=16661
 *
 * Jumlah holder, porsi 10 teratas, porsi creator, dan porsi di kurva, dari saldo yang disusun
 * ulang dari seluruh `Transfer` token sejak mint (`src/lib/market-index.ts`).
 *
 * Selama pemindaian awal belum selesai, `complete` false dan angkanya mencakup riwayat sampai
 * `asOfBlock` saja. UI wajib mengatakannya.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const verdict = rateLimit(`market-holders:${clientIp(req)}`, 60, 5 * 60 * 1000);
  if (!verdict.ok) {
    return NextResponse.json({ error: "Too many holder reads from this address." }, { status: 429, headers: rateLimitHeaders(verdict) });
  }
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "").trim();
  const chainIdRaw = searchParams.get("chainId");
  const chainId = chainIdRaw && Number.isFinite(Number(chainIdRaw)) ? Number(chainIdRaw) : null;
  const project = symbol ? findProject(symbol, chainId) : null;
  if (!project) return NextResponse.json({ error: "Market not found." }, { status: 404 });
  if (!indexable(project)) {
    return NextResponse.json({ error: "This market cannot be indexed: its curve or launch block is unknown." }, { status: 422 });
  }

  try {
    const { index, status } = await ensureMarketIndex(project, { waitMs: 8_000 });
    if (!index) {
      return NextResponse.json({ error: "Holder history is not readable yet.", index: status }, { status: 503 });
    }
    const report = computeHolders(index, { symbol: project.symbol, creator: project.creator, status });
    return NextResponse.json(report, { headers: { "cache-control": "no-store", ...rateLimitHeaders(verdict) } });
  } catch (error: any) {
    return NextResponse.json({ error: publicErrorMessage(error) }, { status: 502 });
  }
}
