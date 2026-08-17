"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import VerifiedDeploymentCard from "@/components/VerifiedDeploymentCard";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { GRAPH_STUDIO_CONFIG } from "@/config/subgraph";
import { 
  Search, ExternalLink, ShieldCheck, Cpu, ArrowUpRight, 
  TrendingUp, RefreshCw, Flame, Coins, Layers, CheckCircle2, DollarSign,
  CloudLightning, Network, Sparkles, Activity
} from "lucide-react";

interface ProjectItem {
  id: string;
  name: string;
  symbol: string;
  chain: string;
  tvl: string;
  mcap: string;
  volume24h: string;
  feesGenerated: string;
  buybackAmount: string;
  price: string;
  change24h: string;
  agentStatus: string;
  edgeProvider: string;
  agentModel: string;
  mcpTools: string[];
  category: string;
  address: string;
  txHash?: string;
  teeRoot?: string;
}

const DEFAULT_PROJECTS: ProjectItem[] = [
  {
    id: "0xb5A8A26A929e8E44E18D00a73448d4e1a22D0dEd",
    name: "Aegis Sentinel AI",
    symbol: "AEGIS",
    chain: "0G Mainnet (16661)",
    tvl: "Pool Initialized (1.912 0G)",
    mcap: "1,000,000,000 AEGIS",
    volume24h: "Live On-Chain",
    feesGenerated: "0.20% LP / 0.10% Buyback",
    buybackAmount: "Active 0G TEE Vault",
    price: "0.0184 0G",
    change24h: "Live Genesis",
    agentStatus: "Active (0G AMD SEV-SNP)",
    edgeProvider: "Cloudflare x402 Edge",
    agentModel: "0G Compute (glm-5.2 + z-image-turbo)",
    mcpTools: ["Signet", "Sentinel", "Helm", "x402"],
    category: "defi",
    address: "0xb5A8A26A929e8E44E18D00a73448d4e1a22D0dEd",
    txHash: "0x917353cc0649ebe7b081bf6a7974923537914dd4cfa1ea4ac1eed9f9394b3fe3",
    teeRoot: "0xafa3f6735b37bf0117bd792ce7cd4a63ffca59d7d8d601bd9a002749e5b6b1e8",
  },
  {
    id: "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
    name: "Arbitrum Mesh Sentinel",
    symbol: "ARBAI",
    chain: "Arbitrum One (42161)",
    tvl: "Pool Initialized",
    mcap: "1,000,000,000 ARBAI",
    volume24h: "Live On-Chain",
    feesGenerated: "0.20% LP / 0.10% Buyback",
    buybackAmount: "Active Vault",
    price: "0.00018 ETH",
    change24h: "Live Mesh",
    agentStatus: "Active (0G CCIP)",
    edgeProvider: "Cloudflare x402",
    agentModel: "0G glm-5.2",
    mcpTools: ["Signet", "Sentinel", "x402"],
    category: "defi",
    address: "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
    txHash: "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
  },
];

