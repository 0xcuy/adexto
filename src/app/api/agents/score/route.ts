/**
 * `GET /api/agents/score?chainId=<id>&token=<address>` — Agent Score satu pasar.
 *
 * Antarmuka bersama (README rencana §4): dipakai halaman token dan leaderboard milik Plan 2 lewat
 * `src/components/agents/AgentScoreBadge.tsx`. Bentuk minimum yang dijanjikan:
 * `{ score, factors[], computedAt }`; field lain hanya tambahan.
 */
import { NextResponse } from "next/server";
import { computeAgentScore, findMarket, SCORE_METHOD } from "@/lib/agent-score";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = rateLimit(`agents-score:${clientIp(req)}`, 120, 5 * 60_000);
  if (!gate.ok) {
    return NextResponse.json({ error: "rate_limited", retryAfter: gate.retryAfter }, { status: 429, headers: rateLimitHeaders(gate) });
  }
  const { searchParams } = new URL(req.url);
  const chainId = Number(searchParams.get("chainId"));
  const token = String(searchParams.get("token") ?? "").trim();
  if (!Number.isInteger(chainId) || chainId <= 0 || !/^0x[a-fA-F0-9]{40}$/.test(token)) {
    return NextResponse.json(
      { error: "bad_request", detail: "Pass chainId (a positive integer) and token (a 20-byte hex address)." },
      { status: 400 }
    );
  }
  const market = findMarket(chainId, token);
  if (!market) {
    return NextResponse.json({ error: "unknown_market", detail: "No market with that token on that chain is listed here." }, { status: 404 });
  }
  const s = await computeAgentScore(market);
  return NextResponse.json(
    {
      score: s.score,
      max: s.max,
      factors: s.factors,
      computedAt: s.computedAt,
      complete: s.complete,
      symbol: s.symbol,
      chainId: s.chainId,
      token: s.token,
      agent: s.agent,
      evidence: s.evidence,
      method: SCORE_METHOD,
    },
    { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } }
  );
}
