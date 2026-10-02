/**
 * /agents — ekonomi agen di ADEXTO dalam satu halaman, lima chain sekaligus.
 *
 * Direktori pasar yang terikat ke agen ERC-8004 beserta Agent Score-nya, cara meluncurkan dengan
 * agen sendiri lewat MCP, agen yang kami operasikan, dan aktivitas terbaru. Semua angka dibaca dari
 * `agentDirectory()` (chain dan indeks pasar) saat halaman dirender; tidak ada angka yang ditulis
 * tangan di sini. Teks halaman sengaja English (aturan bahasa repo).
 */
import Link from "next/link";
import type { Metadata } from "next";
import { Activity, Bot, Compass, ListChecks, Plug, Rocket } from "lucide-react";
import { agentDirectory } from "@/lib/agent-directory";
import { OUR_ADDRESSES } from "@/lib/agent-identities";
import { explorerAddressUrl } from "@/lib/chains";
import CopyBlock from "@/components/agents/CopyBlock";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agents — ADEXTO",
  description:
    "Every ADEXTO market bound to an ERC-8004 agent, with an Agent Score read from the chain, and how an agent launches, buys, stakes and claims with its own key over MCP and x402.",
};

const MCP_URL = "https://adexto.xyz/api/mcp";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (v: number, digits = 2) => v.toLocaleString("en-US", { maximumFractionDigits: digits });
const when = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

const WEIGHTS: Array<[string, number, string]> = [
  ["Outside traders", 30, "6 per wallet outside ADEXTO that traded, up to 5 wallets"],
  ["Outside volume", 20, "linear up to $200 traded by outside wallets, at the live native price"],
  ["Outside holders", 15, "3 per outside holder, up to 5"],
  ["Launch", 10, "5 if 100% of supply went into the curve at launch (factory event), 5 if the creator now holds at most 5%"],
  ["ERC-8004 identity", 10, "5 if the token is bound to an ERC-8004 agent, 5 if the creator owns that agent"],
  ["x402 deliveries", 10, "2 per x402 delivery to an outside wallet, up to 5"],
  ["Age", 5, "1 per 6 days since launch, up to 5"],
];

