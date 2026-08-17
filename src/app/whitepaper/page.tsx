import Link from "next/link";
import { BookOpen, ShieldCheck, Cpu, Layers, Zap, ArrowRight, Lock, CheckCircle2 } from "lucide-react";

export default function WhitepaperPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      {/* Document Header */}
      <div className="border-b-2 border-white/20 pb-8 mb-10">
        <div className="flex items-center gap-2 text-xs font-mono text-cyan-300 font-bold mb-2">
          <span>ADEXTO PROTOCOL SPECIFICATION</span>
          <span>•</span>
          <span>VERSION 2.4.0 (AUGUST 2026)</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
          ADEXTO: Autonomous Decentralized EXchange &amp; Token Orchestrator
        </h1>
        <p className="text-sm sm:text-base text-slate-100 mt-4 leading-relaxed font-normal bg-[#070b16] p-4 rounded-xl border border-white/15">
          <strong className="text-cyan-300">Abstract:</strong> We present ADEXTO (adexto.xyz), a vertically integrated Web3 infrastructure uniting autonomous AI Agent execution (A), Uniswap v4 Sovereign DEX Hooks (DEX), 1-Click Token Launchpads (T), and protocol economic orchestration (O) backed by 0G Private Computer (TEE) and EVIDIQ MCP Fleet.
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-12 text-slate-100 text-sm sm:text-base leading-relaxed">
        {/* Section 1 */}
        <section className="glass-panel p-6 rounded-2xl border border-white/15 space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-cyan-400 font-mono">§1.</span> The Problem: The Launchpad Trap
          </h2>
          <p className="text-slate-200">
            Current token launchpads (e.g., Pump.fun, Clanker) suffer from extreme structural misalignment:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-slate-200">
            <li><strong className="text-white font-bold">Zero Autonomous Utility:</strong> Tokens launched have no inherent productivity or underlying cashflow generation.</li>
            <li><strong className="text-white font-bold">Liquidity Cannibalization:</strong> Post-bonding graduation dumps liquidity into centralized pools with inflexible fee tiers where creators forfeit revenue.</li>
            <li><strong className="text-white font-bold">Centralized AI Fragility:</strong> Existing "AI Tokens" run on centralized cloud providers (AWS, OpenAI) vulnerable to private key theft, prompt tampering, and rug-pulls.</li>
          </ul>
        </section>

        {/* Section 2 */}
        <section className="glass-panel p-6 rounded-2xl border border-white/15 space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-cyan-400 font-mono">§2.</span> The ADEXTO Architecture Mapping
          </h2>
          <p className="text-slate-200">
            ADEXTO solves this by executing atomic synchronization across all four functional primitives:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs my-4">
            <div className="p-4 rounded-xl bg-[#070a14] border border-cyan-500/30">
              <strong className="text-cyan-300 block mb-1 text-sm font-bold">A → Autonomous</strong>
              <span className="text-slate-200">24/7 AI Agent deployed in 0G TEE Enclave with quantitative trading authority.</span>
            </div>
            <div className="p-4 rounded-xl bg-[#070a14] border border-purple-500/30">
              <strong className="text-purple-300 block mb-1 text-sm font-bold">DEX → Sovereign AMM</strong>
              <span className="text-slate-200">Uniswap v4 Hook capturing custom swap fee splits (e.g., 0.20% LP / 0.10% Treasury).</span>
            </div>
            <div className="p-4 rounded-xl bg-[#070a14] border border-pink-500/30">
              <strong className="text-pink-300 block mb-1 text-sm font-bold">T → Token Factory</strong>
              <span className="text-slate-200">ERC-20 with ERC-8004 metadata binding. Encodes immutable agent ownership.</span>
            </div>
            <div className="p-4 rounded-xl bg-[#070a14] border border-emerald-500/30">
              <strong className="text-emerald-300 block mb-1 text-sm font-bold">O → Orchestrator</strong>
              <span className="text-slate-200">Master coordinator managing automated buyback, burns, and x402 revenue distribution.</span>
            </div>
          </div>
        </section>

        {/* Section 3 */}
        <section className="glass-panel p-6 rounded-2xl border border-white/15 space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-cyan-400 font-mono">§3.</span> The x402 Micropayment Engine &amp; Auto-Buyback
          </h2>
          <p className="text-slate-200">
            Every ADEXTO agent exposes an HTTP 402 Payment Required endpoint. When external users, bots, or DAOs query the agent for quantitative signals, security audits, or generative assets, the agent accepts USDC/USDT0 micropayments via EIP-712 cryptographic signatures.
          </p>
          <div className="p-4 rounded-xl bg-[#04060d] border border-white/20 font-mono text-[11px] sm:text-xs text-slate-100 overflow-x-auto">
            <span className="text-emerald-400 font-bold block mb-2">// Revenue Flow Equation</span>
            R_total = SwapFees(Uniswap_v4) + x402_Micropayments(EVIDIQ)<br />
            Treasury_Allocation = 0.70 * R_total<br />
            Buyback_Execution = Uniswap_Hook.swapExactTokensForTokens(Treasury_Allocation, Token_Native, BurnAddress)
          </div>
        </section>

        {/* Section 4 */}
        <section className="glass-panel p-6 rounded-2xl border border-white/15 space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-cyan-400 font-mono">§4.</span> Tokenomics &amp; Value Accrual ($ADEXTO)
          </h2>
          <p className="text-slate-200">
            The protocol native token ($ADEXTO) governs global factory parameters, subsidizes 0G TEE compute enclaves, and receives a 40% protocol fee distribution from all sovereign DEX swaps across 0G and Arbitrum networks.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center font-mono text-xs pt-2">
            <div className="p-3.5 rounded-lg bg-[#070a14] border border-white/15">
              <div className="text-xl font-black text-white">40%</div>
              <div className="text-[11px] text-zinc-300 font-bold">Community Stakers</div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#070a14] border border-white/15">
              <div className="text-xl font-black text-white">25%</div>
              <div className="text-[11px] text-zinc-300 font-bold">Ecosystem Grants</div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#070a14] border border-white/15">
              <div className="text-xl font-black text-white">20%</div>
              <div className="text-[11px] text-zinc-300 font-bold">Core Developers</div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#070a14] border border-white/15">
              <div className="text-xl font-black text-white">15%</div>
              <div className="text-[11px] text-zinc-300 font-bold">Liquidity Reserve</div>
            </div>
          </div>
        </section>
      </div>

      {/* CTA Footer */}
      <div className="mt-16 pt-8 border-t border-white/20 flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link href="/docs" className="text-xs font-bold text-cyan-300 hover:text-cyan-200 font-mono flex items-center gap-1.5">
          Explore EVIDIQ MCP Documentation →
        </Link>
        <Link
          href="/studio"
          className="px-6 py-3 rounded-xl font-bold text-xs bg-gradient-to-r from-cyan-500 to-purple-600 text-white shadow-lg shadow-purple-600/30"
        >
          Launch in Studio
        </Link>
      </div>
    </div>
  );
}
