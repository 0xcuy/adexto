/**
 * /agents/markets — DATA: setiap pasar yang terikat ke agen ERC-8004, beserta Agent Score-nya.
 *
 * Dipindah dari `/agents` (5 Okt 2026, arahan owner): halaman itu sekarang hanya untuk meluncurkan.
 * Semua angka dari `agentDirectory()` saat render; tidak ada yang ditulis tangan. Teks English.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { Compass, ListChecks } from "lucide-react";
import { agentDirectory } from "@/lib/agent-directory";
import { OUR_ADDRESSES } from "@/lib/agent-identities";
import { explorerAddressUrl } from "@/lib/chains";
import PageHeader from "@/components/ui/PageHeader";
import AgentsNav from "@/components/agents/AgentsNav";
import { short, WEIGHTS } from "@/components/agents/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent markets — ADEXTO",
  description: "Every ADEXTO market bound to an ERC-8004 agent, with an Agent Score read from the chain.",
};

export default async function AgentMarketsPage() {
  const dir = await agentDirectory();
  const outsideTraders = dir.markets.reduce((s, m) => s + m.evidence.outsideTraders, 0);
  const outsideDeliveries = dir.markets.reduce((s, m) => s + m.evidence.x402DeliveriesOutside, 0);
  const operated = dir.operatedAgents.filter((a) => a.ownedByAdexto).length;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <AgentsNav current="/agents/markets" />
      <PageHeader
        kicker="Agents · data"
        kickerIcon={Compass}
        title="Markets bound to an ERC-8004 agent"
        subtitle={
          <>
            The binding is read from each token contract, where it is immutable. A market anyone launches with an agent
            appears here as soon as it is listed. ADEXTO&apos;s own wallets are excluded from every outside count.
          </>
        }
        className="mb-8"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-10" data-testid="agents-stats">
        {[
          ["Markets bound to an agent", String(dir.markets.length)],
          ["Outside traders on them", String(outsideTraders)],
          ["x402 deliveries to outside wallets", String(outsideDeliveries)],
          ["Agents ADEXTO operates", String(operated)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-card border border-line bg-cream-2 p-4">
            <div className="text-[12px]/snug text-ink-faint">{label}</div>
            <div className="mt-1 text-[28px] font-semibold text-ink" data-numeric>
              {value}
            </div>
          </div>
        ))}
      </div>

      <section className="section-block mb-4 space-y-4" id="directory">
        {dir.markets.length === 0 ? (
          <p className="text-[14px] text-ink-soft">No listed market is bound to an agent yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line">
            {/* Sel tidak membungkus: tabel menggulir di dalam kotaknya, bukan memecah label jadi 3 baris. */}
            <table className="w-full text-left text-[12px] [&_td]:whitespace-nowrap">

              <thead className="bg-cream-2 text-[12px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th scope="col" className="px-3 py-2">Market</th>
                  <th scope="col" className="px-3 py-2">Agent</th>
                  <th scope="col" className="px-3 py-2">Creator</th>
                  <th scope="col" className="px-3 py-2">Agent Score</th>
                  <th scope="col" className="px-3 py-2">Outside traders</th>
                  <th scope="col" className="px-3 py-2">x402 deliveries</th>
                  <th scope="col" className="px-3 py-2">Swaps indexed</th>
                </tr>
              </thead>
              <tbody>
                {dir.markets.map((m) => (
                  <tr key={`${m.chainId}:${m.token}`} className="border-t border-line align-top">
                    <td className="px-3 py-2">
                      <Link href={`/token/${m.symbol.toLowerCase()}?chain=${m.chainId}`} className="font-semibold text-ink hover:text-accent">
                        ${m.symbol}
                      </Link>
                      <div className="text-ink-faint">{m.chain}</div>
                    </td>
                    <td className="px-3 py-2 font-mono">{m.agent ? `#${m.agent.agentId}` : "—"}</td>
                    <td className="px-3 py-2">
                      <a href={explorerAddressUrl(m.chainId, m.creator)} className="font-mono hover:text-accent" target="_blank" rel="noreferrer">
                        {short(m.creator)}
                      </a>
                      {m.creatorIsAdexto && <div className="text-ink-faint">ADEXTO wallet</div>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[14px] font-semibold text-ink" data-numeric>{m.score}</span>
                      <span className="text-ink-faint">/100</span>
                      <div className="text-ink-faint">
                        {m.factors.filter((f) => f.points > 0).map((f) => `${f.label} ${f.points}`).join(" · ") || "no points yet"}
                      </div>
                    </td>
                    <td className="px-3 py-2" data-numeric>{m.evidence.outsideTraders}</td>
                    <td className="px-3 py-2">
                      <span data-numeric>{m.evidence.x402DeliveriesOutside}</span>
                      <span className="text-ink-faint"> outside / {m.evidence.x402Deliveries} total</span>
                    </td>
                    <td className="px-3 py-2">
                      <span data-numeric>{m.evidence.swaps}</span>
                      {!m.complete && <div className="text-ink-faint">index catching up</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {dir.unreadable.length > 0 && (
          <p className="text-[12px] text-ink-faint">
            Binding not readable right now for {dir.unreadable.map((u) => `$${u.symbol} (${u.chainId})`).join(", ")}; they are
            left out rather than guessed.
          </p>
        )}
      </section>

      <section className="section-block mb-4 space-y-4" id="score">
        <div className="kicker">
          <ListChecks className="w-4 h-4 text-accent" aria-hidden="true" />
          <span>AGENT SCORE</span>
        </div>
        <h2 className="text-[20px] font-semibold text-ink tracking-tight">How the score is computed</h2>
        <p className="text-[14px] text-ink-soft leading-relaxed">
          0 to 100, from on-chain evidence only. It measures adoption and launch facts, not quality, and it is not
          investment advice. The same numbers are at{" "}
          <code className="text-accent">GET /api/agents/score?chainId=&lt;id&gt;&amp;token=&lt;address&gt;</code>.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {WEIGHTS.map(([label, max, rule]) => (
            <li key={label} className="rounded-lg border border-line bg-cream-2 p-3 text-[12px] text-ink-soft">
              <span className="font-semibold text-ink">{label}</span> <span className="text-ink-faint">up to {max}</span>
              <div className="mt-0.5">{rule}</div>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-ink-faint">
          Excluded as ADEXTO wallets: deployer {short(OUR_ADDRESSES.deployer)}, demo creator {short(OUR_ADDRESSES.agentA)}, demo
          buyer {short(OUR_ADDRESSES.agentB)}, x402 relayer {short(OUR_ADDRESSES.relayer)}, treasury {short(OUR_ADDRESSES.treasury)}.
        </p>
        <p className="text-[12px] text-ink-faint">Directory generated {dir.generatedAt.slice(0, 19).replace("T", " ")} UTC.</p>
      </section>
    </div>
  );
}
