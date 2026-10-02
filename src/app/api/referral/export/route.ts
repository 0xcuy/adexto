import { NextResponse } from "next/server";
import { recordedWeeks, weekCsv } from "@/lib/referral";
import { verifyAdmin } from "@/lib/growth-admin";
import { referralExportMessage } from "@/lib/growth-admin-message";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * Ekspor CSV referral mingguan untuk owner yang membayar.
 *
 * `GET` = daftar minggu yang punya catatan (label tanggal saja). `POST { week, issuedAt, signature }`
 * = CSV minggu itu, hanya untuk tanda tangan admin (`src/lib/growth-admin.ts`).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ weeks: recordedWeeks() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const verdict = rateLimit(`referral-export:${clientIp(req)}`, 20, 10 * 60 * 1000);
  if (!verdict.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(verdict) });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const week = String(body?.week ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return NextResponse.json({ error: "week must be YYYY-MM-DD." }, { status: 400 });
  const auth = verifyAdmin(referralExportMessage(week, Number(body?.issuedAt)), body?.signature, body?.issuedAt);
  if (!auth.ok) return NextResponse.json({ code: auth.code, error: auth.error }, { status: auth.status });
  return new Response(weekCsv(week), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="adexto-referrals-${week}.csv"`,
      "cache-control": "no-store",
    },
  });
}
