import { NextResponse } from "next/server";
import { fxSeries } from "@/lib/fx-history";

/**
 * GET /api/fx-history?symbol=0G — kurs native/USD yang PERNAH DIAMATI.
 *
 * Dibaca chart untuk menggambar harga dalam dolar. Yang dikembalikan hanya sampel yang
 * terekam, jadi jendelanya bisa lebih pendek daripada umur pasar — dan itu keadaan yang
 * harus DINYATAKAN chart, bukan ditambal dengan kurs sekarang. Alasan lengkapnya ada di
 * `src/lib/fx-history.ts`.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol") ?? "";
  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  const points = fxSeries(symbol.toUpperCase());
  return NextResponse.json({
    symbol: symbol.toUpperCase(),
    points,
    from: points.length ? points[0][0] : null,
    to: points.length ? points[points.length - 1][0] : null,
    count: points.length,
  });
}
