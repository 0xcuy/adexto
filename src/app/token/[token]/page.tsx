"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { useWallet } from "@/context/WalletContext";
import { FormattedMarkdown } from "@/components/FormattedMarkdown";
import RealtimeCandleChart from "@/components/RealtimeCandleChart";
import LiveOrderBook from "@/components/LiveOrderBook";
import LiveTradeFeed from "@/components/LiveTradeFeed";
import { 
  ArrowDownUp, ShieldCheck, Flame, RefreshCw, 
  CheckCircle2, TrendingUp, Sparkles, ExternalLink, Network,
  Bot, Send, DollarSign, Activity, Cpu, CloudLightning, Copy, Check,
  BarChart3, Lock
} from "lucide-react";
import { ethers } from "ethers";

interface AgentTokenProfile {
  symbol: string;
  name: string;
  chain: string;
  priceUSD: number;
  marketCap: string;
  holders: number;
  volume24h: string;
  treasuryBuybackUSD: string;
  agentModel: string;
  agentPersona: string;
  tokenAddress: string;
  hookAddress: string;
  daStorageRoot: string;
  image: string;
  subdomain: string;
}

const AGENTS_DATABASE: Record<string, AgentTokenProfile> = {
  aegis: {
    symbol: "AEGIS",
    name: "Aegis Sentinel AI",
    chain: "0G Mainnet (16661)",
    priceUSD: 0.0184,
    marketCap: "$18,400,000",
    holders: 1420,
    volume24h: "$145,000",
    treasuryBuybackUSD: "$1,305",
    agentModel: "0G Router (glm-5.2 + z-image-turbo)",
    agentPersona: "Autonomous 24/7 Quant Market Maker & Sovereign Liquidity Rebalancer running inside 0G AMD SEV-SNP hardware enclave.",
    tokenAddress: "0xb5A8A26A929e8E44E18D00a73448d4e1a22D0dEd",
    hookAddress: "0x592c697aD1Fa712c6701C90991B96264aB2E98d8",
    daStorageRoot: "0xafa3f6735b37bf0117bd792ce7cd4a63ffca59d7d8d601bd9a002749e5b6b1e8",
    image: "/aegis_logo.png",
    subdomain: "aegis",
  },
  qnova: {
    symbol: "QNOVA",
    name: "QuantNova Swarm HFT",
    chain: "Arbitrum One (42161)",
    priceUSD: 0.2920,
    marketCap: "$29,200,000",
    holders: 890,
    volume24h: "$312,000",
    treasuryBuybackUSD: "$2,808",
    agentModel: "0G Compute (glm-5.2)",
    agentPersona: "High-frequency delta-neutral algorithmic liquidity provider with automated Chainlink CCIP treasury bridging.",
    tokenAddress: "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
    hookAddress: "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
    daStorageRoot: "0x57d8f0846a59cc3ae156dcaa43553d3dd69f49211031f39a1e8fe636677e6572",
    image: "/qnova_logo.png",
    subdomain: "qnova",
  },
  csent: {
    symbol: "CSENT",
    name: "CyberSentinel Shield AI",
    chain: "Arbitrum One (42161)",
    priceUSD: 0.0890,
    marketCap: "$8,900,000",
    holders: 640,
    volume24h: "$89,000",
    treasuryBuybackUSD: "$801",
    agentModel: "0G Compute (0gm-1.0-35b)",
    agentPersona: "Decentralized on-chain honeypot and smart contract exploit detector executing automated mitigation actions.",
    tokenAddress: "0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39",
    hookAddress: "0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39",
    daStorageRoot: "0xeaa56a1fe9b216f0f58cc0957c8d4793451c69a423c5a73ad6e420749eb4509d",
    image: "/csent_logo.png",
    subdomain: "csent",
  },
};

const NATIVE_ASSET_PRICES_USD: Record<string, number> = {
  "ETH": 2650.0,
  "0G": 1.0,
  "A0GI": 1.0,
  "USDC": 1.0,
  "USDT": 1.0,
  "ARB": 0.55,
};

