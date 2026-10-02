import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { programTotals, referrerStats } from "@/lib/referral";
import { REFERRAL_TERMS } from "@/config/growth-programs";

/**
 * `GET /api/referral/stats?address=` — angka referral satu perujuk untuk `/rewards`. Tanpa `address`,
 * hanya total program. Isinya data chain yang memang publik (tx, wallet, volume); estimasi imbalan
 * hanya disertakan bila ketentuan referral sudah dikonfirmasi owner.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  const totals = programTotals();
  if (!address) return NextResponse.json({ program: totals, termsConfirmed: REFERRAL_TERMS.confirmed });
  if (!ethers.isAddress(address)) return NextResponse.json({ error: "Not an address." }, { status: 400 });
  const stats = referrerStats(address);
  const weeks = REFERRAL_TERMS.confirmed ? stats.weeks : stats.weeks.map(({ rewardUsd: _r, meetsMinimum: _m, ...w }) => w);
  return NextResponse.json({ program: totals, termsConfirmed: REFERRAL_TERMS.confirmed, ...stats, weeks }, { headers: { "cache-control": "no-store" } });
}
