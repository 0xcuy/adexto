import Link from "next/link";
import VerifiedDeploymentCard from "@/components/VerifiedDeploymentCard";
import { 
  Award, TrendingUp, Cpu, ShieldCheck, Zap, ArrowRight, DollarSign, 
  Layers, Users, CheckCircle2, BarChart3, CloudLightning, RefreshCw, Flame, Globe,
  ShieldAlert
} from "lucide-react";

export default function PitchDeckPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      {/* Header */}
      <div className="border-b-2 border-line pb-8 mb-12 text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-ok/10 text-ok border border-ok/30 text-xs font-mono font-bold mb-4">
          VC DUE DILIGENCE &amp; GRANT PROPOSAL MEMORANDUM
        </div>
        <h1 className="text-3xl sm:text-5xl font-semibold text-ink tracking-tight leading-tight">
          ADEXTO PROTOCOL: The Sovereign Infrastructure for the $100B AI Agent Economy
        </h1>
        <p className="text-ink text-sm sm:text-base mt-4 leading-relaxed font-medium">
          Ecosystem Grant &amp; Pre-Seed Memorandum • Target: $150K–$500K Grants • August 2026 • adexto.xyz • Targeting 0G Foundation Tier-1 Grants &amp; Base Ecosystem Fund
        </p>
      </div>

      {/* Ritme diatur oleh .section-block (jarak + garis tipis di atas), bukan lagi
          oleh space-y besar antar kotak. */}
      <div>
        {/* ── VC TEAR-DOWN: THE HARD TRUTHS ──────────────────────────────────── */}
        <div className="section-block space-y-5">
          <div className="kicker text-danger/90">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Executive summary — why 99% of crypto x AI is uninvestable</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">The Three Fatal Flaws We Annihilate</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-medium">
            <div className="card card-hover p-4 space-y-2 border-danger/30">
              <span className="text-danger font-semibold text-sm block">1. The Fake AI Problem</span>
              <p className="text-ink-soft leading-relaxed">
                Most "AI tokens" are centralized wrappers running on AWS with hardcoded OpenAI keys. When the developer gets subpoenaed or rugged, the agent dies. 
                <strong className="text-ink block mt-1">ADEXTO Fix: 100% 0G TEE hardware isolation (AMD SEV-SNP). Developer cannot access keys or prompt memory.</strong>
              </p>
            </div>

            <div className="card card-hover p-4 space-y-2 border-danger/30">
              <span className="text-danger font-semibold text-sm block">2. Launchpad Fee Theft</span>
              <p className="text-ink-soft leading-relaxed">
                Platforms like Pump.fun and Clanker extract $100M+ in creator fees while creators receive $0 from downstream AMM trading volume.
                <strong className="text-ink block mt-1">ADEXTO Fix: the creator is paid 0.10% of every swap directly by the curve, for as long as the token trades — inside the total fee, not added on top of it.</strong>
              </p>
            </div>

            <div className="card card-hover p-4 space-y-2 border-danger/30">
              <span className="text-danger font-semibold text-sm block">3. Zero Real Revenue (Ponzi Trap)</span>
              <p className="text-ink-soft leading-relaxed">
                Tokens with 0 cashflow inevitably dump to zero when retail hype moves on.
                <strong className="text-ink block mt-1">ADEXTO Fix: Cloudflare Workers x402 edge paywall generates cashflow per API query, funding continuous buybacks.</strong>
              </p>
            </div>
          </div>
        </div>

        {/* ── THE 4-IN-1 ORCHESTRATION ARCHITECTURE ──────────────────────────── */}
        <div className="section-block space-y-5">
          <div className="kicker">Pillar architecture · the ADEXTO advantage</div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">Full-Stack Sovereignty: The ADEXTO Moat</h2>
          
          {/* Paragraf penjelas tidak boleh monospace. Kelas `font-mono` di sini
              membuat empat kartu pilar terbaca seperti keluaran terminal, dan itu
              baru kelihatan jelas setelah situs punya typeface sungguhan. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
            <div className="card card-hover p-4 border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">A → Autonomous</strong>
              <span className="text-ink">Hardware-verified TEE compute on 0G Mainnet (Chain ID 16661). Verifiable inference and 24/7 quant market-making.</span>
            </div>
            <div className="card card-hover p-4 border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">DEX → Sovereign Curve</strong>
              <span className="text-ink">A per-token bonding curve over a virtual reserve: 0.15% depth stays in the curve, 0.10% pays the creator, 0.05% funds agent buybacks.</span>
            </div>
            <div className="card card-hover p-4 border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">T → Token Factory</strong>
              <span className="text-ink">ERC-8004 metadata binding with dynamic mathematical bonding curves &amp; anti-sniper protection.</span>
            </div>
            <div className="card card-hover p-4 border-ok/30">
              <strong className="text-ok block mb-1 text-sm font-bold">O → Orchestrator</strong>
              <span className="text-ink">Cloudflare Workers x402 edge gate settling global machine micropayments in sub-50ms.</span>
            </div>
          </div>
        </div>

        {/* ── UNIT ECONOMICS & FINANCIAL PROJECTIONS ─────────────────────────── */}
        <div className="section-block space-y-5">
          <div className="kicker">Financial unit economics · revenue &amp; MRR model</div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">4 Scalable High-Margin Revenue Streams</h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-medium">
            <div className="p-4 rounded-xl bg-white border border-line space-y-1.5">
              <strong className="text-ink block font-bold text-sm">1. Curve Swap Take-Rate (planned)</strong>
              {/* Ditandai "planned": pembagian fee di SovereignCurve hari ini hanya
                  depth + creator + buyback token itu sendiri. Tidak ada irisan
                  protokol di kontrak, jadi ini proyeksi monetisasi, bukan penerimaan
                  yang sudah berjalan. */}
              <p className="text-ink-soft">A 0.05% protocol take-rate on swap volume across thousands of sovereign curves on Base, 0G, Arbitrum &amp; Monad. Not yet enabled in the contracts — today the full fee goes to depth, the creator, and the token&apos;s own buyback vault.</p>
              <span className="text-ok font-mono font-bold block pt-1">Target: $450k/mo at $900M Monthly Volume</span>
            </div>

            <div className="p-4 rounded-xl bg-white border border-line space-y-1.5">
              <strong className="text-ink block font-bold text-sm">2. Cloudflare x402 Micropayment Split</strong>
              <p className="text-ink-soft">10% facilitation take-rate on paid agent API calls settled between machines at the global edge.</p>
              <span className="text-ok font-mono font-bold block pt-1">Target: $120k/mo at 12M monthly tool calls</span>
            </div>

            <div className="p-4 rounded-xl bg-white border border-line space-y-1.5">
              <strong className="text-ink block font-bold text-sm">3. 0G TEE SaaS Enclave Subscriptions</strong>
              <p className="text-ink-soft">Tiered hosting for dedicated 0G private compute: $29/mo (Starter), $149/mo (Pro), $499/mo (Sovereign Fleet).</p>
              <span className="text-ok font-mono font-bold block pt-1">Target: $185k/mo ARR across 2,500 active enclaves</span>
            </div>

            <div className="p-4 rounded-xl bg-white border border-line space-y-1.5">
              <strong className="text-ink block font-bold text-sm">4. EVIDIQ MCP Tool Marketplace</strong>
              <p className="text-ink-soft">Revenue split on premium agent security (Sentinel), brand assets (Signet), and schedulers (Helm).</p>
              <span className="text-ok font-mono font-bold block pt-1">Target: $80k/mo in addon subscriptions</span>
            </div>
          </div>
        </div>

        {/* ── COMPETITIVE MATRIX: ADEXTO VS EXISTING LAUNCHPADS ────────────── */}
        <div className="section-block space-y-5">
          <div className="kicker">
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Competitive moat &amp; benchmark matrix</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">Why ADEXTO Dominates the Next Cycle</h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-line text-ink-soft">
                  <th className="pb-3 pr-4">Feature / Metric</th>
                  <th className="pb-3 px-4 text-danger">Pump.fun / Clanker</th>
                  <th className="pb-3 px-4 text-accent">Virtuals Protocol</th>
                  <th className="pb-3 pl-4 text-accent font-bold bg-accent-soft rounded-t-lg">ADEXTO (adexto.xyz)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink">
                <tr>
                  <td className="py-3 pr-4 font-bold text-ink">AI Hardware Isolation</td>
                  <td className="py-3 px-4 text-danger">None (Meme only)</td>
                  <td className="py-3 px-4 text-ink-soft">Cloud Web2 API</td>
                  <td className="py-3 pl-4 text-ok font-bold bg-accent-soft">0G AMD SEV-SNP TEE</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-ink">Creator Trading Revenue</td>
                  <td className="py-3 px-4 text-danger">0% (Platform takes all)</td>
                  <td className="py-3 px-4 text-ink-soft">Partial pool cut</td>
                  <td className="py-3 pl-4 text-ok font-bold bg-accent-soft">0.10% of every swap, paid by the curve</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-ink">Multi-chain launch</td>
                  <td className="py-3 px-4 text-danger">Single chain only</td>
                  <td className="py-3 px-4 text-ink-soft">Base only</td>
                  <td className="py-3 pl-4 text-ok font-bold bg-accent-soft">
                    1–4 chains, one market per chain
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-ink">Edge Micro-Monetization</td>
                  <td className="py-3 px-4 text-danger">None</td>
                  <td className="py-3 px-4 text-danger">None</td>
                  <td className="py-3 pl-4 text-ok font-bold bg-accent-soft">Cloudflare Workers x402</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-ink">Anti-Sniper Defense</td>
                  <td className="py-3 px-4 text-danger">Rampant Bot Dumps</td>
                  <td className="py-3 px-4 text-ink-soft">Basic cooldown</td>
                  <td className="py-3 pl-4 text-ok font-bold bg-accent-soft">ERC-8004 1% Genesis Limit</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── ROADMAP & GRANT TARGETS ────────────────────────────────────────── */}
        <div className="section-block space-y-5">
          <div className="kicker">Grant strategy &amp; roadmap · Base + 0G + Arbitrum + Monad</div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">90-Day Execution Milestones</h2>
          
        <div className="space-y-3 text-xs sm:text-sm font-mono">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-white border border-line">
            <div>
              <strong className="text-ink block text-sm">Phase 1 (Live Now - August 2026):</strong>
              <span className="text-ink-soft text-xs">0G Mainnet + Arbitrum One Core Contracts + Cloudflare Workers x402 + 0G TEE Enclaves</span>
            </div>
            <span className="px-3 py-1 rounded bg-ok/10 text-ok font-bold text-xs">LIVE</span>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-white border border-line">
            <div>
              <strong className="text-ink block text-sm">Phase 2 (Q4 2026):</strong>
              <span className="text-ink-soft text-xs">
                DAO governance on 0G · cross-chain lanes pending CCIP support for 0G and Monad
              </span>
            </div>
            <span className="px-3 py-1 rounded bg-accent-soft text-accent font-bold text-xs">IN PROGRESS</span>
          </div>
        </div>
      </div>

      {/* ── ON-CHAIN DEPLOYED CONTRACTS CARD ────────────────────────────── */}
      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <VerifiedDeploymentCard />
      </div>
    </div>

    {/* CTA Footer */}
      <div className="mt-14 pt-8 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link href="/whitepaper" className="text-xs font-bold text-accent hover:text-accent font-mono flex items-center gap-1.5">
          Read Full Mathematical Whitepaper →
        </Link>
        <Link
          href="/studio"
          className="px-8 py-3.5 rounded-xl font-semibold text-xs bg-accent hover:bg-accent-strong text-white shadow-xl shadow-accent/10 hover:shadow-accent/10 transition-all"
        >
          Test Live Studio Demo
        </Link>
      </div>
    </div>
  );
}
