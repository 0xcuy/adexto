/**
 * `GET /api/agents/card?chainId=<id>&agentId=<id>` — berkas registrasi ERC-8004 yang DIUSULKAN
 * untuk satu agen yang kami operasikan.
 *
 * Berkas registrasi agen kami saat ini dibekukan on-chain (URI `data:` atau `ipfs://`), dan
 * isinya sudah tertinggal: agen protokol menunjuk endpoint x402 lama di workers.dev tanpa layanan
 * MCP, agen 10251 masih bernama $CURB yang sudah dicabut padahal tokennya kini $PARCEL, dan
 * ketiga agen SAi tidak punya blok `registrations`. Mengubahnya butuh satu transaksi
 * `setAgentURI` per agen (keputusan owner #4). Kalau `agentURI` diarahkan ke URL ini, isinya
 * ikut benar tanpa transaksi lagi, dan karena URL-nya di domain yang sama dengan endpoint-nya,
 * bukti domain ERC-8004 sudah terpenuhi oleh URI itu sendiri.
 *
 * Hanya agen yang pemiliknya terbukti dompet kami (dibaca dari Identity Registry) yang dijawab.
 */
import { NextResponse } from "next/server";
import { agentOwner, agentRegistryOf, isOurAddress, OPERATED_AGENTS } from "@/lib/agent-identities";
import { resolveChainOrDefault } from "@/lib/chains";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const chainId = Number(searchParams.get("chainId"));
  const agentId = String(searchParams.get("agentId") ?? "").trim();
  const agent = OPERATED_AGENTS.find((a) => a.chainId === chainId && a.agentId === agentId);
  if (!agent) {
    return NextResponse.json({ error: "unknown_agent", detail: "Only agents ADEXTO operates have a card here." }, { status: 404 });
  }
  const owner = await agentOwner(agent.chainId, agent.agentId);
  if (!owner || !isOurAddress(owner)) {
    return NextResponse.json(
      { error: "not_operated", detail: "This agent's owner could not be confirmed as an ADEXTO wallet right now." },
      { status: 404 }
    );
  }

  const chain = resolveChainOrDefault(agent.chainId);
  const market = agent.market;
  const slug = market?.symbol.toLowerCase() ?? null;
  const services = [
    { name: "web", endpoint: market ? `https://adexto.xyz/token/${slug}?chain=${agent.chainId}` : "https://adexto.xyz/agents" },
    { name: "MCP", endpoint: "https://adexto.xyz/api/mcp", version: "2026-07-28" },
    market
      ? { name: "x402", endpoint: `https://x402.adexto.xyz/v1/x402/buy/${slug}?chain=${agent.chainId}`, version: "v1" }
      : { name: "x402", endpoint: "https://x402.adexto.xyz/openapi.json", version: "v1" },
  ];
  const name = market ? `${market.symbol} Market Agent` : agent.name;
  const description = market
    ? `Market agent for $${market.symbol} on ${chain.name}, a bonding-curve market launched through ADEXTO. The ` +
      `token contract records this ERC-8004 agent; the launch factory checked that the launcher owned it. Buy ` +
      `$${market.symbol} with USDC on Base over x402 and receive it on ${chain.name}, or use the MCP server. ` +
      `Staking $${market.symbol} opens this agent: it answers questions about the market's curve, fees and depth.`
    : `ADEXTO's protocol agent on ${chain.name}. ADEXTO launches bonding-curve token markets on five chains. ` +
      `Through the MCP server an agent can launch a market with its own key, buy any market with USDC on Base ` +
      `over x402, stake a market's token, and collect creator fees.`;

  const card = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name,
    description,
    image: "https://adexto.xyz/brand/adexto-512.png",
    services,
    endpoints: services,
    x402Support: true,
    active: true,
    registrations: [{ agentId: Number(agent.agentId), agentRegistry: agentRegistryOf(agent.chainId) }],
  };
  return NextResponse.json(card, {
    headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  });
}