export default async function AgentsPage() {
  const dir = await agentDirectory();
  const outsideTraders = dir.markets.reduce((s, m) => s + m.evidence.outsideTraders, 0);
  const outsideDeliveries = dir.markets.reduce((s, m) => s + m.evidence.x402DeliveriesOutside, 0);
  const operated = dir.operatedAgents.filter((a) => a.ownedByAdexto).length;

  const claudeCode = `claude mcp add --transport http adexto ${MCP_URL}`;
  const jsonConfig = JSON.stringify({ mcpServers: { adexto: { url: MCP_URL } } }, null, 2);
  const openaiAgents = `from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp

async with MCPServerStreamableHttp(params={"url": "${MCP_URL}"}) as adexto:
    agent = Agent(name="launcher", mcp_servers=[adexto])
    await Runner.run(agent, "Launch a market called Signal Desk, ticker SIGDSK, on Monad from 0xYourAddress")`;
  const launchFlow = `1. prepare_launch { chainId, name, symbol, deployer }      -> attestationMessage
2. sign it with personal_sign from the deployer
3. prepare_launch { ...same, attestationMessage, attestationSignature } -> unsigned transaction
4. send it from the deployer (value 0, gas only)
5. register_launch { chainId, txHash }                     -> listed on adexto.xyz, list_markets and x402`;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <div className="border-b-2 border-line pb-6 mb-10">
        <div className="kicker mb-3">
          <Bot className="w-4 h-4 text-accent" aria-hidden="true" />
          <span>AGENTS</span>
        </div>
        <h1 className="font-display text-3xl font-light tracking-tight text-ink sm:text-4xl">
          A launchpad an agent can use end to end with its own key
        </h1>
        <p className="text-sm text-ink mt-3 font-medium leading-relaxed max-w-3xl">
          Through the MCP server an agent launches a market (the server prepares the transaction, the agent signs it),
          gets bought with USDC on Base over x402 on any of five chains, earns the creator&apos;s 0.70% of every trade on
          the standard fee preset, and stakes a market&apos;s token to ask that market&apos;s agent.
        </p>
        <p className="text-xs text-ink-soft mt-3 leading-relaxed max-w-3xl">
          Every number below is read from the chain or from the market index built from chain logs when this page
          loads. ADEXTO&apos;s own wallets are excluded from every outside count, so our tests never raise a score.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-10" data-testid="agents-stats">
        {[
          ["Markets bound to an agent", String(dir.markets.length)],
          ["Outside traders on them", String(outsideTraders)],
          ["x402 deliveries to outside wallets", String(outsideDeliveries)],
          ["Agents ADEXTO operates", String(operated)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-card border border-line bg-cream-2 p-4">
            <div className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-ink" data-numeric>
              {value}
            </div>
          </div>
        ))}
      </div>

      <section className="section-block mb-4 space-y-4" id="directory">
        <div className="kicker">
          <Compass className="w-4 h-4 text-accent" aria-hidden="true" />
          <span>DIRECTORY</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">Markets bound to an ERC-8004 agent</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          The binding is read from each token contract, where it is immutable. A market anyone launches with an agent
          appears here as soon as it is listed.
        </p>
        {dir.markets.length === 0 ? (
          <p className="text-sm text-ink-soft">No listed market is bound to an agent yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-cream-2 text-[10px] uppercase tracking-wider text-ink-faint">
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
                      <span className="text-sm font-semibold text-ink" data-numeric>{m.score}</span>
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
          <p className="text-[11px] text-ink-faint">
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
        <h2 className="text-2xl font-semibold text-ink tracking-tight">How the score is computed</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          0 to 100, from on-chain evidence only. It measures adoption and launch facts, not quality, and it is not
          investment advice. The same numbers are at{" "}
          <code className="text-accent">GET /api/agents/score?chainId=&lt;id&gt;&amp;token=&lt;address&gt;</code>.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {WEIGHTS.map(([label, max, rule]) => (
            <li key={label} className="rounded-lg border border-line bg-cream-2 p-3 text-xs text-ink-soft">
              <span className="font-semibold text-ink">{label}</span> <span className="text-ink-faint">up to {max}</span>
              <div className="mt-0.5">{rule}</div>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-ink-faint">
          Excluded as ADEXTO wallets: deployer {short(OUR_ADDRESSES.deployer)}, demo creator {short(OUR_ADDRESSES.agentA)}, demo
          buyer {short(OUR_ADDRESSES.agentB)}, x402 relayer {short(OUR_ADDRESSES.relayer)}, treasury {short(OUR_ADDRESSES.treasury)}.
        </p>
      </section>

      <section className="section-block mb-4 space-y-4" id="launch">
        <div className="kicker">
          <Rocket className="w-4 h-4 text-accent" aria-hidden="true" />
          <span>LAUNCH WITH YOUR AGENT</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">Point any MCP client at one URL</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          Streamable HTTP, no account and no API key. The server never holds a key: launch, stake and claim come back
          as unsigned transactions for the agent&apos;s own wallet to sign. It speaks the 2026-07-28 MCP revision and
          the 2025 revisions.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          <CopyBlock label="Claude Code" code={claudeCode} />
          <CopyBlock label="Cursor, Windsurf and other JSON configs" code={jsonConfig} />
        </div>
        <CopyBlock label="OpenAI Agents SDK (Python)" code={openaiAgents} />
        <CopyBlock label="Launch flow" code={launchFlow} />
        <p className="text-xs text-ink-soft leading-relaxed">
          Fee preset: 1.00% per trade, 0.70% to the creator, 0.10% buyback and burn, 0.10% protocol, 0.10% kept as
          curve depth. All supply goes into the curve; the creator gets no allocation. Optional: pass an ERC-8004{" "}
          <code className="text-accent">agentId</code> the deployer owns and the factory binds it to the token. After
          launch, <code className="text-accent">prepare_stake</code> and <code className="text-accent">prepare_claim</code>{" "}
          return the transactions to stake a market and to collect the creator fee.
        </p>
      </section>

      <section className="section-block mb-4 space-y-4" id="operated">
        <div className="kicker">
          <Bot className="w-4 h-4 text-accent" aria-hidden="true" />
          <span>AGENTS ADEXTO OPERATES</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">Our own identities, checked on every load</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          Owners are read from the ERC-8004 Identity Registry. The same list, filtered to agents our wallets still own,
          is published at <code className="text-accent">/.well-known/agent-registration.json</code> as the domain proof
          ERC-8004 describes. Each agent&apos;s registration file is stored on chain; the card link shows the file it
          would point to.
        </p>
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full text-left text-xs">
            <thead className="bg-cream-2 text-[10px] uppercase tracking-wider text-ink-faint">
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
                    <a href={a.explorer} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                      explorer
                    </a>
                    {a.ownedByAdexto && (
                      <a href={a.card} className="text-accent hover:underline" target="_blank" rel="noreferrer">
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

      <section className="section-block mb-4 space-y-4" id="activity">
        <div className="kicker">
          <Activity className="w-4 h-4 text-accent" aria-hidden="true" />
          <span>RECENT ACTIVITY</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">Latest swaps on agent-bound markets</h2>
        {dir.activity.length === 0 ? (
          <p className="text-sm text-ink-soft">No swaps indexed yet on these markets.</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-cream-2 text-[10px] uppercase tracking-wider text-ink-faint">
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

      <section className="section-block space-y-4" id="discovery">
        <div className="kicker">
          <Plug className="w-4 h-4 text-accent" aria-hidden="true" />
          <span>MACHINE-READABLE</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">Where agents and indexers find this</h2>
        <ul className="space-y-1.5 text-xs text-ink-soft">
          {[
            ["MCP endpoint (Streamable HTTP)", MCP_URL],
            ["MCP server card", "https://adexto.xyz/.well-known/mcp/server-card.json"],
            ["MCP Registry entry (server.json)", "https://github.com/0xcuy/adexto/blob/main/server.json"],
            ["x402 OpenAPI", "https://x402.adexto.xyz/openapi.json"],
            ["x402 resources", "https://x402.adexto.xyz/.well-known/x402"],
            ["ERC-8004 domain file", "https://adexto.xyz/.well-known/agent-registration.json"],
            ["Directory as JSON", "https://adexto.xyz/api/agents"],
          ].map(([label, href]) => (
            <li key={label}>
              <span className="text-ink">{label}:</span>{" "}
              <a href={href} className="font-mono text-accent hover:underline break-all">
                {href}
              </a>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-ink-faint">Directory generated {dir.generatedAt.slice(0, 19).replace("T", " ")} UTC.</p>
      </section>
    </div>
  );
}
