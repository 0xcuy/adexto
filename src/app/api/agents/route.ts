/**
 * `GET /api/agents` — direktori yang sama dengan halaman /agents, dalam JSON.
 *
 * Dibatasi lajunya per IP karena setiap panggilan bisa memicu pembacaan chain untuk setiap pasar
 * (hasilnya di-cache, tetapi cache-nya pendek supaya skor tidak basi).
 */
import { NextResponse } from "next/server";
import { agentDirectory } from "@/lib/agent-directory";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = rateLimit(`agents-directory:${clientIp(req)}`, 60, 5 * 60_000);
  if (!gate.ok) {
    return NextResponse.json({ error: "rate_limited", retryAfter: gate.retryAfter }, { status: 429, headers: rateLimitHeaders(gate) });
  }
  const directory = await agentDirectory();
  return NextResponse.json(directory, { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } });
}
