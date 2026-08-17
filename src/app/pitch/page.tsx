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
      <div className="border-b-2 border-white/20 pb-8 mb-12 text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold mb-4">
          VC DUE DILIGENCE &amp; GRANT PROPOSAL MEMORANDUM
        </div>
        <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
          ADEXTO PROTOCOL: The Sovereign Infrastructure for the $100B AI Agent Economy
        </h1>
        <p className="text-slate-200 text-sm sm:text-base mt-4 leading-relaxed font-medium">
          Ecosystem Grant &amp; Pre-Seed Memorandum • Target: $150K–$500K Grants • August 2026 • adexto.xyz • Targeting 0G Foundation Tier-1 Grants &amp; Base Ecosystem Fund
        </p>
      </div>

      <div className="space-y-12">
        {/* ── VC TEAR-DOWN: THE HARD TRUTHS ──────────────────────────────────── */}
        <div className="glass-panel p-8 rounded-3xl border-2 border-red-500/40 space-y-6 shadow-2xl bg-red-950/10">
          <div className="flex items-center gap-2 text-xs font-mono text-red-400 font-bold">
            <ShieldAlert className="w-4 h-4" />
            <span>EXECUTIVE SUMMARY: WHY 99% OF CRYPTO x AI IS UNINVESTABLE</span>
          </div>
          <h2 className="text-2xl font-black text-white">The Three Fatal Flaws We Annihilate</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-medium">
            <div className="p-4 rounded-xl bg-[#080d1a] border border-red-500/30 space-y-2">
              <span className="text-red-400 font-black text-sm block">1. The Fake AI Problem</span>
              <p className="text-slate-300 leading-relaxed">
                Most "AI tokens" are centralized wrappers running on AWS with hardcoded OpenAI keys. When the developer gets subpoenaed or rugged, the agent dies. 
                <strong className="text-white block mt-1">ADEXTO Fix: 100% 0G TEE hardware isolation (AMD SEV-SNP). Developer cannot access keys or prompt memory.</strong>
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#080d1a] border border-red-500/30 space-y-2">
              <span className="text-red-400 font-black text-sm block">2. Launchpad Fee Theft</span>
              <p className="text-slate-300 leading-relaxed">
                Platforms like Pump.fun and Clanker extract $100M+ in creator fees while creators receive $0 from downstream AMM trading volume.
                <strong className="text-white block mt-1">ADEXTO Fix: Uniswap v4 Sovereign Hooks give 100% fee routing to project LPs &amp; Agent Buyback Treasuries.</strong>
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#080d1a] border border-red-500/30 space-y-2">
              <span className="text-red-400 font-black text-sm block">3. Zero Real Revenue (Ponzi Trap)</span>
              <p className="text-slate-300 leading-relaxed">
                Tokens with 0 cashflow inevitably dump to zero when retail hype moves on.
                <strong className="text-white block mt-1">ADEXTO Fix: Cloudflare Workers x402 edge paywall generates cashflow per API query, funding continuous buybacks.</strong>
              </p>
            </div>
          </div>
        </div>

        {/* ── THE 4-IN-1 ORCHESTRATION ARCHITECTURE ──────────────────────────── */}
        <div className="glass-panel p-8 rounded-3xl border-2 border-white/20 space-y-6 shadow-2xl">
          <div className="flex items-center gap-2 text-xs font-mono text-cyan-300 font-bold">
            <span>PILLAR ARCHITECTURE</span>
            <span>•</span>
            <span>THE ADEXTO ADVANTAGE</span>
          </div>
          <h2 className="text-2xl font-black text-white">Full-Stack Sovereignty: The ADEXTO Moat</h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
            <div className="p-4 rounded-xl bg-[#070a14] border border-cyan-500/30">
              <strong className="text-cyan-300 block mb-1 text-sm font-bold">A → Autonomous</strong>
              <span className="text-slate-200">Hardware-verified TEE compute on 0G Mainnet (Chain ID 16661). Verifiable inference and 24/7 quant market-making.</span>
            </div>
            <div className="p-4 rounded-xl bg-[#070a14] border border-purple-500/30">
              <strong className="text-purple-300 block mb-1 text-sm font-bold">DEX → Sovereign Hook</strong>
              <span className="text-slate-200">Uniswap v4 dynamic hook AMM capturing 0.20% LP / 0.10% buyback fee splits natively.</span>
            </div>
            <div className="p-4 rounded-xl bg-[#070a14] border border-pink-500/30">
              <strong className="text-pink-300 block mb-1 text-sm font-bold">T → Token Factory</strong>
              <span className="text-slate-200">ERC-8004 metadata binding with dynamic mathematical bonding curves &amp; anti-sniper protection.</span>
            </div>
            <div className="p-4 rounded-xl bg-[#070a14] border border-emerald-500/30">
              <strong className="text-emerald-300 block mb-1 text-sm font-bold">O → Orchestrator</strong>
              <span className="text-slate-200">Cloudflare Workers x402 edge gate settling global machine micropayments in sub-50ms.</span>
            </div>
          </div>
        </div>

        {/* ── UNIT ECONOMICS & FINANCIAL PROJECTIONS ─────────────────────────── */}
        <div className="glass-panel p-8 rounded-3xl border-2 border-white/20 space-y-6 shadow-2xl">
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-300 font-bold">
            <span>FINANCIAL UNIT ECONOMICS</span>
            <span>•</span>
            <span>REVENUE &amp; MRR MODEL</span>
          </div>
          <h2 className="text-2xl font-black text-white">4 Scalable High-Margin Revenue Streams</h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-medium">
            <div className="p-4 rounded-xl bg-[#070a14] border border-white/15 space-y-1.5">
              <strong className="text-white block font-bold text-sm">1. Sovereign AMM Swap Take-Rate</strong>
              <p className="text-slate-300">0.05% protocol take-rate on all swap volume across thousands of Sovereign DEXs deployed on Base, 0G, Arbitrum &amp; Monad.</p>
              <span className="text-emerald-400 font-mono font-bold block pt-1">Target: $450k/mo at $900M Monthly Volume</span>
            </div>

            <div className="p-4 rounded-xl bg-[#070a14] border border-white/15 space-y-1.5">
              <strong className="text-white block font-bold text-sm">2. Cloudflare x402 Micropayment Split</strong>
              <p className="text-slate-300">10% facilitation take-rate on paid agent API calls settled between machines at the global edge.</p>
              <span className="text-emerald-400 font-mono font-bold block pt-1">Target: $120k/mo at 12M monthly tool calls</span>
            </div>

            <div className="p-4 rounded-xl bg-[#070a14] border border-white/15 space-y-1.5">
              <strong className="text-white block font-bold text-sm">3. 0G TEE SaaS Enclave Subscriptions</strong>
              <p className="text-slate-300">Tiered hosting for dedicated 0G private compute: $29/mo (Starter), $149/mo (Pro), $499/mo (Sovereign Fleet).</p>
              <span className="text-emerald-400 font-mono font-bold block pt-1">Target: $185k/mo ARR across 2,500 active enclaves</span>
            </div>

            <div className="p-4 rounded-xl bg-[#070a14] border border-white/15 space-y-1.5">
              <strong className="text-white block font-bold text-sm">4. EVIDIQ MCP Tool Marketplace</strong>
              <p className="text-slate-300">Revenue split on premium agent security (Sentinel), brand assets (Signet), and schedulers (Helm).</p>
              <span className="text-emerald-400 font-mono font-bold block pt-1">Target: $80k/mo in addon subscriptions</span>
            </div>
          </div>
        </div>

        {/* ── ROADMAP & GRANT TARGETS ────────────────────────────────────────── */}
        <div className="glass-panel p-8 rounded-3xl border-2 border-white/20 space-y-6 shadow-2xl">
          <div className="flex items-center gap-2 text-xs font-mono text-pink-300 font-bold">
            <span>GRANT STRATEGY &amp; ROADMAP</span>
            <span>•</span>
            <span>BASE + 0G + ARBITRUM + MONAD</span>
          </div>
          <h2 className="text-2xl font-black text-white">90-Day Execution Milestones</h2>
          
        <div className="space-y-3 text-xs sm:text-sm font-mono">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#070a14] border border-white/10">
            <div>
              <strong className="text-white block text-sm">Phase 1 (Live Now - August 2026):</strong>
              <span className="text-zinc-300 text-xs">0G Mainnet + Arbitrum One Core Contracts + Cloudflare Workers x402 + 0G TEE Enclaves</span>
            </div>
            <span className="px-3 py-1 rounded bg-emerald-500/20 text-emerald-300 font-bold text-xs">LIVE</span>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#070a14] border border-white/10">
            <div>
              <strong className="text-white block text-sm">Phase 2 (Q4 2026):</strong>
              <span className="text-zinc-300 text-xs">Cross-Chain CCIP Mesh (Base + Monad) &amp; DAO Decentralized Governance</span>
            </div>
            <span className="px-3 py-1 rounded bg-cyan-500/20 text-cyan-300 font-bold text-xs">IN PROGRESS</span>
          </div>
        </div>
      </div>

      {/* ── ON-CHAIN DEPLOYED CONTRACTS CARD ────────────────────────────── */}
      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <VerifiedDeploymentCard />
      </div>
    </div>

    {/* CTA Footer */}
      <div className="mt-14 pt-8 border-t border-white/20 flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link href="/whitepaper" className="text-xs font-bold text-cyan-300 hover:text-cyan-200 font-mono flex items-center gap-1.5">
          Read Full Mathematical Whitepaper →
        </Link>
        <Link
          href="/studio"
          className="px-8 py-3.5 rounded-xl font-black text-xs bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-500 text-white shadow-xl shadow-purple-600/30 hover:shadow-cyan-500/40 transition-all"
        >
          Test Live Studio Demo
        </Link>
      </div>
    </div>
  );
}
