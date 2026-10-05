/**
 * Berkas registrasi ERC-8004 untuk agen yang kami operasikan, satu sumber untuk dua alamat:
 *
 *   - `https://adexto.xyz/agents/{chainId}/{agentId}/registration.json` — alamat PERMANEN, yang akan
 *     ditulis on-chain lewat `setAgentURI` (keputusan owner #4). Tanpa `api/` dan tanpa query
 *     string: alamat ini dibekukan di chain, dan mengubahnya berarti satu transaksi lagi per agen,
 *     jadi ia tidak boleh ikut berubah kalau struktur API situs berubah.
 *   - `/api/agents/card?chainId=&agentId=` — alias lama, tetap dijawab dengan isi yang sama.
 *
 * Kenapa berkasnya perlu diganti: berkas on-chain saat ini dibekukan (URI `data:` atau `ipfs://`)
 * dan sudah tertinggal. Agen protokol menunjuk endpoint x402 lama di workers.dev tanpa layanan MCP,
 * agen 10251 masih bernama $CURB yang sudah dicabut padahal tokennya kini $PARCEL, dan ketiga agen
 * SAi tidak punya blok `registrations`. Dengan `agentURI` menunjuk ke sini, isinya bisa dibetulkan
 * kapan saja tanpa transaksi, dan karena URL-nya satu domain dengan endpoint-nya, bukti domain
 * ERC-8004 terpenuhi oleh URI itu sendiri.
 *
 * Hanya agen yang pemiliknya terbukti dompet kami (dibaca dari Identity Registry) yang dijawab.
 */
import { agentOwner, agentRegistryOf, isOurAddress, OPERATED_AGENTS } from "@/lib/agent-identities";
import { LAUNCH_CHAIN_COUNT_WORD, resolveChainOrDefault } from "@/lib/chains";

export const AGENT_CARD_ORIGIN = "https://adexto.xyz";

/** Alamat permanen kartu satu agen. Inilah yang ditulis on-chain. */
export function agentCardUrl(chainId: number, agentId: string): string {
  return `${AGENT_CARD_ORIGIN}/agents/${chainId}/${agentId}/registration.json`;
}

export type AgentCardResult =
  | { ok: true; card: Record<string, unknown> }
  | { ok: false; status: number; error: string; detail: string };

export async function agentCard(chainId: number, agentId: string): Promise<AgentCardResult> {
  const agent = OPERATED_AGENTS.find((a) => a.chainId === Number(chainId) && a.agentId === String(agentId));
  if (!agent) {
    return { ok: false, status: 404, error: "unknown_agent", detail: "Only agents ADEXTO operates have a card here." };
  }
  const owner = await agentOwner(agent.chainId, agent.agentId);
  if (!owner || !isOurAddress(owner)) {
    return {
      ok: false,
      status: 404,
      error: "not_operated",
      detail: "This agent's owner could not be confirmed as an ADEXTO wallet right now.",
    };
  }

  const chain = resolveChainOrDefault(agent.chainId);
  const market = agent.market;
  const slug = market?.symbol.toLowerCase() ?? null;
  const services = [
    { name: "web", endpoint: market ? `${AGENT_CARD_ORIGIN}/token/${slug}?chain=${agent.chainId}` : `${AGENT_CARD_ORIGIN}/agents` },
    { name: "MCP", endpoint: `${AGENT_CARD_ORIGIN}/api/mcp`, version: "2026-07-28" },
    market
      ? { name: "x402", endpoint: `https://x402.adexto.xyz/v1/x402/buy/${slug}?chain=${agent.chainId}`, version: "v1" }
      : { name: "x402", endpoint: "https://x402.adexto.xyz/openapi.json", version: "v1" },
  ];
  const name = agent.cardFace?.name ?? (market ? `${market.symbol} Market Agent` : agent.name);
  const description = market
    ? `Market agent for $${market.symbol} on ${chain.name}, a bonding-curve market launched through ADEXTO. The ` +
      `token contract records this ERC-8004 agent; the launch factory checked that the launcher owned it. Buy ` +
      `$${market.symbol} with USDC on Base over x402 and receive it on ${chain.name}, or use the MCP server. ` +
      `Staking $${market.symbol} opens this agent: it answers questions about the market's curve, fees and depth.`
    : `ADEXTO's protocol agent on ${chain.name}. ADEXTO launches bonding-curve token markets on ${LAUNCH_CHAIN_COUNT_WORD} chains. ` +
      `Through the MCP server an agent can launch a market with its own key, buy any market with USDC on Base ` +
      `over x402, stake a market's token, and collect creator fees.`;

  return {
    ok: true,
    card: {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name,
      description,
      image: `${AGENT_CARD_ORIGIN}${agent.cardFace?.image ?? "/brand/adexto-512.png"}`,
      services,
      // Ejaan kedua, sama seperti `buildRegistrationFile`: sebagian pembaca memakai `endpoints`.
      endpoints: services,
      x402Support: true,
      active: true,
      registrations: [{ agentId: Number(agent.agentId), agentRegistry: agentRegistryOf(agent.chainId) }],
    },
  };
}

/** Respons HTTP yang sama untuk kedua alamat. */
export async function agentCardResponse(chainId: number, agentId: string): Promise<Response> {
  const result = await agentCard(chainId, agentId);
  const headers = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error, detail: result.detail }), {
      status: result.status,
      headers: { ...headers, "cache-control": "no-store" },
    });
  }
  return new Response(JSON.stringify(result.card, null, 2), {
    headers: { ...headers, "cache-control": "public, max-age=300" },
  });
}
