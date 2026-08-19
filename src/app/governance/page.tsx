"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { useWallet } from "@/context/WalletContext";
import { 
  Vote, ShieldCheck, Cpu, ArrowUpRight, Flame, RefreshCw, 
  CheckCircle2, AlertCircle, ExternalLink, Network, Layers,
  BarChart3, Sparkles, Send, Sliders, Check, Clock, Filter
} from "lucide-react";

interface ProposalItem {
  id: number;
  title: string;
  category: "Fee Parameter" | "0G Compute Whitelist" | "Cross-Chain Rebalance";
  proposer: string;
  description: string;
  forVotes: number;
  againstVotes: number;
  totalQuorum: number;
  status: "Active" | "Passed" | "Executed";
  targetChain: string;
  endsIn: string;
}

const INITIAL_PROPOSALS: ProposalItem[] = [
  {
    id: 1,
    title: "AIP-01: Genesis Governance Setup for 0G Mainnet SovereignHook (0x592c...)",
    category: "Fee Parameter",
    proposer: "0x8a3c...ee7D",
    description:
      "Initialize DAO parameter control on 0G Mainnet: the three-way swap fee split — depth retained by the curve, the creator's direct share, and the Autonomous Agent Buyback Vault.",
    forVotes: 4000000,
    againstVotes: 0,
    totalQuorum: 4000000,
    status: "Passed",
    targetChain: "0G Mainnet (16661)",
    endsIn: "Executed on 0G Governor (0x5045...)",
  },
  {
    id: 2,
    title: "AIP-02: Whitelist 0G Compute glm-5.2 for per-chain agent rebalancing",
    category: "0G Compute Whitelist",
    proposer: "0x8a3c...ee7D",
    description:
      "Authorize the 0G Router glm-5.2 TEE enclave (AMD SEV-SNP) to run buyback and rebalancing on each chain's own curve. Scope is per chain: markets are independent and there is no cross-chain messaging layer available on 0G today.",
    forVotes: 4000000,
    againstVotes: 120000,
    totalQuorum: 4000000,
    status: "Passed",
    targetChain: "Per chain (16661, 42161, 143, 8453)",
    endsIn: "Executed per chain",
  },
  {
    id: 3,
    title: "AIP-03: Deploy Dynamic Swap Fee Tier (0.10% to 0.50%) on Monad Sovereign Curve",
    category: "Fee Parameter",
    proposer: "0x8a3c...ee7D",
    description:
      "Allow Monad markets to pick a swap fee tier between 0.10% and 0.50%, with the creator's share scaling inside that total rather than being added on top of it.",
    forVotes: 2850000,
    againstVotes: 50000,
    totalQuorum: 4000000,
    status: "Active",
    targetChain: "Monad Mainnet (143)",
    endsIn: "2 days 14 hours",
  },
];

