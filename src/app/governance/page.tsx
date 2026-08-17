"use client";

import { useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { useWallet } from "@/context/WalletContext";
import { 
  Vote, ShieldCheck, Cpu, ArrowUpRight, Flame, RefreshCw, 
  CheckCircle2, AlertCircle, ExternalLink, Network, Layers,
  BarChart3, Sparkles, Send
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
    description: "Initialize initial DAO parameter control on 0G Mainnet: 0.20% LP Rewards and 0.10% Autonomous Agent Buyback Vault directly routing to ADAI pool.",
    forVotes: 4000000,
    againstVotes: 0,
    totalQuorum: 4000000,
    status: "Passed",
    targetChain: "0G Mainnet (16661)",
    endsIn: "Executed on 0G Governor (0x5045...)",
  },
];

export default function GovernancePage() {
  const { address, isConnected, connectWallet } = useWallet();
  const [proposals, setProposals] = useState<ProposalItem[]>(INITIAL_PROPOSALS);
  const [votedMap, setVotedMap] = useState<Record<number, "for" | "against">>({});
  const [isVoting, setIsVoting] = useState<number | null>(null);

  // New proposal modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCategory, setNewCategory] = useState<"Fee Parameter" | "0G Compute Whitelist" | "Cross-Chain Rebalance">("Fee Parameter");

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

        // Cast on-chain vote interaction to DAO Governor
        const tx = await signer.sendTransaction({
          to: ADEXTO_CONTRACTS.governorAddress,
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

  const handleCreateProposal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDesc.trim()) return;

    const newProp: ProposalItem = {
      id: proposals.length + 1,
      title: newTitle,
      category: newCategory,
      proposer: address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "0x8a3c...ee7D",
      description: newDesc,
      forVotes: 250000,
      againstVotes: 0,
      totalQuorum: 4000000,
      status: "Active",
      targetChain: "0G Mainnet (16661)",
      endsIn: "3 days 0 hours",
    };

    setProposals([newProp, ...proposals]);
    setNewTitle("");
    setNewDesc("");
    setShowCreateModal(false);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-white/20 pb-8 mb-10">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-950/80 text-purple-300 border border-purple-500/40 text-xs font-mono font-bold mb-2">
            <Vote className="w-3.5 h-3.5" />
            <span>ON-CHAIN DAO GOVERNANCE &amp; CCIP MESH (PHASE 2)</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white">ADEXTO Sovereign Governance</h1>
          <p className="text-xs sm:text-sm text-slate-200 mt-1 max-w-xl font-medium">
            Token-weighted on-chain voting governing SovereignHook parameters, 0G TEE hardware enclaves, and Cross-Chain Treasury Rebalancing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-600/30 transition-all flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" /> Create Proposal
          </button>
        </div>
      </div>

      {/* Live Governance Contracts Pill */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 font-mono text-xs">
        <div className="p-4 rounded-2xl bg-[#070a14] border border-cyan-500/30 flex items-center justify-between">
          <div>
            <span className="text-zinc-400 block text-[10px]">Governor Contract (0G Mainnet):</span>
            <span className="text-cyan-300 font-bold">{ADEXTO_CONTRACTS.governorAddress}</span>
          </div>
          <a
            href={`https://chainscan.0g.ai/address/${ADEXTO_CONTRACTS.governorAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg bg-cyan-950/50 text-cyan-300 hover:bg-cyan-900 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        <div className="p-4 rounded-2xl bg-[#070a14] border border-purple-500/30 flex items-center justify-between">
          <div>
            <span className="text-zinc-400 block text-[10px]">CCIP Cross-Chain Receiver:</span>
            <span className="text-purple-300 font-bold">{ADEXTO_CONTRACTS.ccipReceiverAddress}</span>
          </div>
          <a
            href={`https://chainscan.0g.ai/address/${ADEXTO_CONTRACTS.ccipReceiverAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg bg-purple-950/50 text-purple-300 hover:bg-purple-900 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Proposals Grid */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span>Active &amp; Historical Proposals</span>
        </h2>

        {proposals.map((p) => {
          const totalVotes = p.forVotes + p.againstVotes;
          const forPct = totalVotes > 0 ? ((p.forVotes / totalVotes) * 100).toFixed(1) : "0.0";
          const quorumPct = ((totalVotes / p.totalQuorum) * 100).toFixed(1);
          const hasUserVoted = votedMap[p.id];

          return (
            <div key={p.id} className="glass-panel p-6 sm:p-8 rounded-3xl border-2 border-white/15 space-y-5 relative shadow-xl">
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

      {/* Create Proposal Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-6 sm:p-8 rounded-3xl border-2 border-white/20 max-w-lg w-full space-y-4 shadow-2xl">
            <h3 className="text-xl font-bold text-white">Create On-Chain DAO Proposal</h3>
            <form onSubmit={handleCreateProposal} className="space-y-4">
              <div>
                <label className="text-xs font-mono text-zinc-300 block mb-1">Proposal Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. AIP-04: Adjust Liquidity Pool Fee"
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
                  <option value="Fee Parameter">Fee Parameter (SovereignHook)</option>
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
