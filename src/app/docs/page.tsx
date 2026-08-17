import Link from "next/link";
import VerifiedDeploymentCard from "@/components/VerifiedDeploymentCard";
import { ShieldCheck, Cpu, Database, Zap, Lock, Terminal, Layers, Sparkles, CloudLightning, Award, Network, Globe } from "lucide-react";

export default function DocsPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      {/* Header */}
      <div className="border-b-2 border-white/20 pb-6 mb-10">
        <div className="text-xs font-mono text-cyan-300 font-bold mb-2">DEVELOPER ECOSYSTEM &amp; INTEGRATION SPEC</div>
        <h1 className="text-3xl sm:text-4xl font-black text-white">ADEXTO Multi-Chain &amp; ETHOnline 2026 Stack</h1>
        <p className="text-sm text-slate-200 mt-2 font-medium">Complete architecture uniting 0G TEE Compute, Uniswap v4 Hooks, The Graph, 1inch, World ID, Chainlink, and Cloudflare Workers x402.</p>
      </div>

      {/* Sponsor Matrix Section */}
      <div className="glass-panel p-8 rounded-3xl border-2 border-white/20 mb-12 space-y-6 shadow-2xl">
        <div className="flex items-center gap-2 text-xs font-mono text-cyan-300 font-bold">
          <Award className="w-4 h-4 text-emerald-400" />
          <span>ETHONLINE 2026 ARCHITECTURE MATRIX ($77,000 TOTAL BOUNTY TRACK)</span>
        </div>
        <h2 className="text-2xl font-black text-white">Native Multi-Sponsor Composition</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs font-medium">
          <div className="p-4 rounded-xl bg-[#070a14] border border-cyan-500/30 space-y-1.5">
            <strong className="text-cyan-300 block font-bold text-sm">0G ($15,000)</strong>
            <p className="text-slate-300">Hardware TEE compute on AMD SEV-SNP (anti-rug agent) + 50GB/s decentralized data availability and long-term memory storage.</p>
          </div>

          <div className="p-4 rounded-xl bg-[#070a14] border border-purple-500/30 space-y-1.5">
            <strong className="text-purple-300 block font-bold text-sm">Uniswap Foundation ($5,000)</strong>
            <p className="text-slate-300">Custom Uniswap v4 Sovereign Hooks intercepting <code className="text-purple-300">afterSwap()</code> to split 0.20% LP fees and 0.10% buybacks.</p>
          </div>

          <div className="p-4 rounded-xl bg-[#070a14] border border-pink-500/30 space-y-1.5">
            <strong className="text-pink-300 block font-bold text-sm">The Graph ($15,000)</strong>
            <p className="text-slate-300">Custom subgraphs indexing factory deployments, pool depth, swap transactions, and real-time treasury buyback burns.</p>
          </div>

          <div className="p-4 rounded-xl bg-[#070a14] border border-orange-500/30 space-y-1.5">
            <strong className="text-orange-300 block font-bold text-sm">Cloudflare Workers x402</strong>
            <p className="text-slate-300">Sub-50ms edge pay-per-call micropayments settling EIP-712 auth vouchers across 330+ edge locations globally.</p>
          </div>

          <div className="p-4 rounded-xl bg-[#070a14] border border-blue-500/30 space-y-1.5">
            <strong className="text-blue-300 block font-bold text-sm">1inch API ($7,000)</strong>
            <p className="text-slate-300">Optimal multi-path liquidity routing for automated agent treasury buybacks on secondary markets.</p>
          </div>

          <div className="p-4 rounded-xl bg-[#070a14] border border-emerald-500/30 space-y-1.5">
            <strong className="text-emerald-300 block font-bold text-sm">World ID &amp; Chainlink ($10,000)</strong>
            <p className="text-slate-300">World ID proof-of-human anti-sybil bonding curve gating + Chainlink CCIP for cross-chain treasury bridging.</p>
          </div>
        </div>
      </div>

      {/* Grid of MCP tools */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        {/* Signet */}
        <div className="glass-panel p-6 rounded-2xl border-2 border-white/20 space-y-3 shadow-2xl">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-300 flex items-center justify-center border border-cyan-500/40">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">EVIDIQ Signet MCP</h3>
              <span className="text-xs font-mono text-zinc-300 font-bold">Deterministic Branding Generator</span>
            </div>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed font-medium">
            Generates pixel-perfect SVG logos, favicon sets, and OpenGraph social cards directly in memory without GPU overhead. Stores generated hashes permanently onto 0G Storage.
          </p>
          <div className="p-3 rounded-lg bg-[#070a14] border border-white/15 font-mono text-xs text-cyan-300 font-bold">
            signet_generate_brand({`{ name: "Adexto", palette: "cyber" }`})
          </div>
        </div>

        {/* Sentinel */}
        <div className="glass-panel p-6 rounded-2xl border-2 border-white/20 space-y-3 shadow-2xl">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-300 flex items-center justify-center border border-purple-500/40">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">EVIDIQ Sentinel MCP</h3>
              <span className="text-xs font-mono text-zinc-300 font-bold">On-Chain Transaction Firewall</span>
            </div>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed font-medium">
            Inspects every raw calldata payload before the agent signs it. Rejects unbounded token approvals, flash-loan vulnerabilities, and prompt injection drain attacks.
          </p>
          <div className="p-3 rounded-lg bg-[#070a14] border border-white/15 font-mono text-xs text-purple-300 font-bold">
            sentinel_verify_calldata({`{ target: "0xUniswap...", value: 0 }`})
          </div>
        </div>

        {/* Helm */}
        <div className="glass-panel p-6 rounded-2xl border-2 border-white/20 space-y-3 shadow-2xl">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-pink-500/20 text-pink-300 flex items-center justify-center border border-pink-500/40">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">EVIDIQ Helm MCP</h3>
              <span className="text-xs font-mono text-zinc-300 font-bold">Decentralized Autonomous Scheduler</span>
            </div>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed font-medium">
            Provides reliable 24/7 cron intervals inside 0G TEE without relying on centralized crontabs. Automatically triggers liquidity rebalancing and treasury buybacks.
          </p>
          <div className="p-3 rounded-lg bg-[#070a14] border border-white/15 font-mono text-xs text-pink-300 font-bold">
            helm_register_cron({`{ interval: "15m", action: "rebalance_pool" }`})
          </div>
        </div>

        {/* Aegis & Notary */}
        <div className="glass-panel p-6 rounded-2xl border-2 border-white/20 space-y-3 shadow-2xl">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center border border-emerald-500/40">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">EVIDIQ Aegis &amp; Notary</h3>
              <span className="text-xs font-mono text-zinc-300 font-bold">EIP-191 Cryptographic Receipts</span>
            </div>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed font-medium">
            Signs every agent inference and trading decision with the agent's enclave key (`0x8a3c...ee7D`), anchoring the cryptographic proof directly to 0G DA and Storage.
          </p>
          <div className="p-3 rounded-lg bg-[#070a14] border border-white/15 font-mono text-xs text-emerald-300 font-bold">
            notary_anchor_receipt({`{ root: "0xa793...", chain: "0g-mainnet" }`})
          </div>
        </div>
      </div>

      {/* 0G TEE Architecture Section */}
      <section className="glass-panel p-8 rounded-2xl border-2 border-white/20 space-y-4 shadow-2xl">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Cpu className="w-5 h-5 text-cyan-400" />
          0G Private Computer (TEE) Hardware Specification
        </h2>
        <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-medium">
          ADEXTO agents execute within Intel SGX / AMD SEV-SNP enclaves provisioned by 0G Private Computer. The agent private keys never leave the secure hardware boundary, ensuring zero developer tampering and strict compliance for institutional VC capital.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs pt-2">
          <div className="p-3.5 rounded-lg bg-[#070a14] border border-white/15">
            <span className="text-zinc-400 block text-[11px] font-bold">Inference Host</span>
            <span className="text-cyan-300 font-bold text-sm">pc.0g.ai/v1</span>
          </div>
          <div className="p-3.5 rounded-lg bg-[#070a14] border border-white/15">
            <span className="text-zinc-400 block text-[11px] font-bold">Attestation Protocol</span>
            <span className="text-purple-300 font-bold text-sm">Remote Quote SEV-SNP</span>
          </div>
          <div className="p-3.5 rounded-lg bg-[#070a14] border border-white/15">
            <span className="text-zinc-400 block text-[11px] font-bold">Settlement Asset</span>
            <span className="text-emerald-300 font-bold text-sm">USDC (EIP-3009) / USDT0</span>
          </div>
        </div>
      </section>

      {/* ── ON-CHAIN DEPLOYMENT VERIFICATION ────────────────────────── */}
      <div className="-mx-4 sm:-mx-6 lg:-mx-8 mt-10">
        <VerifiedDeploymentCard />
      </div>
    </div>
  );
}
