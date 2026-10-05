/**
 * /agents — PELUNCURAN saja: bagaimana agen meluncurkan pasar lewat MCP dengan kuncinya sendiri.
 *
 * Arahan owner 5 Okt 2026: halaman ini harus terasa seperti tempat meluncurkan, bukan dokumentasi.
 * Data (direktori + Agent Score) pindah ke `/agents/markets`, feed ke `/agents/activity`, bahan teknis
 * (identitas yang kami operasikan, URL discovery) ke `/agents/registry`, referensi tool ke `/mcp`.
 * Halaman ini statis kecuali preflight di launch console. Teks English (aturan bahasa repo).
 *
 * Klaim yang dipakai, semuanya sudah jalan: `prepare_launch` → tanda tangan deployer → kirim →
 * `register_launch` (diuji di mainnet: $LOOP Monad dan Arbitrum), server tidak memegang kunci, gas saja,
 * seluruh supply di kurva, creator 0,70% per trade pada preset standar, dibeli agen lain lewat x402.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Bot, Coins, Plug, Rocket, ShieldCheck, Sparkles } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import CopyField from "@/components/ui/CopyField";
import { listPublicProjects } from "@/lib/registry";
import { agentLaunchVia } from "@/config/agent-launches";
import { isOurAddress } from "@/lib/agent-identities";
import { explorerTxUrl, resolveChainOrDefault } from "@/lib/chains";
import { buttonClass } from "@/components/ui/Button";
import AgentsNav from "@/components/agents/AgentsNav";
import LaunchConsole from "@/components/agents/LaunchConsole";
import { MCP_URL } from "@/components/agents/format";

// Kartu "Launched by agents" dibaca dari registry saat render.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Launch with your agent — ADEXTO",
  description:
    "Your agent launches a token market on ADEXTO over MCP and signs with its own key. Gas only, all supply in the curve, no liquidity deposit, on Monad, Arbitrum One, Robinhood Chain, Base or 0G.",
};

const STEPS = [
  { icon: Plug, title: "Connect", text: "Add the ADEXTO MCP server, or reach our agent over A2A. No account." },
  { icon: Rocket, title: "Launch", text: "Your agent calls prepare_launch, signs, and sends the transaction. Gas only." },
  { icon: Sparkles, title: "Live", text: "register_launch lists it. People and other agents can trade it right away." },
];

const GETS = [
  { icon: Coins, title: "0.70% of every trade", text: "Paid to the creator wallet on the standard fee preset. Collect it with prepare_claim." },
  { icon: ShieldCheck, title: "No liquidity deposit", text: "All 1,000,000,000 tokens start inside the curve. The creator gets no allocation." },
  { icon: Bot, title: "Bought by other agents", text: "Any agent can buy it with USDC on Base over x402, without gas on your chain." },
];

const MORE: Array<{ href: string; title: string; text: string }> = [
  { href: "/agents/markets", title: "Agent markets", text: "Every agent-bound market and its Agent Score." },
  { href: "/agents/activity", title: "Activity", text: "Latest swaps on agent-bound markets." },
  { href: "/agents/registry", title: "Identities & discovery", text: "Our ERC-8004 identities and machine-readable files." },
  { href: "/mcp", title: "MCP tool reference", text: "All tools, inputs and outputs." },
];

export default function AgentsPage() {
  // Bukti: pasar yang didaftarkan lewat alat agen (MCP `register_launch` atau REST), terbaru dulu.
  const agentLaunches = listPublicProjects()
    .map((p) => ({ p, via: agentLaunchVia(p) }))
    .filter((x) => x.via !== null)
    .sort((a, b) => b.p.deployedAt - a.p.deployedAt)
    .slice(0, 6);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <AgentsNav current="/agents" />

      <PageHeader
        kicker="Agents"
        kickerIcon={Bot}
        title="Launch a market from your agent"
        subtitle="Your agent talks to the ADEXTO MCP server and signs with its own key. The market opens on a bonding curve with no liquidity deposit, on Monad, Arbitrum One, Robinhood Chain, Base or 0G."
        actions={
          <>
            <a href="#launch" className={buttonClass({ variant: "primary", size: "lg" })}>
              Start a launch
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </>
        }
        className="mb-6"
      />
      <CopyField value={MCP_URL} label="MCP server" copyLabel="Copy MCP URL" className="mb-10 max-w-xl" />

      <ol className="mb-12 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="glass-panel rounded-card p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
                <s.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-[13px] font-semibold text-ink-faint">Step {i + 1}</span>
            </div>
            <div className="mt-3 text-[16px] font-semibold text-ink">{s.title}</div>
            <p className="mt-1 text-[13px] leading-snug text-ink-soft">{s.text}</p>
          </li>
        ))}
      </ol>

      <section id="launch" className="mb-12 scroll-mt-24">
        <h2 className="mb-1 text-[20px] font-semibold tracking-tight text-ink">Set up your launch</h2>
        <p className="mb-5 text-[14px] text-ink-soft">
          Fill in the market once. You get the MCP setup, the exact instruction for your agent, and a free check of the
          ticker and wallet before anything is signed.
        </p>
        <LaunchConsole />
      </section>

      {agentLaunches.length > 0 && (
        <section className="mb-12" aria-labelledby="launched-title" data-testid="agent-launches">
          <h2 id="launched-title" className="mb-1 text-[20px] font-semibold tracking-tight text-ink">Launched by agents</h2>
          <p className="mb-4 text-[14px] text-ink-soft">
            Markets whose wallet signed and sent the launch itself, then listed it through the agent tools.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agentLaunches.map(({ p, via }) => {
              const chain = resolveChainOrDefault(p.chainId);
              const ours = isOurAddress(p.creator);
              return (
                <li key={`${p.chainId}:${p.tokenAddress}`} className="glass-panel flex flex-col rounded-card p-4">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image} alt="" width={36} height={36} className="h-9 w-9 rounded-full border border-line object-cover" />
                    <div className="min-w-0">
                      <div className="truncate text-[16px] font-semibold text-ink">${p.symbol}</div>
                      <div className="truncate text-[12px] text-ink-faint">{chain.name}</div>
                    </div>
                  </div>
                  <dl className="mt-3 space-y-1 text-[12px] text-ink-soft">
                    <div className="flex justify-between gap-2">
                      <dt>Listed with</dt>
                      <dd className="font-mono text-ink">{via === "mcp" ? "MCP register_launch" : via === "a2a" ? "A2A launch_market" : "REST register"}</dd>
                    </div>
                    {p.agentIdentity && (
                      <div className="flex justify-between gap-2">
                        <dt>ERC-8004 agent</dt>
                        <dd className="font-mono text-ink">#{p.agentIdentity.agentId}</dd>
                      </div>
                    )}
                    {ours && (
                      <div className="flex justify-between gap-2">
                        <dt>Creator</dt>
                        <dd className="text-ink">ADEXTO demo agent</dd>
                      </div>
                    )}
                  </dl>
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    <Link href={`/token/${p.slug}?chain=${p.chainId}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                      Trade
                    </Link>
                    {p.txHash && (
                      <a href={explorerTxUrl(p.chainId, p.txHash)} target="_blank" rel="noreferrer" className={buttonClass({ variant: "ghost", size: "sm" })}>
                        Launch tx
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mb-12" aria-labelledby="gets-title">
        <h2 id="gets-title" className="mb-4 text-[20px] font-semibold tracking-tight text-ink">What your market gets</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {GETS.map((g) => (
            <li key={g.title} className="rounded-card border border-line bg-cream-2 p-4">
              <g.icon className="h-5 w-5 text-accent" aria-hidden="true" />
              <div className="mt-2 text-[14px] font-semibold text-ink">{g.title}</div>
              <p className="mt-1 text-[13px] leading-snug text-ink-soft">{g.text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-ink-faint">
          Optional: pass an ERC-8004 agent id the wallet owns, and the factory binds it to the token for good. The Agent
          Score of every agent-bound market is on Agent markets.
        </p>
      </section>

      <section aria-labelledby="more-title">
        <h2 id="more-title" className="mb-4 text-[16px] font-semibold text-ink">More about agents on ADEXTO</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MORE.map((m) => (
            <li key={m.href}>
              <Link href={m.href} className="group flex h-full flex-col rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong">
                <span className="flex items-center justify-between text-[14px] font-semibold text-ink">
                  {m.title}
                  <ArrowRight className="h-4 w-4 text-ink-faint transition-colors group-hover:text-accent" aria-hidden="true" />
                </span>
                <span className="mt-1 text-[13px] leading-snug text-ink-soft">{m.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
