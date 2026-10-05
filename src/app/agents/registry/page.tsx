/**
 * /agents/registry — TEKNIS: identitas ERC-8004 yang kami operasikan, dan di mana agen/indexer menemukan ADEXTO.
 *
 * Dipindah dari `/agents` (5 Okt 2026, arahan owner). Pemilik dibaca dari Identity Registry saat render. Teks English.
 */
import type { Metadata } from "next";
import { Bot, Plug } from "lucide-react";
import { agentDirectory } from "@/lib/agent-directory";
import PageHeader from "@/components/ui/PageHeader";
import AgentsNav from "@/components/agents/AgentsNav";
import { MCP_URL, short } from "@/components/agents/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent identities and discovery — ADEXTO",
  description: "The ERC-8004 identities ADEXTO operates, and the machine-readable files agents and indexers use to find ADEXTO.",
};

const DISCOVERY: Array<[string, string]> = [
  ["MCP endpoint (Streamable HTTP)", MCP_URL],
  ["MCP server card", "https://adexto.xyz/.well-known/mcp/server-card.json"],
  ["MCP Registry entry (server.json)", "https://github.com/0xcuy/adexto/blob/main/server.json"],
  ["A2A agent card (A2A 1.0 and 0.3)", "https://adexto.xyz/.well-known/agent-card.json"],
  ["A2A endpoint (JSON-RPC)", "https://adexto.xyz/api/a2a"],
  ["x402 OpenAPI", "https://x402.adexto.xyz/openapi.json"],
  ["x402 resources", "https://x402.adexto.xyz/.well-known/x402"],
  ["ERC-8004 domain file", "https://adexto.xyz/.well-known/agent-registration.json"],
  ["Directory as JSON", "https://adexto.xyz/api/agents"],
];

export default async function AgentRegistryPage() {
  const dir = await agentDirectory();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <AgentsNav current="/agents/registry" />
      <PageHeader
        kicker="Agents · technical"
        kickerIcon={Bot}
        title="Identities and discovery"
        subtitle="The ERC-8004 identities ADEXTO operates, checked on every load, and the files agents and indexers read."
        className="mb-8"
      />

      <section className="section-block mb-4 space-y-4" id="operated">
        <h2 className="text-[20px] font-semibold text-ink tracking-tight">Our own identities</h2>
        <p className="text-[14px] text-ink-soft leading-relaxed">
          Owners are read from the ERC-8004 Identity Registry. The same list, filtered to agents our wallets still own,
          is published at <code className="text-accent">/.well-known/agent-registration.json</code> as the domain proof
          ERC-8004 describes. Each agent&apos;s on-chain agentURI points to its registration file on this site, and
          the card link opens that file. Whoever controls adexto.xyz can update the file; the market a token is bound
          to cannot change.
        </p>
        <div className="overflow-x-auto rounded-card border border-line">
          {/* Sel tidak membungkus: tabel menggulir di dalam kotaknya, bukan memecah nama agen jadi 3 baris. */}
          <table className="w-full text-left text-[12px] [&_td]:whitespace-nowrap">

            <thead className="bg-cream-2 text-[12px] uppercase tracking-wider text-ink-faint">
              <tr>
                <th scope="col" className="px-3 py-2">Agent</th>
                <th scope="col" className="px-3 py-2">Chain</th>
                <th scope="col" className="px-3 py-2">Bound market</th>
                <th scope="col" className="px-3 py-2">Owner</th>
                <th scope="col" className="px-3 py-2">Links</th>
              </tr>
            </thead>
            <tbody>
              {dir.operatedAgents.map((a) => (
                <tr key={`${a.chainId}:${a.agentId}`} className="border-t border-line">
                  <td className="px-3 py-2">
                    <span className="font-mono text-ink">#{a.agentId}</span>
                    <div className="text-ink-faint">{a.name}</div>
                  </td>
                  <td className="px-3 py-2">{a.chain}</td>
                  <td className="px-3 py-2">{a.market ? `$${a.market.symbol}` : "—"}</td>
                  <td className="px-3 py-2">
                    {a.owner ? <span className="font-mono">{short(a.owner)}</span> : <span className="text-ink-faint">not readable</span>}
                    {a.owner && <div className="text-ink-faint">{a.ownedByAdexto ? "ADEXTO wallet" : "not an ADEXTO wallet"}</div>}
                  </td>
                  <td className="px-3 py-2 space-x-3">
                    <a href={a.explorer} className="inline-flex min-h-[36px] items-center text-accent hover:underline" target="_blank" rel="noreferrer">
                      explorer
                    </a>
                    {a.ownedByAdexto && (
                      <a href={a.card} className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center text-accent hover:underline" target="_blank" rel="noreferrer">
                        card
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-block space-y-4" id="discovery">
        <div className="kicker">
          <Plug className="w-4 h-4 text-accent" aria-hidden="true" />
          <span>MACHINE-READABLE</span>
        </div>
        <h2 className="text-[20px] font-semibold text-ink tracking-tight">Where agents and indexers find this</h2>
        <ul className="space-y-1.5 text-[12px] text-ink-soft">
          {DISCOVERY.map(([label, href]) => (
            <li key={label}>
              <span className="text-ink">{label}:</span>{" "}
              <a href={href} className="font-mono text-accent hover:underline break-all">
                {href}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