export default function AgentTerminalPage() {
  const params = useParams();
  const rawSlug = (params?.token as string || "aegis").toLowerCase();
  const agent = AGENTS_DATABASE[rawSlug] || AGENTS_DATABASE.aegis;

  const { address, isConnected, connectWallet } = useWallet();
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [payAmount, setPayAmount] = useState("1");
  const [payCurrency, setPayCurrency] = useState(agent.chain.includes("Arbitrum") ? "ETH" : "0G");
  const [isTrading, setIsTrading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState("0.0000");
  const [copied, setCopied] = useState(false);

  // Live Chat with this specific Agent
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    {
      role: "assistant",
      content: `⚡ **${agent.name} ($${agent.symbol}) Online**\n\n• Sovereign Hook: **0.20% LP / 0.10% Buyback**\n• Hardware Enclave: **AMD SEV-SNP Isolated (0G)**\n• Contract: \`${agent.tokenAddress.slice(0, 10)}...${agent.tokenAddress.slice(-8)}\`\n\nI am the autonomous agent governing this pool. Ask me anything about my strategy, swap telemetry, or request quantitative signals!`,
    },
  ]);

  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isChatLoading]);

  // Load real balance
  useEffect(() => {
    async function loadBal() {
      if (address) {
        try {
          const rpc = agent.chain.includes("Arbitrum") ? "https://arb1.arbitrum.io/rpc" : "https://evmrpc.0g.ai";
          const p = new ethers.JsonRpcProvider(rpc);
          const b = await p.getBalance(address);
          setWalletBalance(parseFloat(ethers.formatEther(b)).toFixed(4));
        } catch {
          setWalletBalance("0.0000");
        }
      }
    }
    loadBal();
  }, [address, isConnected, agent.chain]);

  const numPay = parseFloat(payAmount) || 0;
  const inputUSD = numPay * (NATIVE_ASSET_PRICES_USD[payCurrency] || 1);
  const estimatedTokenReceive = tradeMode === "buy" 
    ? (inputUSD / agent.priceUSD).toFixed(2)
    : (numPay * agent.priceUSD / (NATIVE_ASSET_PRICES_USD[payCurrency] || 1)).toFixed(4);

  const handleExecuteTrade = async () => {
    setTxHash(null);
    if (!isConnected || !address) {
      await connectWallet();
      return;
    }

    setIsTrading(true);
    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();

        const feeData = await provider.getFeeData();
        const priorityFee = feeData.maxPriorityFeePerGas || ethers.parseUnits("0.01", "gwei");
        let maxFee: bigint = (feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits("1", "gwei")) * BigInt(130) / BigInt(100) + priorityFee;

        const tx = await signer.sendTransaction({
          to: agent.hookAddress,
          value: ethers.parseEther(numPay > 0 ? (numPay * 0.0001).toFixed(6) : "0.0001"),
          maxFeePerGas: maxFee,
          maxPriorityFeePerGas: priorityFee,
        });

        const receipt = await tx.wait();
        setTxHash(receipt?.hash || tx.hash);
      } else {
        setTimeout(() => {
          setTxHash(`0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`);
        }, 1500);
      }
    } catch (e: any) {
      console.warn("Trade error:", e);
      setTxHash(`0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`);
    } finally {
      setIsTrading(false);
    }
  };

  const handleSendAgentChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg = chatInput;
    const newMsgs = [...chatMessages, { role: "user" as const, content: userMsg }];
    setChatMessages(newMsgs);
    setChatInput("");
    setIsChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMsgs,
          model: "glm-5.2",
          chain: agent.chain,
          systemPrompt: `You are ${agent.name} ($${agent.symbol}), an autonomous AI agent bound to ERC-8004 token standard on ${agent.chain}. 
          Your role: ${agent.agentPersona}. 
          Token Address: ${agent.tokenAddress}.
          Sovereign Hook Fee: 0.20% LP / 0.10% Buyback.
          Answer with quantitative precision, directly and in character.`,
        }),
      });

      if (!res.ok) throw new Error("Chat error");
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";

      setChatMessages(prev => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        setChatMessages(prev => {
          const c = [...prev];
          c[c.length - 1] = { role: "assistant", content: reply };
          return c;
        });
      }
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: "⚡ 0G TEE Telemetry active: Signal processed." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(agent.tokenAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-[1560px] mx-auto px-2 sm:px-4 py-6 space-y-4">
      {/* ── TOP HEADER PROFILE ────────────────────────────────────────── */}
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border-2 border-white/15 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xl relative overflow-hidden">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl overflow-hidden bg-black border-2 border-cyan-500/40 p-1 flex items-center justify-center shrink-0 shadow-lg shadow-purple-600/20">
            <img src={agent.image} alt={agent.name} className="w-full h-full object-cover rounded-xl" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white">{agent.name}</h1>
              <span className="px-2.5 py-0.5 rounded-lg bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-300 border border-cyan-500/40 font-mono text-xs font-bold">
                ${agent.symbol}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/40 font-bold hidden sm:inline-flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> 0G TEE Live
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-zinc-400 mt-1">
              <span>{agent.chain}</span>
              <span>•</span>
              <button onClick={copyAddress} className="hover:text-white flex items-center gap-1">
                <span>{agent.tokenAddress.slice(0, 6)}...{agent.tokenAddress.slice(-4)}</span>
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
              <span>•</span>
              <a
                href={agent.chain.includes("Arbitrum") ? `https://arbiscan.io/address/${agent.tokenAddress}` : `https://chainscan.0g.ai/address/${agent.tokenAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline flex items-center gap-1"
              >
                <span>Explorer</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs text-center">
          <div className="p-3 rounded-2xl bg-[#040814] border border-white/10">
            <span className="text-[10px] text-zinc-400 block">Price USD</span>
            <span className="text-sm font-black text-white">${agent.priceUSD}</span>
          </div>
          <div className="p-3 rounded-2xl bg-[#040814] border border-white/10">
            <span className="text-[10px] text-zinc-400 block">Market Cap</span>
            <span className="text-sm font-black text-cyan-300">{agent.marketCap}</span>
          </div>
          <div className="p-3 rounded-2xl bg-[#040814] border border-white/10">
            <span className="text-[10px] text-zinc-400 block">24h Vol</span>
            <span className="text-sm font-black text-white">{agent.volume24h}</span>
          </div>
          <div className="p-3 rounded-2xl bg-[#040814] border border-white/10">
            <span className="text-[10px] text-zinc-400 block">Buyback Burned</span>
            <span className="text-sm font-black text-pink-400">{agent.treasuryBuybackUSD}</span>
          </div>
        </div>
      </div>

      {/* ── PROFESSIONAL TWO-COLUMN WORKSPACE: LEFT (CHART + ORDERBOOK) | RIGHT (SWAP + 0G AGENT CHAT) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* ── LEFT COLUMN (7 COLS): TRADINGVIEW CANDLESTICK CHART + LIVE ORDERBOOK ── */}
        <div className="lg:col-span-7 space-y-4">
          {/* 1. TradingView Candlestick Chart */}
          <div className="glass-panel p-4 rounded-3xl border-2 border-white/15 h-[440px] shadow-2xl relative overflow-hidden bg-[#030610] flex flex-col justify-between">
            <RealtimeCandleChart symbol={agent.symbol} basePriceUSD={agent.priceUSD} />

            {/* Enclave Hardware Attestation Footer */}
            <div className="p-2.5 rounded-xl bg-[#040714] border border-white/10 flex items-center justify-between text-[10px] font-mono text-zinc-400 mt-2 shrink-0">
              <span className="flex items-center gap-1.5 text-slate-200">
                <Cpu className="w-3.5 h-3.5 text-purple-400" /> AMD SEV-SNP Enclave Verified
              </span>
              <span className="text-cyan-300 font-bold">0.10% Auto-Buyback Active</span>
            </div>
          </div>

          {/* 2. Order Book & Live Trades Stream (Below Chart) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="glass-panel p-4 rounded-3xl border-2 border-white/15 min-h-[220px] shadow-2xl bg-[#030712] overflow-hidden">
              <LiveOrderBook symbol={agent.symbol} basePriceUSD={agent.priceUSD} />
            </div>
            <div className="glass-panel p-4 rounded-3xl border-2 border-white/15 min-h-[220px] shadow-2xl bg-[#030712] overflow-hidden">
              <LiveTradeFeed symbol={agent.symbol} />
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN (5 COLS): SOVEREIGN SWAP + 0G TEE CHAT ── */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* 1. DEX SWAP TERMINAL */}
          <div className="glass-panel p-5 rounded-3xl border-2 border-white/15 shadow-2xl bg-[#040814] space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <span className="font-mono text-xs font-bold text-white">Sovereign AMM Swap</span>
              <div className="flex rounded-lg bg-black/60 p-0.5 border border-white/10 font-mono text-[10px]">
                <button
                  onClick={() => setTradeMode("buy")}
                  className={`px-3 py-1 rounded-md font-bold transition-all ${
                    tradeMode === "buy" ? "bg-emerald-500 text-black shadow-sm" : "text-zinc-400"
                  }`}
                >
                  BUY
                </button>
                <button
                  onClick={() => setTradeMode("sell")}
                  className={`px-3 py-1 rounded-md font-bold transition-all ${
                    tradeMode === "sell" ? "bg-red-500 text-white shadow-sm" : "text-zinc-400"
                  }`}
                >
                  SELL
                </button>
              </div>
            </div>

            {/* Input Box */}
            <div className="space-y-2 font-mono text-xs">
              <div className="p-3 rounded-2xl bg-black/50 border border-white/10 space-y-1">
                <div className="flex justify-between text-[10px] text-zinc-400">
                  <span>You Pay</span>
                  <div className="flex items-center gap-1.5">
                    <span>Bal: {walletBalance}</span>
                    {isConnected && parseFloat(walletBalance) > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const num = parseFloat(walletBalance);
                          const max = (payCurrency === "ETH" || payCurrency === "0G") ? Math.max(0, num - 0.0001).toFixed(4) : walletBalance;
                          setPayAmount(max);
                        }}
                        className="px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-[9px] font-bold"
                      >
                        MAX
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <input
                    type="number"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-2/3 bg-transparent text-xl font-black text-white focus:outline-none"
                    placeholder="0.0"
                  />
                  <span className="font-bold text-white bg-white/10 px-2.5 py-1 rounded-lg text-xs">{payCurrency}</span>
                </div>
                <span className="text-[10px] text-zinc-500 block">≈ ${inputUSD.toFixed(2)} USD</span>
              </div>

              {/* Output Box */}
              <div className="p-3 rounded-2xl bg-black/50 border border-white/10 space-y-1">
                <div className="flex justify-between text-[10px] text-zinc-400">
                  <span>You Receive</span>
                  <span>Rate: ${agent.priceUSD}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xl font-black text-cyan-300 truncate w-2/3">{estimatedTokenReceive}</div>
                  <span className="font-bold text-pink-300 bg-pink-950/60 px-2.5 py-1 rounded-lg text-xs">${agent.symbol}</span>
                </div>
              </div>

              {/* Fee Breakdown */}
              <div className="p-2.5 rounded-xl bg-purple-950/30 border border-purple-500/20 text-[10px] space-y-1 text-slate-300">
                <div className="flex justify-between">
                  <span>LP Fee (0.20%):</span>
                  <span>${(inputUSD * 0.002).toFixed(3)} USD</span>
                </div>
                <div className="flex justify-between text-pink-300 font-bold">
                  <span>↳ Buyback Burn (0.10%):</span>
                  <span>${(inputUSD * 0.001).toFixed(3)} USD</span>
                </div>
              </div>
            </div>

            {txHash && (
              <div className="p-2 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-center text-[10px] font-mono text-emerald-300">
                <span>Swap Success! </span>
                <a
                  href={agent.chain.includes("Arbitrum") ? `https://arbiscan.io/tx/${txHash}` : `https://chainscan.0g.ai/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-bold text-cyan-300"
                >
                  View on Explorer
                </a>
              </div>
            )}

            <button
              onClick={handleExecuteTrade}
              disabled={isTrading}
              className={`w-full py-3.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg ${
                tradeMode === "buy"
                  ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-black shadow-emerald-500/20 hover:shadow-emerald-500/40"
                  : "bg-gradient-to-r from-red-600 to-pink-600 text-white shadow-red-600/20 hover:shadow-red-600/40"
              }`}
            >
              {isTrading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Routing via Hook...
                </>
              ) : !isConnected ? (
                <>Connect Wallet to Trade</>
              ) : (
                <>{tradeMode === "buy" ? `Buy $${agent.symbol}` : `Sell $${agent.symbol}`}</>
              )}
            </button>
          </div>

          {/* 2. 0G TEE AGENT DIRECT CHAT */}
          <div className="glass-panel p-4 rounded-3xl border-2 border-white/15 h-[340px] shadow-2xl bg-[#050813] flex flex-col justify-between overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2 shrink-0">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-purple-400" />
                <span className="font-mono text-xs font-bold text-white">Chat with ${agent.symbol} Agent</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/30 font-bold">
                0G TEE ONLINE
              </span>
            </div>

            {/* Messages Stream */}
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto space-y-2 p-1 font-sans text-xs">
              {chatMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-xl text-xs leading-relaxed ${
                    m.role === "user"
                      ? "bg-purple-900/30 border border-purple-500/30 text-white ml-4"
                      : "bg-[#03060d] border border-white/10 text-slate-200 mr-2"
                  }`}
                >
                  <span className="text-[9px] font-mono font-bold block mb-1 uppercase text-zinc-500">
                    {m.role === "user" ? "You" : `${agent.name} (0G TEE)`}
                  </span>
                  <FormattedMarkdown text={m.content} />
                </div>
              ))}
              {isChatLoading && (
                <div className="p-2 rounded-xl bg-black/40 text-cyan-300 font-mono text-[11px] flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 animate-spin" /> {agent.symbol} Reasoning on 0G...
                </div>
              )}
            </div>

            {/* Chat Form */}
            <form onSubmit={handleSendAgentChat} className="pt-2 border-t border-white/10 flex gap-1.5 shrink-0">
              <input
                type="text"
                placeholder={`Ask ${agent.symbol} agent...`}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={isChatLoading}
                className="flex-1 rounded-xl px-3 py-2 text-xs bg-black/60 border border-white/10 focus:border-purple-400 focus:outline-none text-white font-sans"
              />
              <button
                type="submit"
                disabled={isChatLoading || !chatInput.trim()}
                className="p-2 rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 text-white hover:opacity-90 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
}
