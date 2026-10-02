/**
 * `GET /agents/{chainId}/{agentId}/registration.json` — alamat permanen berkas registrasi ERC-8004
 * satu agen yang kami operasikan. Alamat inilah yang akan ditulis on-chain dengan `setAgentURI`,
 * jadi bentuk path-nya tidak boleh diubah. Isinya: `src/lib/agent-card.ts`.
 */
import { agentCardResponse } from "@/lib/agent-card";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ chainId: string; agentId: string }> }) {
  const { chainId, agentId } = await params;
  if (!/^\d{1,9}$/.test(chainId) || !/^\d{1,78}$/.test(agentId)) {
    return new Response(JSON.stringify({ error: "bad_request", detail: "chainId and agentId are decimal numbers." }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return agentCardResponse(Number(chainId), agentId);
}
