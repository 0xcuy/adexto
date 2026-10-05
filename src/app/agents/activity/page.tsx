/**
 * /agents/activity — FEED: swap terbaru di pasar yang terikat ke agen.
 *
 * Dipindah dari `/agents` (5 Okt 2026, arahan owner). Data dari `agentDirectory()` saat render. Teks English.
 */
import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { agentDirectory } from "@/lib/agent-directory";
import PageHeader from "@/components/ui/PageHeader";
import AgentsNav from "@/components/agents/AgentsNav";
import { fmt, short, when } from "@/components/agents/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent market activity — ADEXTO",
  description: "The latest swaps on ADEXTO markets bound to an ERC-8004 agent, including x402 deliveries.",
};

export default async function AgentActivityPage() {
  const dir = await agentDirectory();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <AgentsNav current="/agents/activity" />
      <PageHeader
        kicker="Agents · activity"
        kickerIcon={Activity}
        title="Latest swaps on agent-bound markets"
        subtitle="Read from the chain when this page loads. An x402 delivery is a buy paid in USDC on Base and delivered on the market's chain."
        className="mb-8"
      />
      <section className="section-block space-y-4" id="activity">
        {dir.activity.length === 0 ? (
          <p className="text-[14px] text-ink-soft">No swaps indexed yet on these markets.</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line">
            {/* Sel tidak membungkus: tabel menggulir di dalam kotaknya, bukan memecah label jadi 3 baris. */}
            <table className="w-full text-left text-[12px] [&_td]:whitespace-nowrap">

              <thead className="bg-cream-2 text-[12px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th scope="col" className="px-3 py-2">Time</th>
                  <th scope="col" className="px-3 py-2">Market</th>
                  <th scope="col" className="px-3 py-2">Side</th>
                  <th scope="col" className="px-3 py-2">Route</th>
                  <th scope="col" className="px-3 py-2">Wallet</th>
                  <th scope="col" className="px-3 py-2">Amount</th>
                  <th scope="col" className="px-3 py-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {dir.activity.map((r) => (
                  <tr key={`${r.chainId}:${r.txHash}:${r.side}`} className="border-t border-line">
                    <td className="px-3 py-2 whitespace-nowrap text-ink-faint">{when(r.time)}</td>
                    <td className="px-3 py-2">
                      ${r.symbol} <span className="text-ink-faint">{r.chain}</span>
                    </td>
                    <td className="px-3 py-2">{r.side}</td>
                    <td className="px-3 py-2">{r.via === "x402" ? "x402 delivery" : "direct"}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono">{short(r.wallet)}</span>
                      {r.walletIsAdexto && <span className="text-ink-faint"> · ADEXTO wallet</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" data-numeric>
                      {fmt(r.amountToken, 0)} ${r.symbol} · {fmt(r.amountNative, 6)} {r.nativeSymbol}
                    </td>
                    <td className="px-3 py-2">
                      <a href={r.explorerTx} className="font-mono text-accent hover:underline" target="_blank" rel="noreferrer">
                        {short(r.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
