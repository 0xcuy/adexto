import Link from "next/link";
import VerifiedDeploymentCard from "@/components/VerifiedDeploymentCard";
import { ShieldCheck, Cpu, Database, Zap, Lock, Terminal, Layers, Sparkles, CloudLightning, Award, Network, Globe } from "lucide-react";

export default function DocsPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      {/* Header */}
      <div className="border-b-2 border-white/20 pb-6 mb-10">
        <div className="kicker mb-3">DEVELOPER ECOSYSTEM &amp; INTEGRATION SPEC</div>
        <h1 className="text-3xl sm:text-4xl font-black text-white">ADEXTO Enterprise Multi-Chain Infrastructure</h1>
        {/* Jangan mendaftar World ID ZKP dan Chainlink CCIP sebagai bagian arsitektur
            yang berjalan: seksi "status jujur" di bawah menyatakan keduanya BELUM aktif.
            Header yang membantah isi halamannya sendiri lebih merusak kepercayaan
            daripada daftar yang lebih pendek. */}
        <p className="text-sm text-slate-200 mt-2 font-medium">Production-grade architecture uniting 0G TEE Compute, sovereign bonding curves, The Graph Network, and Cloudflare Workers x402. World ID and Chainlink CCIP are designed for but not yet active — see the status note below.</p>
      </div>

      {/* Enterprise Architecture Stack */}
      <div className="section-block mb-4 space-y-5">
        <div className="kicker">
          <Award className="w-4 h-4 text-emerald-400" />
          <span>PRODUCTION ARCHITECTURE &amp; PROTOCOL COMPOSITION</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Enterprise Infrastructure Layer</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs font-medium">
          <div className="p-4 rounded-xl bg-[#070a14] border border-cyan-500/30 space-y-1.5">
            <strong className="text-cyan-300 block font-bold text-sm">0G Compute &amp; DA Turbo</strong>
            <p className="text-slate-300">Hardware TEE compute on AMD SEV-SNP (anti-rug agent) + 50GB/s decentralized data availability and long-term memory storage.</p>
          </div>

          <div className="p-4 rounded-xl bg-[#070a14] border border-purple-500/30 space-y-1.5">
            <strong className="text-purple-300 block font-bold text-sm">Sovereign Bonding Curve</strong>
            <p className="text-slate-300">A standalone <code className="text-purple-300">SovereignCurve</code> per token, opening against a virtual reserve so no liquidity deposit is needed. Each swap splits the fee three ways on-chain: depth stays in the curve, the creator is paid directly, and the rest funds agent buybacks.</p>
          </div>

          <div className="p-4 rounded-xl bg-[#070a14] border border-pink-500/30 space-y-1.5">
            <strong className="text-pink-300 block font-bold text-sm">The Graph Decentralized Network</strong>
            <p className="text-slate-300">Custom subgraphs indexing factory deployments, curve depth, swap transactions, and real-time treasury buyback burns.</p>
          </div>

          <div className="p-4 rounded-xl bg-[#070a14] border border-orange-500/30 space-y-1.5">
            <strong className="text-orange-300 block font-bold text-sm">Cloudflare Workers x402</strong>
            <p className="text-slate-300">Sub-50ms edge pay-per-call micropayments settling EIP-712 auth vouchers across 330+ edge locations globally.</p>
          </div>

          <div className="p-4 rounded-xl bg-[#070a14] border border-blue-500/30 space-y-1.5">
            <strong className="text-blue-300 block font-bold text-sm">Buyback execution</strong>
            <p className="text-slate-300">
              Treasury buybacks execute against the token&apos;s own curve and burn the tokens they buy. There is no external
              router in the path, so a buyback cannot be sandwiched on a venue we do not control.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#070a14] border border-amber-500/30 space-y-1.5">
            <strong className="text-amber-300 block font-bold text-sm">Planned: Sybil resistance, cross-chain &amp; aggregator routing</strong>
            {/* 1inch dipindahkan ke sini. Sebelumnya "1inch Fusion & AMM Routing"
                terdaftar sebagai lapisan infrastruktur yang berjalan, padahal string
                "1inch" tidak ada di kontrak, skrip, maupun kode aplikasi mana pun —
                hanya di halaman ini. */}
            <p className="text-slate-300">
              The launch gate today is a server-verified wallet signature, not a World ID zero-knowledge proof. Cross-chain
              treasury routing is also not active: Chainlink CCIP publishes no router on 0G or Monad, so those lanes cannot
              be opened yet. Aggregator routing (1inch Fusion) is designed for but not integrated.
            </p>
          </div>
        </div>
      </div>

      {/* Bonding Curve Pricing Mechanics */}
      <div className="section-block mb-4 space-y-5">
        <div className="kicker">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span>ON-CHAIN PRICING &amp; BONDING CURVE SPECIFICATION</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">How Token Pricing &amp; Sovereign Curves Work</h2>
        
        <div className="space-y-4 text-xs text-slate-200 leading-relaxed font-medium">
          <p>
            Unlike traditional launchpads where an admin dictates prices or drains exit liquidity, ADEXTO enforces <strong>deterministic on-chain pricing</strong> governed entirely by the token&apos;s own bonding curve:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs pt-2">
            <div className="p-4 rounded-xl bg-[#070a14] border border-cyan-500/30 space-y-2">
              <span className="text-cyan-300 font-bold block text-sm">1. Market-Driven Price</span>
              <p className="text-slate-300 font-sans text-xs">
                Prices are determined 100% algorithmically by supply and demand. Every buy order locks native currency (0G / ETH) and releases tokens along the exponential curve.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#070a14] border border-purple-500/30 space-y-2">
              <span className="text-purple-300 font-bold block text-sm">2. Tradable From Block One</span>
              <p className="text-slate-300 font-sans text-xs">
                The factory deploys the token and its curve in one transaction, opening against a virtual reserve. Zero
                creator capital: the launch costs gas and nothing else, and 100% of supply sits in the curve.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#070a14] border border-pink-500/30 space-y-2">
              <span className="text-pink-300 font-bold block text-sm">3. 0G TEE Auto-Buyback</span>
              <p className="text-slate-300 font-sans text-xs">
                On the default 0.30% tier, 0.05% of every swap routes to the token&apos;s 0G TEE Agent treasury, which buys
                tokens back and burns them. A separate 0.10% goes to the creator, and 0.15% of depth stays in the curve —
                that retained depth is what lifts the price floor as volume accumulates.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Delapan kartu di bawah sebelumnya mengapung tanpa judul seksi, sementara
          semua seksi lain punya kicker + judul. Hierarkinya jadi timpang. */}
      <div className="mb-5 mt-2">
        <div className="kicker">Protocol surface · MCP tools &amp; standards</div>
        <h2 className="mt-2 text-2xl sm:text-3xl font-black tracking-tight text-white">
          What each component actually does
        </h2>
      </div>

      {/* Grid of MCP tools */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        {/* Signet */}
        <div className="card card-hover p-5 space-y-3">
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
        <div className="card card-hover p-5 space-y-3">
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
            sentinel_verify_calldata({`{ target: "0xCurve...", value: 0 }`})
          </div>
        </div>

        {/* Helm */}
        <div className="card card-hover p-5 space-y-3">
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
            helm_register_cron({`{ interval: "15m", action: "rebalance_curve" }`})
          </div>
        </div>

        {/* Aegis & Notary */}
        <div className="card card-hover p-5 space-y-3">
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

      {/* ── ADVANCED PROTOCOL SPECIFICATIONS ────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        {/* Spec 1: Multi-chain launch model */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-300 flex items-center justify-center border border-cyan-500/40">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Multi-chain launch</h3>
              <span className="text-xs font-mono text-cyan-300 font-bold">One independent market per chain</span>
            </div>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed font-medium">
            A launch can target 1–4 chains in one flow. Each selected chain receives its own{" "}
            <code className="text-cyan-300">AdextoToken</code> and its own{" "}
            <code className="text-cyan-300">SovereignCurve</code>, deployed by that chain&apos;s factory in a single
            transaction. Addresses differ per chain and <strong>supply is not shared</strong>: there is no bridge, so each
            market has its own depth and its own price.
          </p>
          <div className="p-2.5 rounded-lg bg-[#070a14] border border-white/10 font-mono text-[11px] text-zinc-300 space-y-1">
            <div>per chain: token + bonding curve (virtual reserve, no deposit)</div>
            <div className="text-amber-300">
              cross-chain supply would need a messaging layer on every chain; CCIP and LayerZero have no endpoint on 0G or
              Monad today.
            </div>
          </div>
        </div>

        {/* Spec 2: ERC-8004 AI Agent Identity Standard */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-pink-500/20 text-pink-300 flex items-center justify-center border border-pink-500/40">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">ERC-8004 Token Standard</h3>
              <span className="text-xs font-mono text-pink-300 font-bold">Anti-Sniper &amp; Enclave-Bound Execution</span>
            </div>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed font-medium">
            Enforces a strict 1% supply transaction limit during the first 5 blocks to eliminate MEV bot snipers. Grants atomic <code className="text-pink-300">executeTreasuryBuyback()</code> authorization exclusively to the token&apos;s verified 0G TEE Agent address.
          </p>
          <div className="p-2.5 rounded-lg bg-[#070a14] border border-white/10 font-mono text-[11px] text-zinc-300">
            modifier onlyAgent() &#123; require(msg.sender == agentIdentity); _ &#125;
          </div>
        </div>

        {/* Spec 3: Cloudflare Workers x402 Micropayments */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-500/20 text-orange-300 flex items-center justify-center border border-orange-500/40">
              <CloudLightning className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Cloudflare x402 Protocol Flow</h3>
              <span className="text-xs font-mono text-orange-300 font-bold">Sub-50ms Edge Monetization (HTTP 402)</span>
            </div>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed font-medium">
            Secures Agent inference APIs behind HTTP 402 Payment Required status. Users provide cryptographic EIP-712 payment signatures, settled trustlessly at 330+ edge PoPs without incurring blockchain gas latency.
          </p>
          <div className="p-2.5 rounded-lg bg-[#070a14] border border-white/10 font-mono text-[11px] text-zinc-300">
            Authorization: x402-v1 EIP712Sig(0x1234...USDC)
          </div>
        </div>

        {/* Spec 4: Subdomain Dynamic Rewrite & On-Chain DAO */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-300 flex items-center justify-center border border-purple-500/40">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Subdomain Rewrite &amp; DAO Specs</h3>
              <span className="text-xs font-mono text-purple-300 font-bold">Edge Routing &amp; AdextoGovernor</span>
            </div>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed font-medium">
            Edge middleware translates <code className="text-purple-300">[token].adexto.xyz</code> into dedicated sovereign terminal workspaces. Governed on-chain with 4M ADAI quorum and 100k ADAI proposal threshold.
          </p>
          <div className="p-2.5 rounded-lg bg-[#070a14] border border-white/10 font-mono text-[11px] text-zinc-300">
            Quorum: 4,000,000 ADAI | Voting Period: 3 Days
          </div>
        </div>
      </div>

      {/* 0G TEE Architecture Section */}
      <section className="section-block space-y-4">
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