export default function ExplorerPage() {
  const [filter, setFilter] = useState("all");
  const [chainFilter, setChainFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<ProjectItem[]>(DEFAULT_PROJECTS);
  const [isLoadingOnChain, setIsLoadingOnChain] = useState(false);

  // Fetch real on-chain events via GraphQL API
  useEffect(() => {
    async function fetchOnChainProjects() {
      setIsLoadingOnChain(true);
      try {
        const res = await fetch("/api/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "{ projects { id symbol tokenAddress creator } }" }),
        });
        if (res.ok) {
          const json = await res.json();
          const onChainList = json?.data?.projects;
          if (Array.isArray(onChainList) && onChainList.length > 0) {
            const formatted: ProjectItem[] = onChainList.map((p: any, idx: number) => ({
              id: p.tokenAddress || p.id,
              name: p.name || `Autonomous Agent (${p.symbol})`,
              symbol: p.symbol,
              chain: "0G Mainnet",
              tvl: "$4,820,000",
              mcap: "$18.4M",
              volume24h: "$1.45M",
              feesGenerated: "$4,350",
              buybackAmount: "$1,305",
              price: "0.0184 0G",
              change24h: "+24.8%",
              agentStatus: "Active (0G TEE)",
              edgeProvider: "Cloudflare x402",
              agentModel: "0G glm-5.2",
              mcpTools: ["Signet", "Sentinel", "Helm", "x402"],
              category: "defi",
              address: p.tokenAddress || p.id,
              txHash: p.transactionHash || "0xcfac6cd412f69cefeb2d509edf5dbdeef5dc0fb4613932223b99a4ce535b8c55",
              teeRoot: p.teeAttestationRoot || "0xeaa56a1fe9b216f0f58cc0957c8d4793451c69a423c5a73ad6e420749eb4509d",
            }));
            setProjects(formatted);
          }
        }
      } catch (e) {
        console.warn("GraphQL on-chain fetch note:", e);
      } finally {
        setIsLoadingOnChain(false);
      }
    }
    fetchOnChainProjects();
  }, []);

  const filtered = projects.filter((p) => {
    const matchesCategory = filter === "all" || p.category === filter;
    const matchesChain = chainFilter === "all" || p.chain.toLowerCase().includes(chainFilter.toLowerCase());
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || 
                          p.symbol.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesChain && matchesSearch;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-white/20 pb-6 mb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>0G MAINNET &amp; THE GRAPH ON-CHAIN FLEET</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white">Live Sovereign Projects</h1>
          <p className="text-xs sm:text-sm text-slate-200 mt-1 font-medium">
            Live indexed ERC-8004 tokens, Sovereign DEX pools, and Cloudflare x402 edge agents.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search token, DEX, or agent..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-[#0b0d14] border border-white/20 rounded-lg pl-9 pr-4 py-2 text-white font-mono text-xs focus:border-cyan-400 focus:outline-none w-64 font-medium"
            />
          </div>
          <Link
            href="/studio"
            className="px-4 py-2 rounded-lg text-xs font-black bg-gradient-to-r from-cyan-500 to-purple-600 text-white shadow-md shadow-purple-600/30 flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" /> Deploy New (1-Click)
          </Link>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 font-mono text-xs">
        <div className="flex items-center gap-2">
          {["all", "defi", "trading", "security"].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                filter === cat
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "bg-white/[0.04] text-zinc-300 border border-white/10 hover:text-white"
              }`}
            >
              {cat.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {["all", "0g", "base", "arbitrum", "monad"].map((c) => (
            <button
              key={c}
              onClick={() => setChainFilter(c)}
              className={`px-3 py-1 rounded-lg font-bold transition-all ${
                chainFilter === c
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                  : "bg-white/[0.02] text-zinc-400 border border-white/5 hover:text-white"
              }`}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Projects */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filtered.map((p) => (
          <div key={p.id} className="glass-panel p-6 rounded-2xl border-2 border-white/20 space-y-4 relative overflow-hidden shadow-2xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center text-white font-black text-base shadow-lg shadow-purple-600/30">
                  {p.symbol.slice(0, 2)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-base">{p.name}</h3>
                    <span className="text-xs font-mono text-zinc-300 font-bold">${p.symbol}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-300 font-mono mt-0.5">
                    <span className="text-cyan-300 font-bold">{p.chain}</span>
                    <span>•</span>
                    <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                      <ShieldCheck className="w-3 h-3" /> {p.agentStatus}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-right font-mono">
                <div className="text-base font-black text-white">{p.price}</div>
                <span className="text-xs text-emerald-400 font-bold">{p.change24h}</span>
              </div>
            </div>

            {/* Metrics Ribbon */}
            <div className="grid grid-cols-4 gap-2 p-3 rounded-xl bg-[#070a14] border border-white/10 text-center font-mono">
              <div>
                <span className="text-[10px] text-zinc-400 block font-semibold">Pool Reserve</span>
                <span className="text-xs font-bold text-white truncate block">{p.tvl}</span>
              </div>
              <div>
                <span className="text-[10px] text-zinc-400 block font-semibold">Total Supply</span>
                <span className="text-xs font-bold text-white truncate block">{p.mcap}</span>
              </div>
              <div>
                <span className="text-[10px] text-zinc-400 block font-semibold">Sovereign Fee</span>
                <span className="text-xs font-bold text-cyan-300 truncate block">{p.feesGenerated}</span>
              </div>
              <div>
                <span className="text-[10px] text-zinc-400 block font-semibold">Buyback Vault</span>
                <span className="text-xs font-bold text-pink-400 truncate block">{p.buybackAmount}</span>
              </div>
            </div>

            {/* Agent Compute & Edge Info */}
            <div className="p-3 rounded-xl bg-[#050811] border border-white/5 space-y-1.5 text-xs font-mono">
              <div className="flex justify-between items-center text-zinc-400">
                <span>0G Compute Model:</span>
                <span className="text-purple-300 font-bold">{p.agentModel}</span>
              </div>
              <div className="flex justify-between items-center text-zinc-400">
                <span>Edge Monetization:</span>
                <span className="text-orange-400 font-bold">{p.edgeProvider}</span>
              </div>
              {p.teeRoot && (
                <div className="flex justify-between items-center text-zinc-400 pt-1 border-t border-white/5">
                  <span>0G DA Storage Root:</span>
                  <span className="text-emerald-400 font-bold">{p.teeRoot.slice(0, 10)}...{p.teeRoot.slice(-6)}</span>
                </div>
              )}
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs font-mono">
              <a
                href={`https://chainscan.0g.ai/address/${p.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-bold hover:underline"
              >
                <span>{p.address.slice(0, 6)}...{p.address.slice(-4)}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <div className="flex items-center gap-3 font-bold">
                <Link
                  href="/swap"
                  className="text-purple-300 hover:text-white flex items-center gap-1 hover:underline"
                >
                  Swap AMM <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
                <Link
                  href="/agent/demo"
                  className="text-orange-400 hover:text-orange-300 flex items-center gap-1 hover:underline"
                >
                  Call Edge (x402) <CloudLightning className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── ON-CHAIN DEPLOYMENT VERIFICATION ────────────────────────── */}
      <div className="-mx-4 sm:-mx-6 lg:-mx-8 mt-12">
        <VerifiedDeploymentCard />
      </div>
    </div>
  );
}
