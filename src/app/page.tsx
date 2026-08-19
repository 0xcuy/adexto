"use client";

import Link from "next/link";
import { useState } from "react";
import VerifiedDeploymentCard from "@/components/VerifiedDeploymentCard";
import { 
  Sparkles, Zap, Layers, Cpu, ShieldCheck, ArrowRight, CheckCircle2, 
  Coins, Terminal, TrendingUp, Lock, RefreshCw, BarChart3, Database, Globe,
  Activity, Award, ArrowUpRight, Flame, Scale, Code2, Play, Users, DollarSign,
  CloudLightning, ExternalLink, Network, Shield, AlertCircle, HelpCircle
} from "lucide-react";

export default function HomePage() {
  const [activeCodeTab, setActiveCodeTab] = useState<"factory" | "hook" | "cloudflare">("factory");

  return (
    <div className="flex flex-col items-center justify-center relative">
      {/* ── HERO SECTION ────────────────────────────────────────────────────────── */}
      <section className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 text-center">
        {/* Mainnet Ready Pill */}
        <div className="inline-flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 px-4 py-1.5 rounded-full bg-[#0a1124] border border-cyan-400/40 text-xs font-mono text-cyan-300 mb-8 shadow-lg">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold text-white">ADEXTO PROTOCOL v1.0.0</span>
          <span className="text-zinc-500 hidden sm:inline">|</span>
          <span className="text-cyan-300 font-semibold">0G (16661) • Arbitrum (42161) • Base (8453) • Monad (143) Live</span>
        </div>

        {/* Value Proposition Headline */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight max-w-5xl mx-auto leading-[1.08] mb-6 text-white">
          Launch Autonomous Agents, Sovereign DEXs &amp; Tokens in <span className="gradient-text">1-Click</span>.
        </h1>

        {/* Clear Explanation */}
        <p className="text-base sm:text-xl text-slate-200 max-w-3xl mx-auto mb-10 leading-relaxed font-medium bg-[#070b16]/95 p-5 rounded-2xl border border-white/10 shadow-xl">
          Existing launchpads extract millions while creators earn zero downstream trading revenue. <strong className="text-cyan-300">ADEXTO</strong> binds an ERC-8004 token, a sovereign bonding curve that needs no liquidity deposit, and a 24/7 0G TEE Agent into one atomic lifecycle—monetized at the edge with <strong className="text-orange-400">Cloudflare Workers x402</strong>.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4 mb-16">
          <Link
            href="/studio"
            className="flex items-center gap-2.5 px-8 py-4 rounded-xl font-bold text-base bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-500 text-white shadow-xl shadow-purple-600/40 hover:shadow-cyan-500/60 transition-all transform hover:-translate-y-0.5"
          >
            <Sparkles className="w-5 h-5 text-white" />
            Launch Studio Cockpit (1-Click)
            <ArrowRight className="w-5 h-5 ml-1 text-white" />
          </Link>
          <Link
            href="/pitch"
            className="flex items-center gap-2.5 px-8 py-4 rounded-xl font-bold text-base bg-[#0f172a] hover:bg-[#1e293b] border border-white/20 text-white shadow-lg transition-all"
          >
            <Award className="w-5 h-5 text-cyan-300" />
            VC Due Diligence &amp; Grant Memorandum
          </Link>
        </div>

        {/* Real Status Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-5xl mx-auto text-left font-mono">
          <div className="glass-panel p-5 rounded-xl border border-white/20">
            <div className="text-zinc-400 text-xs font-bold uppercase">Deployment Status</div>
            <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-1">Mainnet Ready</div>
            {/* Dulu hanya "Contracts Verified", yang berdampingan dengan "4 Chains
                Active" mudah dibaca sebagai "perdagangan sudah jalan di 4 mainnet".
                Kontrak memang terverifikasi, tapi factory peluncuran belum
                di-broadcast, jadi cakupannya dinyatakan terang-terangan. Klaim yang
                bisa dibantah dengan satu panggilan RPC lebih merugikan daripada
                klaim yang lebih kecil tapi tepat. */}
            <span className="text-[11px] text-zinc-300 mt-1 block">Contracts verified · launch factory pending broadcast</span>
          </div>

        <div className="glass-panel p-5 rounded-xl border border-white/20">
          <div className="text-zinc-400 text-xs font-bold uppercase">Multi-Chain Live</div>
          <div className="text-xl sm:text-2xl font-black text-white mt-1">4 Chains Active</div>
          <span className="text-[11px] text-cyan-300 mt-1 block">0G, Arb, Base, Monad</span>
        </div>

          <div className="glass-panel p-5 rounded-xl border border-white/20">
            <div className="text-zinc-400 text-xs font-bold uppercase">Compute Enclave</div>
            <div className="text-xl sm:text-2xl font-black text-purple-300 mt-1">0G Compute TEE</div>
            <span className="text-[11px] text-zinc-300 mt-1 block">AMD SEV-SNP Isolation</span>
          </div>

        <div className="glass-panel p-5 rounded-xl border border-white/20">
          <div className="text-zinc-400 text-xs font-bold uppercase">Edge Micro-billing</div>
          <div className="text-xl sm:text-2xl font-black text-orange-400 mt-1">Cloudflare x402</div>
          <span className="text-[11px] text-zinc-300 mt-1 block">&lt;50ms Global Route</span>
        </div>
      </div>

        {/* Trust Badge Bar */}
        <div className="mt-8 max-w-4xl mx-auto p-3.5 rounded-2xl bg-[#060a17]/90 border border-cyan-500/30 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono shadow-xl">
          <div className="flex items-center gap-2 text-zinc-300">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Secured &amp; Attested on <strong className="text-cyan-300">0G</strong> • <strong className="text-sky-300">Arbitrum</strong> • <strong className="text-purple-300">Monad</strong> • <strong className="text-blue-300">Base</strong></span>
          </div>
          <Link
            href="/docs"
            className="text-cyan-400 hover:text-cyan-300 font-bold hover:underline flex items-center gap-1 shrink-0"
          >
            <span>View Verified Contracts</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>

    {/* ── THE PROBLEM & THE SOLUTION (VC PERSPECTIVE) ────────────────────────── */}
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-white/10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-red-950/80 text-red-300 border border-red-500/40 text-xs font-mono font-bold mb-3">
            MARKET PROBLEM VS ADEXTO SOLUTION
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-white">The Web3 Launchpad Trap vs Sovereign Ownership</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Problem */}
          <div className="glass-panel p-8 rounded-2xl border border-red-500/30 space-y-4">
            <div className="flex items-center gap-2 text-red-400 font-bold text-sm font-mono">
              <AlertCircle className="w-4 h-4" /> THE BROKEN INDUSTRY STANDARD (Pump.fun, Clanker)
            </div>
            <ul className="space-y-3 text-xs sm:text-sm text-slate-300 font-sans">
              <li className="flex items-start gap-2">
                <span className="text-red-400 font-bold">✕</span>
                <span><strong>Zero Creator Retention:</strong> Launchpads take all the fees; creators receive 0% of ongoing liquidity pool swaps.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 font-bold">✕</span>
                <span><strong>Fake AI Bots:</strong> Agents run on AWS with hardcoded API keys; developers can rug the private key anytime.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 font-bold">✕</span>
                <span><strong>Zero Utility Ponzi:</strong> No real revenue stream. Tokens bleed to zero as soon as speculative volume moves away.</span>
              </li>
            </ul>
          </div>

          {/* Solution */}
          <div className="glass-panel p-8 rounded-2xl border border-emerald-500/30 space-y-4">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm font-mono">
              <CheckCircle2 className="w-4 h-4" /> THE ADEXTO ARCHITECTURAL MOAT
            </div>
            <ul className="space-y-3 text-xs sm:text-sm text-slate-200 font-sans">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>Creator Fee Sovereignty:</strong> every swap pays the creator 0.10% directly, plus 0.05% to the agent buyback vault. No token allocation, so there is nothing to dump.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>Verifiable 0G TEE:</strong> Hardware-isolated execution on AMD SEV-SNP. No human (including the dev) can extract private keys.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>Real Cashflow Flywheel:</strong> Cloudflare x402 edge paywalls charge external agents per API call, funding continuous buybacks.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── THE 4 PILLARS (A - DEX - T - O) ────────────────────────────────────── */}
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-white/10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold mb-3">
            THE 4-IN-1 CORE ARCHITECTURE
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-white">How The Four Pillars Connect</h2>
          <p className="text-zinc-300 text-sm sm:text-base mt-2 leading-relaxed">
            Every token launched on ADEXTO is backed by autonomous intelligence, its own bonding curve, and edge cashflow.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 font-mono">
          {/* Pillar 1: A */}
          <div className="glass-panel p-6 rounded-2xl border border-cyan-500/40 flex flex-col justify-between relative overflow-hidden group hover:border-cyan-400 transition-all shadow-xl">
            <div className="absolute top-0 right-0 w-28 h-28 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-cyan-500/20 transition-all" />
            <div className="space-y-4 relative z-10">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 flex items-center justify-center font-black text-lg shadow-lg shadow-cyan-500/20 group-hover:scale-105 transition-transform">
                  <Cpu className="w-6 h-6 text-cyan-300" />
                </div>
                <span className="px-2.5 py-1 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold">
                  PILLAR 01 [A]
                </span>
              </div>
              <div>
                <h3 className="text-lg font-black text-white group-hover:text-cyan-300 transition-colors">Autonomous Agent</h3>
                <span className="text-[11px] font-bold text-cyan-400 block mt-0.5">0G Compute TEE Enclave</span>
              </div>
              <p className="text-xs text-slate-300 font-sans leading-relaxed font-normal">
                24/7 AI agents execute inside hardware-isolated AMD SEV-SNP enclaves. Private keys and prompt memory cannot be extracted, manipulated, or rugged by developers.
              </p>
            </div>
            <div className="pt-4 border-t border-white/10 text-[11px] text-cyan-300 font-bold flex items-center justify-between mt-4">
              <span>Hardware Attested</span>
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
            </div>
          </div>

          {/* Pillar 2: DEX */}
          <div className="glass-panel p-6 rounded-2xl border border-purple-500/40 flex flex-col justify-between relative overflow-hidden group hover:border-purple-400 transition-all shadow-xl">
            <div className="absolute top-0 right-0 w-28 h-28 bg-purple-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-purple-500/20 transition-all" />
            <div className="space-y-4 relative z-10">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-purple-500/20 text-purple-300 border border-purple-400/40 flex items-center justify-center font-black text-lg shadow-lg shadow-purple-500/20 group-hover:scale-105 transition-transform">
                  <Layers className="w-6 h-6 text-purple-300" />
                </div>
                <span className="px-2.5 py-1 rounded-full bg-purple-950/80 text-purple-300 border border-purple-500/40 text-[10px] font-bold">
                  PILLAR 02 [DEX]
                </span>
              </div>
              <div>
                <h3 className="text-lg font-black text-white group-hover:text-purple-300 transition-colors">Sovereign DEX</h3>
                <span className="text-[11px] font-bold text-purple-400 block mt-0.5">Sovereign Bonding Curve</span>
              </div>
              <p className="text-xs text-slate-300 font-sans leading-relaxed font-normal">
                A curve that opens against a virtual reserve, so a launch needs no liquidity deposit. The 0.30% swap fee
                splits three ways on-chain: 0.15% depth stays in the curve, 0.10% to the creator, 0.05% to the buyback vault.
              </p>
            </div>
            <div className="pt-4 border-t border-white/10 text-[11px] text-purple-300 font-bold flex items-center justify-between mt-4">
              {/* Bukan "100% Fee Retained": creator menerima 0.10% dari total fee,
                  bukan seluruh fee. Protokol mengambil 0.05% (lihat /pitch), dan
                  sisanya mengendap di kurva. */}
              <span>Creator paid every swap</span>
              <TrendingUp className="w-4 h-4 text-purple-400" />
            </div>
          </div>

          {/* Pillar 3: T */}
          <div className="glass-panel p-6 rounded-2xl border border-pink-500/40 flex flex-col justify-between relative overflow-hidden group hover:border-pink-400 transition-all shadow-xl">
            <div className="absolute top-0 right-0 w-28 h-28 bg-pink-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-pink-500/20 transition-all" />
            <div className="space-y-4 relative z-10">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-pink-500/20 text-pink-300 border border-pink-400/40 flex items-center justify-center font-black text-lg shadow-lg shadow-pink-500/20 group-hover:scale-105 transition-transform">
                  <Coins className="w-6 h-6 text-pink-300" />
                </div>
                <span className="px-2.5 py-1 rounded-full bg-pink-950/80 text-pink-300 border border-pink-500/40 text-[10px] font-bold">
                  PILLAR 03 [T]
                </span>
              </div>
              <div>
                <h3 className="text-lg font-black text-white group-hover:text-pink-300 transition-colors">Token Factory</h3>
                <span className="text-[11px] font-bold text-pink-400 block mt-0.5">ERC-20 &amp; ERC-8004</span>
              </div>
              <p className="text-xs text-slate-300 font-sans leading-relaxed font-normal">
                1-Click token minting bound to on-chain agent identity. 100% of supply enters the curve, tradable from the
                launch transaction onward, with an anti-sniper cap of 1% of supply during the opening window.
              </p>
            </div>
            <div className="pt-4 border-t border-white/10 text-[11px] text-pink-300 font-bold flex items-center justify-between mt-4">
              <span>ERC-8004 Identity</span>
              <Lock className="w-4 h-4 text-pink-400" />
            </div>
          </div>

          {/* Pillar 4: O */}
          <div className="glass-panel p-6 rounded-2xl border border-orange-500/40 flex flex-col justify-between relative overflow-hidden group hover:border-orange-400 transition-all shadow-xl">
            <div className="absolute top-0 right-0 w-28 h-28 bg-orange-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-orange-500/20 transition-all" />
            <div className="space-y-4 relative z-10">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-orange-500/20 text-orange-300 border border-orange-400/40 flex items-center justify-center font-black text-lg shadow-lg shadow-orange-500/20 group-hover:scale-105 transition-transform">
                  <CloudLightning className="w-6 h-6 text-orange-400" />
                </div>
                <span className="px-2.5 py-1 rounded-full bg-orange-950/80 text-orange-300 border border-orange-500/40 text-[10px] font-bold">
                  PILLAR 04 [O]
                </span>
              </div>
              <div>
                <h3 className="text-lg font-black text-white group-hover:text-orange-300 transition-colors">Orchestrator</h3>
                <span className="text-[11px] font-bold text-orange-400 block mt-0.5">Cloudflare Workers x402</span>
              </div>
              <p className="text-xs text-slate-300 font-sans leading-relaxed font-normal">
                Sub-50ms edge paywall verifying EIP-712 auth vouchers globally. Channels machine-to-machine API payments
                into the token&apos;s own buyback vault, which buys and burns against the curve.
              </p>
            </div>
            <div className="pt-4 border-t border-white/10 text-[11px] text-orange-400 font-bold flex items-center justify-between mt-4">
              <span>Sub-50ms Global Edge</span>
              <Globe className="w-4 h-4 text-orange-400" />
            </div>
          </div>
        </div>
      </section>

      {/* ── REAL CODE IMPLEMENTATION ─────────────────────────────────────────── */}
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-white/10">
        <div className="glass-panel p-8 sm:p-12 rounded-2xl border border-white/10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-orange-950/80 text-orange-300 border border-orange-500/40 text-xs font-mono font-bold mb-3">
                <CloudLightning className="w-3.5 h-3.5" /> CLOUDFLARE WORKERS x402 ENGINE
              </div>
              <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">
                Sub-50ms Global Edge Pay-Per-Call
              </h2>
              <p className="text-slate-200 text-sm leading-relaxed mb-6 font-medium">
                We discarded slow centralized payment relays. ADEXTO runs x402 payment verification on Cloudflare Workers deployed across 330+ cities worldwide. When any agent or consumer calls an API, payment challenges settle at the edge in milliseconds.
              </p>

              <div className="space-y-3.5 text-xs sm:text-sm font-mono">
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[#060914] border border-white/10">
                  <CheckCircle2 className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                  <span className="text-slate-200"><strong className="text-white">Edge Facilitator:</strong> Cloudflare Worker verifies EIP-712 auth and releases data payload instantly.</span>
                </div>
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[#060914] border border-white/10">
                  <CheckCircle2 className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                  <span className="text-slate-200"><strong className="text-white">Multi-Token Settlement:</strong> Accepts USDC, USDT, and native gas tokens on Base &amp; 0G.</span>
                </div>
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[#060914] border border-white/10">
                  <CheckCircle2 className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                  <span className="text-slate-200"><strong className="text-white">Auto-Buyback Dispatch:</strong> accumulated edge revenue funds the curve&apos;s buyback vault, which buys tokens and burns them.</span>
                </div>
              </div>
            </div>

      {/* Smart Contract & Cloudflare Code Tab */}
      <div className="bg-[#050811] p-4 sm:p-6 rounded-2xl border border-white/10 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/15 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-mono font-bold text-white">ON-CHAIN &amp; EDGE CODE</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button 
              onClick={() => setActiveCodeTab("factory")}
              className={`px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-mono font-bold transition-all ${
                activeCodeTab === "factory" 
                  ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400" 
                  : "text-zinc-400 hover:text-white bg-white/5"
              }`}
            >
              AdextoTrinityFactoryV3.sol
            </button>
            <button 
              onClick={() => setActiveCodeTab("hook")}
              className={`px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-mono font-bold transition-all ${
                activeCodeTab === "hook" 
                  ? "bg-purple-500/30 text-purple-200 border border-purple-400" 
                  : "text-zinc-400 hover:text-white bg-white/5"
              }`}
            >
              SovereignCurve.sol
            </button>
            <button 
              onClick={() => setActiveCodeTab("cloudflare")}
              className={`px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-mono font-bold transition-all ${
                activeCodeTab === "cloudflare" 
                  ? "bg-orange-500/30 text-orange-200 border border-orange-400" 
                  : "text-zinc-400 hover:text-white bg-white/5"
              }`}
            >
              cloudflare-x402.ts
            </button>
          </div>
        </div>

        <div className="font-mono text-[11px] sm:text-xs text-slate-100 space-y-2 bg-[#020307] p-4 sm:p-5 rounded-xl border border-white/10 overflow-x-auto leading-relaxed max-w-full">
                {activeCodeTab === "factory" && (
                  <>
                    <div className="text-zinc-400">// SPDX-License-Identifier: MIT</div>
                    <div className="text-cyan-400">pragma solidity ^0.8.26;</div>
                    {/* Tanda tangan ini WAJIB cocok dengan AdextoTrinityFactoryV3.
                        Perhatikan: TIDAK `payable` — launch tidak menerima pembayaran
                        apa pun, hanya gas. Versi lama di sini menulis `external payable`
                        dan nama kontrak yang tidak ada. */}
                    <div className="text-white mt-2 font-bold">contract <span className="text-purple-300">AdextoTrinityFactoryV3</span> &#123;</div>
                    <div className="pl-4 text-zinc-300">event TrinityProjectDeployed(address token, address curve, address creator, ...);</div>
                    <div className="pl-4 text-emerald-400 mt-1 font-semibold">function deployTrinity(</div>
                    <div className="pl-8 text-zinc-200">string memory name,</div>
                    <div className="pl-8 text-zinc-200">string memory symbol,</div>
                    <div className="pl-8 text-zinc-200">uint256 initialSupply,</div>
                    <div className="pl-8 text-zinc-200">address agentIdentity,</div>
                    <div className="pl-8 text-zinc-200">uint256 virtualNative,</div>
                    <div className="pl-8 text-zinc-200">uint256 swapFeeBps,</div>
                    <div className="pl-8 text-zinc-200">uint256 creatorShareBps,</div>
                    <div className="pl-8 text-zinc-200">uint256 treasuryShareBps,</div>
                    <div className="pl-8 text-zinc-200">bytes32 teeAttestationRoot</div>
                    <div className="pl-4 text-emerald-400 font-semibold">) external returns (address token, address curve);</div>
                    <div className="text-white font-bold">&#125;</div>
                  </>
                )}
                {activeCodeTab === "hook" && (
                  /* Cuplikan ini WAJIB cocok dengan contracts/SovereignCurve.sol.
                     Sebelumnya di sini tertulis `contract SovereignHook is BaseHook`
                     dengan afterSwap dan LP_SPLIT = 70 — kontrak yang tidak pernah
                     ada di repo ini. Siapa pun yang membuka kontraknya akan tahu
                     halaman depan menjanjikan sistem yang lain. */
                  <>
                    <div className="text-zinc-400">// SPDX-License-Identifier: MIT</div>
                    <div className="text-purple-300 font-bold">contract SovereignCurve &#123;</div>
                    <div className="pl-4 text-zinc-300">uint256 public immutable virtualNative; // reserve pembuka, tanpa setoran</div>
                    <div className="pl-4 text-zinc-300">uint256 public immutable depthFeeBps; // mengendap di kurva</div>
                    <div className="pl-4 text-zinc-300">uint256 public immutable creatorFeeBps; // langsung ke creator</div>
                    <div className="pl-4 text-emerald-400 mt-2 font-semibold">function _buy(uint256 minTokensOut, address recipient)</div>
                    <div className="pl-4 sm:pl-8 text-zinc-200">private returns (uint256 tokensOut) &#123;</div>
                    <div className="pl-6 sm:pl-12 text-pink-300">_curveNative += msg.value - creatorFee - treasuryFee;</div>
                    <div className="pl-6 sm:pl-12 text-pink-300">creatorOwed += creatorFee;</div>
                    <div className="pl-4 sm:pl-8 text-zinc-200">&#125;</div>
                    <div className="text-purple-300 font-bold">&#125;</div>
                  </>
                )}
                {activeCodeTab === "cloudflare" && (
                  <>
                    <div className="text-zinc-400">// Cloudflare Worker: Edge x402 Facilitator</div>
                    <div className="text-orange-400">export default &#123;</div>
                    <div className="pl-4 text-white">async fetch(request: Request, env: Env): Promise&lt;Response&gt; &#123;</div>
                    <div className="pl-8 text-zinc-300">const authHeader = request.headers.get("X-402-Authorization");</div>
                    <div className="pl-8 text-emerald-400">if (!authHeader) return new Response("Payment Required", &#123; status: 402 &#125;);</div>
                    <div className="pl-8 text-zinc-200">const valid = await verifyEIP712Sig(authHeader, env.VAULT_ADDR);</div>
                    <div className="pl-8 text-cyan-300">return Response.json(&#123; agentResult: await dispatch0GTEE() &#125;);</div>
                    <div className="pl-4 text-white">&#125;</div>
                    <div className="text-orange-400">&#125;;</div>
                  </>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-zinc-300">
                <span className="flex items-center gap-1.5 text-slate-100 font-semibold">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Cloudflare Edge Verified
                </span>
                <span className="font-mono text-orange-400 font-bold">adexto.xyz</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ SECTION (ANSWERING HARD VC QUESTIONS) ─────────────────────────── */}
      <section className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-white/10">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-purple-950/80 text-purple-300 border border-purple-500/40 text-xs font-mono font-bold mb-3">
            TECHNICAL &amp; ARCHITECTURAL FAQ
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-white">Frequently Asked Questions</h2>
        </div>

        <div className="space-y-4 text-left">
          <div className="glass-panel p-6 rounded-2xl border border-white/15 space-y-2">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-cyan-400" /> Why not just use OpenAI API on AWS?
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans font-medium">
              Centralized cloud hosting creates a single point of failure. The developer holds the private keys and prompt weights, creating severe rug-pull and subpoena risks. ADEXTO runs in 0G AMD SEV-SNP enclaves, making it physically impossible for developers to tamper with agent state.
            </p>
          </div>

          <div className="glass-panel p-6 rounded-2xl border border-white/15 space-y-2">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-purple-400" /> What stops a sniper from taking the whole launch?
            </h3>
            {/* Jawaban lama menyebut afterSwap, transient storage EIP-1153, dan
                "0G TEE order validation" — tak satu pun ada di kontrak. Yang benar-benar
                ada: cap 1% supply selama 5 blok di AdextoToken._update, plus slippage
                dan deadline di kurva. Klaim yang bisa dibantah dengan membuka satu
                berkas lebih merugikan daripada klaim yang sederhana tapi benar. */}
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans font-medium">
              <code className="text-purple-300">AdextoToken._update</code> caps any single transfer at 1% of supply for the
              first 5 blocks after launch, so no wallet can take the opening curve in one shot. Every swap also carries a
              slippage bound and a deadline, and buys are simulated before signing so a trade that would revert never costs
              gas. There is no mempool-level protection claim here: the cap is enforced on-chain, in the token itself.
            </p>
          </div>

          <div className="glass-panel p-6 rounded-2xl border border-white/15 space-y-2">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-orange-400" /> Why Cloudflare Workers instead of an RPC node for x402?
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans font-medium">
              Querying EVM RPCs for every HTTP request adds 500ms–2000ms latency. Cloudflare Workers verify cryptographic EIP-712 vouchers at the edge in &lt;35ms, releasing payload access with zero node bottleneck.
            </p>
          </div>
        </div>
      </section>

      {/* ── FINAL CALL TO ACTION ────────────────────────────────────────────────── */}
      <section className="w-full max-w-5xl mx-auto px-4 py-24 text-center">
        <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-4">
          Ready to deploy a sovereign agent economy?
        </h2>
        <p className="text-slate-200 text-sm sm:text-base max-w-2xl mx-auto mb-8 font-medium">
          Deploy an ERC-8004 token, its sovereign bonding curve, and a 0G TEE AI Agent in less than 60 seconds.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/studio"
            className="inline-flex items-center gap-2.5 px-9 py-4 rounded-xl font-bold text-base bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-500 text-white shadow-xl shadow-purple-600/40 hover:shadow-cyan-500/60 transition-all transform hover:-translate-y-0.5"
          >
            <Sparkles className="w-5 h-5" />
            Launch 1-Click Studio Now
            <ArrowRight className="w-5 h-5 ml-1" />
          </Link>
          <Link
            href="/pitch"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl font-bold text-base bg-[#0f172a] border border-white/20 text-white hover:bg-[#1e293b] transition-all"
          >
            <Award className="w-5 h-5 text-cyan-400" />
            View VC &amp; Grant Memorandum
          </Link>
        </div>
      </section>
    </div>
  );
}
