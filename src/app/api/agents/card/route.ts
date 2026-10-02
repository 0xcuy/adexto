/**
 * `GET /api/agents/card?chainId=<id>&agentId=<id>` — alias lama dari alamat permanen
 * `/agents/{chainId}/{agentId}/registration.json`. Isinya dibangun di `src/lib/agent-card.ts`, jadi
 * kedua alamat tidak bisa berbeda.
 */
import { agentCardResponse } from "@/lib/agent-card";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return agentCardResponse(Number(searchParams.get("chainId")), String(searchParams.get("agentId") ?? "").trim());
}
