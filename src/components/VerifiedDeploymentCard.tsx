"use client";

import { useState } from "react";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { GRAPH_STUDIO_CONFIG } from "@/config/subgraph";
import { 
  CheckCircle2, ExternalLink, ShieldCheck, Database, Copy, Check, 
  Cpu, Layers, Sparkles 
} from "lucide-react";

export default function VerifiedDeploymentCard() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const records = [
    {
      label: "Cloudflare Workers x402 Edge Paywall Gateway",
      address: ADEXTO_CONTRACTS.edgeX402Gateway,
      explorerUrl: ADEXTO_CONTRACTS.edgeX402Gateway,
      badge: "HTTP 402 Edge Active",
      color: "border-orange-500/40 bg-orange-950/20 text-orange-300",
    },
    {
      label: "AdextoTrinityFactory (1-Click Atomic Deployer)",
      address: ADEXTO_CONTRACTS.factoryAddress,
      explorerUrl: `https://chainscan.0g.ai/address/${ADEXTO_CONTRACTS.factoryAddress}`,
      badge: "Factory Contract",
      color: "border-cyan-500/40 bg-cyan-950/20 text-cyan-300",
    },
    {
      label: "AdextoGovernor (DAO On-Chain Voting Phase 2)",
      address: ADEXTO_CONTRACTS.governorAddress,
      explorerUrl: `https://chainscan.0g.ai/address/${ADEXTO_CONTRACTS.governorAddress}`,
      badge: "DAO Governor Live",
      color: "border-purple-500/40 bg-purple-950/20 text-purple-300",
    },
    {
      label: "The Graph Subgraph (Decentralized Network Mainnet)",
      address: GRAPH_STUDIO_CONFIG.subgraphId,
      explorerUrl: GRAPH_STUDIO_CONFIG.explorerUrl,
      badge: "The Graph Published",
      color: "border-pink-500/40 bg-pink-950/20 text-pink-300",
    },
    {
      label: "SovereignHook (Uniswap v4 AMM Fee Splitter)",
      address: ADEXTO_CONTRACTS.sovereignHookAddress,
      explorerUrl: `https://chainscan.0g.ai/address/${ADEXTO_CONTRACTS.sovereignHookAddress}`,
      badge: "Uniswap v4 Hook",
      color: "border-cyan-500/40 bg-cyan-950/20 text-cyan-300",
    },
    {
      label: "0G DA Storage Attestation Root (Metadata Flow)",
      address: "0xeaa56a1fe9b216f0f58cc0957c8d4793451c69a423c5a73ad6e420749eb4509d",
      explorerUrl: `https://chainscan.0g.ai/tx/0xcfac6cd412f69cefeb2d509edf5dbdeef5dc0fb4613932223b99a4ce535b8c55`,
      badge: "0G DA Storage Turbo",
      color: "border-emerald-500/40 bg-emerald-950/20 text-emerald-300",
    },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="glass-panel p-6 sm:p-8 rounded-3xl border-2 border-cyan-500/30 bg-[#060a17]/90 shadow-2xl relative overflow-hidden">
        {/* Glow Accent */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6 mb-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 text-xs font-mono font-bold mb-2">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>LIVE ON-CHAIN &amp; HARDWARE ATTESTED</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
              <span>0G Mainnet (Chain ID 16661) Verified Contracts</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1">
              Smart contracts and storage roots deployed and permanently anchored to the 0G ecosystem.
            </p>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-[#0a1226] border border-white/10 text-slate-300">
              RPC: <span className="text-cyan-300 font-bold">evmrpc.0g.ai</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-[#0a1226] border border-white/10 text-slate-300">
              DA: <span className="text-emerald-400 font-bold">indexer-turbo</span>
            </div>
          </div>
        </div>

        {/* Verification Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
          {records.map((rec, i) => {
            const isCopied = copiedKey === `rec_${i}`;
            return (
              <div 
                key={i} 
                className="p-3.5 sm:p-4 rounded-2xl bg-[#040814] border border-white/10 hover:border-cyan-400/50 transition-all flex flex-col justify-between group overflow-hidden max-w-full"
              >
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
                    <span className="text-slate-300 font-sans font-bold text-xs truncate max-w-[200px] sm:max-w-none">{rec.label}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${rec.color}`}>
                      {rec.badge}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#02050e] border border-white/5 text-slate-200 text-[11px] sm:text-xs break-all flex items-center justify-between gap-2 overflow-hidden">
                    <span className="text-cyan-300 font-semibold break-all">{rec.address}</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 mt-3 pt-2 border-t border-white/5 text-[11px]">
                  <button
                    onClick={() => copyToClipboard(rec.address, `rec_${i}`)}
                    className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
                  >
                    {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{isCopied ? "Copied" : "Copy"}</span>
                  </button>
                  <a
                    href={rec.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-bold hover:underline"
                  >
                    <span>Verify on Explorer</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