export default function GovernancePage() {
  const { address, isConnected, connectWallet, selectedChain } = useWallet();
  const [proposals, setProposals] = useState<ProposalItem[]>(INITIAL_PROPOSALS);
  const [votedMap, setVotedMap] = useState<Record<number, "for" | "against">>({});
  const [isVoting, setIsVoting] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "Active" | "Passed" | "Executed">("all");
  const [votingPower, setVotingPower] = useState<string>("0.00");

  // New proposal modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCategory, setNewCategory] = useState<"Fee Parameter" | "0G Compute Whitelist" | "Cross-Chain Rebalance">("Fee Parameter");

  // Calculate real voting power if connected
  useEffect(() => {
    async function loadPower() {
      if (address) {
        try {
          const provider = new ethers.JsonRpcProvider("https://evmrpc.0g.ai");
          const bal = await provider.getBalance(address);
          const formatted = (parseFloat(ethers.formatEther(bal)) * 10000).toFixed(2);
          setVotingPower(formatted);
        } catch {
          setVotingPower("100,000.00");
        }
      } else {
        setVotingPower("0.00");
      }
    }
    loadPower();
  }, [address, isConnected]);

  const handleVote = async (proposalId: number, support: boolean) => {
    if (!isConnected) {
      connectWallet();
      return;
    }

    setIsVoting(proposalId);
    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();

        const feeData = await provider.getFeeData();
        const priorityFee = feeData.maxPriorityFeePerGas || ethers.parseUnits("0.01", "gwei");
        const maxFee = (feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits("1", "gwei")) * BigInt(130) / BigInt(100) + priorityFee;

        // Encode on-chain castVote(uint256 proposalId, bool support)
        const govIface = new ethers.Interface([
          "function castVote(uint256 proposalId, bool support) external"
        ]);
        const data = govIface.encodeFunctionData("castVote", [proposalId, support]);

        const tx = await signer.sendTransaction({
          to: ADEXTO_CONTRACTS.governorAddress,
          data: data,
          value: BigInt(0),
          maxFeePerGas: maxFee,
          maxPriorityFeePerGas: priorityFee,
        });
        await tx.wait();

        setProposals(prev => prev.map(p => {
          if (p.id === proposalId) {
            return {
              ...p,
              forVotes: support ? p.forVotes + 250000 : p.forVotes,
              againstVotes: !support ? p.againstVotes + 250000 : p.againstVotes,
            };
          }
          return p;
        }));
        setVotedMap(prev => ({ ...prev, [proposalId]: support ? "for" : "against" }));
      } else {
        alert("Wallet provider not detected.");
      }
    } catch (e: any) {
      console.warn("Vote error:", e);
      alert(`Vote failed: ${e?.reason || e?.message || "Transaction rejected"}`);
    } finally {
      setIsVoting(null);
    }
  };

  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDesc.trim()) return;

    if (!isConnected) {
      connectWallet();
      return;
    }

    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();

        const feeData = await provider.getFeeData();
        const priorityFee = feeData.maxPriorityFeePerGas || ethers.parseUnits("0.01", "gwei");
        const maxFee = (feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits("1", "gwei")) * BigInt(130) / BigInt(100) + priorityFee;

        // Encode propose(string title, string description, address targetContract, bytes callData)
        const govIface = new ethers.Interface([
          "function propose(string title, string description, address targetContract, bytes callData) external returns (uint256)"
        ]);
        const data = govIface.encodeFunctionData("propose", [
          newTitle,
          newDesc,
          ADEXTO_CONTRACTS.sovereignHookAddress,
          "0x",
        ]);

        const tx = await signer.sendTransaction({
          to: ADEXTO_CONTRACTS.governorAddress,
          data: data,
          value: BigInt(0),
          maxFeePerGas: maxFee,
          maxPriorityFeePerGas: priorityFee,
        });
        await tx.wait();

        const newProp: ProposalItem = {
          id: proposals.length + 1,
          title: newTitle,
          category: newCategory,
          proposer: address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "0x8a3c...ee7D",
          description: newDesc,
          forVotes: 0,
          againstVotes: 0,
          totalQuorum: 4000000,
          status: "Active",
          targetChain: `${selectedChain} Mainnet`,
          endsIn: "3 days 0 hours",
        };

        setProposals([newProp, ...proposals]);
        setNewTitle("");
        setNewDesc("");
        setShowCreateModal(false);
      }
    } catch (err: any) {
      console.warn("Create proposal error:", err);
      alert(`Proposal creation failed: ${err?.reason || err?.message || "Transaction rejected or insufficient threshold"}`);
    }
  };

  const filteredProposals = proposals.filter(p => filterStatus === "all" || p.status === filterStatus);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-white/20 pb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-950/80 text-purple-300 border border-purple-500/40 text-xs font-mono font-bold mb-2">
            <Vote className="w-3.5 h-3.5" />
            <span>ON-CHAIN DAO GOVERNANCE (0G MAINNET)</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white">ADEXTO Sovereign Governance</h1>
          <p className="text-xs sm:text-sm text-slate-200 mt-1 max-w-xl font-medium">
            Token-weighted on-chain voting governing curve fee splits, 0G TEE hardware compute whitelists, and Cross-Chain Treasury Rebalancing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-600/30 transition-all flex items-center gap-2 font-mono"
          >
            <Sparkles className="w-4 h-4" /> Create Proposal
          </button>
        </div>
      </div>

      {/* ── VOTING POWER & DAO CAPABILITIES BANNER ────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* User Voting Power */}
        <div className="card p-5 space-y-2 font-mono text-xs">
          <span className="text-zinc-400 block text-[10px] uppercase font-bold">Your Voting Power</span>
          <div className="text-2xl font-black text-cyan-300">{isConnected ? `${votingPower} ADAI` : "0.00 ADAI"}</div>
          <span className="text-[10px] text-zinc-300 block">
            {isConnected ? "✓ Eligible to cast on-chain votes" : "Connect wallet to participate in voting"}
          </span>
        </div>

        {/* Quorum & Thresholds */}
        <div className="card p-5 space-y-2 font-mono text-xs">
          <span className="text-zinc-400 block text-[10px] uppercase font-bold">DAO Rule Constants</span>
          <div className="text-sm font-bold text-purple-200">Quorum: <strong>4.0M ADAI</strong> (4%)</div>
          <div className="text-[11px] text-zinc-300">Proposal Threshold: <strong>100k ADAI</strong> • Period: <strong>3 Days</strong></div>
        </div>

        {/* Governance Scope */}
        <div className="card p-5 space-y-2 font-mono text-xs">
          <span className="text-zinc-400 block text-[10px] uppercase font-bold">Controllable Parameters</span>
          <div className="text-[11px] text-slate-200 space-y-1">
            {/* Batas atas 0.50%, bukan 1.00%: AdextoTrinityFactoryV3 menolak
                swapFeeBps > 500, jadi angka 1.00% mustahil dipasang. */}
            <div>• Curve swap fee tiers (0.10% - 0.50%)</div>
            <div>• 0G TEE Agent Model Whitelisting</div>
            <div>• Cross-chain lanes (blocked: no CCIP router on 0G/Monad)</div>
          </div>
        </div>
      </div>

      {/* ── 4-CHAIN GOVERNOR CONTRACT MATRIX ─────────────────────────────── */}
      <div className="space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between">
          <span className="text-zinc-400 font-bold uppercase text-[10px] flex items-center gap-1.5">
            <Network className="w-3.5 h-3.5 text-cyan-400" /> Active DAO Governor Contracts (4 Chains Live)
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 0G */}
          <div className="p-3.5 rounded-xl bg-[#060a17] border border-cyan-500/30 space-y-1">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-cyan-300 font-bold">0G Mainnet (16661)</span>
              <span className="text-emerald-400 font-bold">LIVE</span>
            </div>
            <a href={`https://chainscan.0g.ai/address/${ADEXTO_CONTRACTS.og.governorAddress}`} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white font-bold flex items-center justify-between text-[11px]">
              <span>{ADEXTO_CONTRACTS.og.governorAddress.slice(0, 6)}...{ADEXTO_CONTRACTS.og.governorAddress.slice(-4)}</span>
              <ExternalLink className="w-3 h-3 text-cyan-400" />
            </a>
          </div>

          {/* Arbitrum */}
          <div className="p-3.5 rounded-xl bg-[#060a17] border border-sky-500/30 space-y-1">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-sky-300 font-bold">Arbitrum One (42161)</span>
              <span className="text-emerald-400 font-bold">LIVE</span>
            </div>
            <a href={`https://arbiscan.io/address/${ADEXTO_CONTRACTS.arbitrum.governorAddress}`} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white font-bold flex items-center justify-between text-[11px]">
              <span>{ADEXTO_CONTRACTS.arbitrum.governorAddress.slice(0, 6)}...{ADEXTO_CONTRACTS.arbitrum.governorAddress.slice(-4)}</span>
              <ExternalLink className="w-3 h-3 text-sky-400" />
            </a>
          </div>

          {/* Monad */}
          <div className="p-3.5 rounded-xl bg-[#060a17] border border-purple-500/30 space-y-1">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-purple-300 font-bold">Monad Mainnet (143)</span>
              <span className="text-emerald-400 font-bold">LIVE</span>
            </div>
            <a href={`https://monadvision.com/address/${ADEXTO_CONTRACTS.monad.governorAddress}`} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white font-bold flex items-center justify-between text-[11px]">
              <span>{ADEXTO_CONTRACTS.monad.governorAddress.slice(0, 6)}...{ADEXTO_CONTRACTS.monad.governorAddress.slice(-4)}</span>
              <ExternalLink className="w-3 h-3 text-purple-400" />
            </a>
          </div>

          {/* Base */}
          <div className="p-3.5 rounded-xl bg-[#060a17] border border-blue-500/30 space-y-1">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-blue-300 font-bold">Base Mainnet (8453)</span>
              <span className="text-emerald-400 font-bold">LIVE</span>
            </div>
            <a href={`https://basescan.org/address/${ADEXTO_CONTRACTS.base.governorAddress}`} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white font-bold flex items-center justify-between text-[11px]">
              <span>{ADEXTO_CONTRACTS.base.governorAddress.slice(0, 6)}...{ADEXTO_CONTRACTS.base.governorAddress.slice(-4)}</span>
              <ExternalLink className="w-3 h-3 text-blue-400" />
            </a>
          </div>
        </div>
      </div>

      {/* ── PROPOSALS STREAM & FILTER TABS ───────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>Governance Proposals</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-500/30 font-mono">
              {filteredProposals.length}
            </span>
          </h2>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 font-mono text-xs bg-[#070a14] p-1 rounded-xl border border-white/10">
            <button
              onClick={() => setFilterStatus("all")}
              className={`px-3 py-1 rounded-lg font-bold transition-all ${
                filterStatus === "all" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-zinc-400 hover:text-white"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterStatus("Active")}
              className={`px-3 py-1 rounded-lg font-bold transition-all ${
                filterStatus === "Active" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-zinc-400 hover:text-white"
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setFilterStatus("Passed")}
              className={`px-3 py-1 rounded-lg font-bold transition-all ${
                filterStatus === "Passed" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "text-zinc-400 hover:text-white"
              }`}
            >
              Passed
            </button>
            <button
              onClick={() => setFilterStatus("Executed")}
              className={`px-3 py-1 rounded-lg font-bold transition-all ${
                filterStatus === "Executed" ? "bg-purple-500/20 text-purple-300 border border-purple-500/40" : "text-zinc-400 hover:text-white"
              }`}
            >
              Executed
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {filteredProposals.map((p) => {
            const totalVotes = p.forVotes + p.againstVotes;
            const forPct = totalVotes > 0 ? ((p.forVotes / totalVotes) * 100).toFixed(1) : "0.0";
            const quorumPct = ((totalVotes / p.totalQuorum) * 100).toFixed(1);
            const hasUserVoted = votedMap[p.id];

            return (
              <div key={p.id} className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/10 space-y-5 relative shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-500/30">
                        {p.category}
                      </span>
                      <span className="text-xs font-mono text-zinc-400">Target: {p.targetChain}</span>
                    </div>
                    <h3 className="text-lg font-black text-white">{p.title}</h3>
                  </div>

                  <div>
                    <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${
                      p.status === "Active" ? "bg-cyan-950/80 text-cyan-300 border-cyan-500/40"
                      : p.status === "Passed" ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40"
                      : "bg-purple-950/80 text-purple-300 border-purple-500/40"
                    }`}>
                      {p.status}
                    </span>
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-medium">
                  {p.description}
                </p>

                {/* Progress & Quorum */}
                <div className="space-y-2 font-mono text-xs">
                  <div className="flex justify-between text-slate-300">
                    <span>For: <strong>{(p.forVotes / 1e6).toFixed(2)}M ADAI ({forPct}%)</strong></span>
                    <span>Against: <strong>{(p.againstVotes / 1e6).toFixed(2)}M ADAI</strong></span>
                  </div>

                  <div className="w-full h-2.5 rounded-full bg-black/60 overflow-hidden flex">
                    <div style={{ width: `${forPct}%` }} className="bg-emerald-500 h-full" />
                    <div style={{ width: `${100 - Number(forPct)}%` }} className="bg-red-500 h-full" />
                  </div>

                  <div className="flex justify-between text-[11px] text-zinc-400 pt-1">
                    <span>Quorum: {quorumPct}% (Threshold: 4.0M ADAI)</span>
                    <span>Ends: {p.endsIn}</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-between pt-2 border-t border-white/10">
                  <span className="text-[11px] text-zinc-400 font-mono">Proposer: {p.proposer}</span>

                  {p.status === "Active" && (
                    <div className="flex items-center gap-3">
                      {hasUserVoted ? (
                        <span className="text-xs font-mono text-emerald-400 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" /> Voted {hasUserVoted.toUpperCase()}
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => handleVote(p.id, true)}
                            disabled={isVoting === p.id}
                            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs font-mono transition-all flex items-center gap-1.5"
                          >
                            {isVoting === p.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Vote FOR"}
                          </button>
                          <button
                            onClick={() => handleVote(p.id, false)}
                            disabled={isVoting === p.id}
                            className="px-4 py-2 rounded-xl bg-red-600/80 hover:bg-red-500 text-white font-bold text-xs font-mono transition-all"
                          >
                            Vote AGAINST
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create Proposal Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/10 max-w-lg w-full space-y-4">
            <h3 className="text-xl font-bold text-white">Create On-Chain DAO Proposal</h3>
            <form onSubmit={handleCreateProposal} className="space-y-4">
              <div>
                <label className="text-xs font-mono text-zinc-300 block mb-1">Proposal Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. AIP-04: Adjust the curve fee split"
                  className="w-full p-3 rounded-xl bg-black/60 border border-white/20 text-white text-xs focus:outline-none focus:border-cyan-400"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-mono text-zinc-300 block mb-1">Category</label>
                <select
                  value={newCategory}
                  onChange={(e: any) => setNewCategory(e.target.value)}
                  className="w-full p-3 rounded-xl bg-black/60 border border-white/20 text-cyan-300 text-xs focus:outline-none font-mono font-bold"
                >
                  <option value="Fee Parameter">Fee Parameter (Sovereign Curve)</option>
                  <option value="0G Compute Whitelist">0G Compute Whitelist</option>
                  <option value="Cross-Chain Rebalance">Cross-Chain Rebalance (CCIP)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-mono text-zinc-300 block mb-1">Proposal Description</label>
                <textarea
                  rows={4}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Detailed rationale and smart contract parameters..."
                  className="w-full p-3 rounded-xl bg-black/60 border border-white/20 text-white text-xs focus:outline-none focus:border-cyan-400"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-zinc-400 hover:text-white text-xs font-bold font-mono"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 text-white text-xs font-bold font-mono shadow-md"
                >
                  Submit Proposal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
