import { NextResponse } from "next/server";
import { getLeaderboard } from "@/lib/leaderboard";
import { publicErrorMessage } from "@/lib/public-error";

/** `GET /api/leaderboard` — data `/leaderboard` dalam JSON (`src/lib/leaderboard.ts`). */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getLeaderboard(), { headers: { "cache-control": "public, max-age=30" } });
  } catch (error: any) {
    return NextResponse.json({ error: publicErrorMessage(error) }, { status: 502 });
  }
}
