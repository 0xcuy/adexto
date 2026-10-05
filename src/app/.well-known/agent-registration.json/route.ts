/**
 * Bukti domain ERC-8004 untuk adexto.xyz: `/.well-known/agent-registration.json`.
 *
 * ERC-8004 ("Endpoint Domain Verification") membolehkan agen membuktikan ia menguasai domain
 * sebuah endpoint dengan berkas di path ini yang memuat `registrations` yang cocok dengan agen
 * on-chain. Berkas registrasi agen kami menyebut `https://adexto.xyz` (dan gateway x402 di
 * `x402.adexto.xyz`, yang mencerminkan berkas ini), jadi tanpa berkas ini endpoint-endpoint itu
 * tidak terverifikasi bagi pembaca seperti 8004scan.
 *
 * Isinya dokumen registration-v1 lengkap untuk ADEXTO, dengan `registrations` HANYA untuk agen
 * yang pemiliknya terbukti dompet kami saat ini (dibaca dari Identity Registry). `supportedTrust`
 * sengaja tidak ada: kami belum memakai Reputation maupun Validation Registry, dan ERC-8004
 * menyatakan ketiadaannya berarti "hanya untuk discovery" — klaim yang benar.
 */
import { agentRegistryOf, verifiedOperatedAgents } from "@/lib/agent-identities";

export const dynamic = "force-dynamic";

export async function GET() {
  const agents = await verifiedOperatedAgents();
  const services = [
    { name: "web", endpoint: "https://adexto.xyz/agents" },
    { name: "MCP", endpoint: "https://adexto.xyz/api/mcp", version: "2026-07-28" },
    // Agen A2A "ADEXTO Launchpad" (`src/lib/a2a.ts`): endpoint-nya kartu agen, seperti contoh ERC-8004.
    { name: "A2A", endpoint: "https://adexto.xyz/.well-known/agent-card.json", version: "1.0" },
    { name: "x402", endpoint: "https://x402.adexto.xyz/openapi.json", version: "v1" },
  ];
  const body = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "ADEXTO",
    description:
      "ADEXTO launches bonding-curve token markets on 0G, Base, Arbitrum One, Monad and Robinhood Chain. An agent " +
      "can launch a market with its own key through the MCP server or the A2A agent (the server prepares the transaction; the " +
      "agent signs it), buy any market with USDC on Base over x402 and receive the token on the market's own " +
      "chain, and stake a market's token to ask that market's agent. A launch may bind its token to an ERC-8004 " +
      "agent; the factory checks that the launcher owns it. The registrations below are the agents ADEXTO's own " +
      "wallets hold, each read from the Identity Registry when this file is served.",
    image: "https://adexto.xyz/brand/adexto-512.png",
    services,
    // Ejaan kedua, sama seperti `buildRegistrationFile`: sebagian pembaca memakai `endpoints`.
    endpoints: services,
    x402Support: true,
    active: true,
    registrations: agents.map((a) => ({ agentId: Number(a.agentId), agentRegistry: agentRegistryOf(a.chainId) })),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    },
  });
}
