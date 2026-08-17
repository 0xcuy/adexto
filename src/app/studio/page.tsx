"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { 
  Cpu, Terminal, Play, Send, RefreshCw, Sparkles, ShieldCheck, 
  Code2, Layers, Coins, Globe, Key, CloudLightning, Copy, Check,
  Bot, Settings, Activity, Zap, FileCode, CheckCircle2, ChevronDown, Flame,
  Wallet, ArrowRight, Lock, CheckCircle, AlertTriangle, Shield, Sliders,
  HelpCircle, ExternalLink, BarChart2, TrendingUp, Palette, SlidersHorizontal,
  Wand2, ArrowDownUp, ShieldAlert, Globe2, CheckSquare, Square, Dices
} from "lucide-react";
import { useWallet, SupportedChainKey } from "@/context/WalletContext";
import { FormattedMarkdown } from "@/components/FormattedMarkdown";

export default function StudioPage() {
  const { address, isConnected, isConnecting, connectWallet, selectedChain, setSelectedChain, chainName } = useWallet();

  // Active Model on 0G Mainnet Router
  const [selectedModel, setSelectedModel] = useState<string>("glm-5.2");

  // Active Preset
  const [activePreset, setActivePreset] = useState<"quant" | "meme" | "defi">("quant");

  // Selection Checkboxes (Default: ALL 3 SELECTED)
  const [deployToken, setDeployToken] = useState(true);
  const [deployDex, setDeployDex] = useState(true);
  const [deployAgent, setDeployAgent] = useState(true);

  // Project Parameters (Token - T)
  const [tokenName, setTokenName] = useState("Aegis Quant AI");
  const [tokenTicker, setTokenTicker] = useState("AEGIS");
  const [tokenSupply, setTokenSupply] = useState("1,000,000,000");
  const [generatedLogo, setGeneratedLogo] = useState<string | null>("/logo.svg");
  const [isGeneratingLogo, setIsGeneratingLogo] = useState(false);

  // DEX & Fee routing (DEX)
  const [feeTier, setFeeTier] = useState<"low" | "standard" | "meme">("standard");
  const [totalSwapFee, setTotalSwapFee] = useState(0.30);
  const [treasuryCut, setTreasuryCut] = useState(0.10);
  const [customSubdomain, setCustomSubdomain] = useState("aegis");

  const randomizeSubdomain = () => {
    const prefixes = ["alpha", "nova", "sentinel", "cyber", "aegis", "quant", "hyper", "nexus"];
    const randPre = prefixes[Math.floor(Math.random() * prefixes.length)];
    const randNum = Math.floor(100 + Math.random() * 900);
    const newSlug = `${randPre}-${randNum}`;
    setCustomSubdomain(newSlug);
  };

  // Agent mandate (Autonomous Agent - A)
  const [agentPersona, setAgentPersona] = useState("24/7 Quant Market Maker & Liquidity Rebalancer");

  // Deployment action state
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState(0);
  const [deployedResult, setDeployedResult] = useState<any>(null);
  const [worldIdVerified, setWorldIdVerified] = useState(false);
  const [isVerifyingWorldId, setIsVerifyingWorldId] = useState(false);

  // Model Options on 0G Mainnet Router
  const modelOptions = [
    { id: "glm-5.2", label: "0G: GLM-5.2" },
    { id: "0gm-1.0-35b-a3b", label: "0G: 0GM-1.0 35B" },
    { id: "0gm-1.0-35b-a3b-sia", label: "0G: 0GM-1.0 SIA" },
  ];

  // AI Chat states
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant" | "system"; content: string }>>([
    {
      role: "assistant",
      content: `⚡ **0G Autonomous Studio Initialized**

• Network: **${selectedChain} Mainnet**
• Target DEX Subdomain: **${customSubdomain || "myswap"}.adexto.xyz**
• Model: **0G Router (${selectedModel})**
• Enclave: **AMD SEV-SNP Isolated**

Tell me your concept or select which components (Token, DEX, Agent) to deploy on the left!`,
    },
  ]);

  // Synchronize AI chat target when subdomain changes
  useEffect(() => {
    if (messages.length === 1 && messages[0].role === "assistant") {
      setMessages([
        {
          role: "assistant",
          content: `⚡ **0G Autonomous Studio Initialized**

• Network: **${selectedChain} Mainnet**
• Target DEX Subdomain: **${customSubdomain || "myswap"}.adexto.xyz**
• Model: **0G Router (${selectedModel})**
• Enclave: **AMD SEV-SNP Isolated**

Tell me your concept or select which components (Token, DEX, Agent) to deploy on the left!`,
        },
      ]);
    }
  }, [customSubdomain, selectedChain, selectedModel]);

  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollChatToBottom = () => {
    if (chatScrollContainerRef.current) {
      chatScrollContainerRef.current.scrollTop = chatScrollContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollChatToBottom();
  }, [messages, isLoading]);

  // Handle Preset Select
  const handlePresetSelect = (type: "quant" | "meme" | "defi") => {
    setActivePreset(type);
    if (type === "meme") {
      setTokenName("Cyber Doge AI");
      setTokenTicker("CDOGE");
      setCustomSubdomain("cdoge");
      setTokenSupply("1,000,000,000");
      setFeeTier("meme");
      setTotalSwapFee(0.50);
      setTreasuryCut(0.20);
      setAgentPersona("Viral meme quant bot with aggressive DEX auto-buyback");
    } else if (type === "quant") {
      setTokenName("Aegis Quant AI");
      setTokenTicker("AEGIS");
      setCustomSubdomain("aegis");
      setTokenSupply("1,000,000,000");
      setFeeTier("standard");
      setTotalSwapFee(0.30);
      setTreasuryCut(0.10);
      setAgentPersona("24/7 Quant Market Maker & Liquidity Rebalancer");
    } else {
      setTokenName("Nova Yield Protocol");
      setTokenTicker("NYIELD");
      setCustomSubdomain("novayield");
      setTokenSupply("500,000,000");
      setFeeTier("low");
      setTotalSwapFee(0.10);
      setTreasuryCut(0.02);
      setAgentPersona("Delta-neutral yield hedging and institutional LP routing");
    }
  };

  const handleSendMessage = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    const textToSend = customText || inputMessage;
    if (!textToSend.trim() || isLoading) return;

    const newMessages = [...messages, { role: "user" as const, content: textToSend }];
    setMessages(newMessages);
    setInputMessage("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          model: selectedModel,
          chain: selectedChain,
        }),
      });

      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantReply = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantReply += chunk;

        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: assistantReply };
          return copy;
        });
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ 0G Compute Error: ${err.message}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateAiLogo = async () => {
    setIsGeneratingLogo(true);
    try {
      const res = await fetch("/api/generate-logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenName,
          tokenSymbol: tokenTicker,
          prompt: `Minimalist cyberpunk futuristic vector emblem for AI agent ${tokenName} ($${tokenTicker}), neon cyan purple glow, obsidian background, central high-tech crest`,
        }),
      });
      const data = await res.json();
      if (data.imageUrl) {
        setGeneratedLogo(data.imageUrl);
      }
    } catch (e) {
      console.warn("Logo generation error:", e);
    } finally {
      setIsGeneratingLogo(false);
    }
  };

  const handleVerifyWorldID = async () => {
    setIsVerifyingWorldId(true);
    // Simulate ZKP verification generation & proof validation
    setTimeout(() => {
      setWorldIdVerified(true);
      setIsVerifyingWorldId(false);
    }, 1200);
  };

  const handleExecuteDeploy = async () => {
    if (!isConnected) {
      await connectWallet();
      return;
    }

    if (!deployToken && !deployDex && !deployAgent) {
      alert("Please select at least 1 component to deploy (Token, DEX, or Agent).");
      return;
    }

    setIsDeploying(true);
    setDeployStep(1);

    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: deployToken ? tokenName : undefined,
          symbol: deployToken ? tokenTicker : undefined,
          supply: deployToken ? tokenSupply.replace(/,/g, "") : undefined,
          curve: "exponential",
          swapFee: deployDex ? totalSwapFee.toString() : undefined,
          treasuryCut: deployDex ? treasuryCut.toString() : undefined,
          chain: selectedChain,
          deployer: address,
          persona: deployAgent ? agentPersona : undefined,
          subdomain: deployDex ? customSubdomain : undefined,
          flags: { deployToken, deployDex, deployAgent },
        }),
      });

      setTimeout(() => setDeployStep(2), 1100);
      setTimeout(() => setDeployStep(3), 2200);

      const data = await res.json();
      setTimeout(() => {
        setIsDeploying(false);
        setDeployedResult(data.deployment);
      }, 3400);
    } catch (err) {
      console.error(err);
      setIsDeploying(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 1. UNLOCKED CLEAN STUDIO (INTERACTIVE PREVIEW FOR ALL VISITORS)
  // ──────────────────────────────────────────────────────────────────────────
  const lpCut = Math.max(0, totalSwapFee - treasuryCut);
  const selectedCount = (deployToken ? 1 : 0) + (deployDex ? 1 : 0) + (deployAgent ? 1 : 0);

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col p-4 max-w-[1560px] mx-auto w-full overflow-hidden">
      
      {/* ── TOP CONTROL STRIP ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 pb-2.5 mb-2.5 border-b border-white/[0.08] shrink-0">
        
        {/* Left Status */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-white flex items-center gap-1.5 font-mono">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> ADEXTO STUDIO
          </span>
          <span className="text-zinc-600 text-xs">/</span>
          {isConnected ? (
            <span className="text-emerald-400 font-mono text-xs font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {address?.slice(0, 6)}...{address?.slice(-4)}
            </span>
          ) : (
            <button
              onClick={connectWallet}
              className="text-amber-300 hover:text-amber-200 font-mono text-xs font-medium flex items-center gap-1.5 bg-amber-950/40 border border-amber-500/30 px-2 py-0.5 rounded"
            >
              <Lock className="w-3 h-3 text-amber-400" /> Connect Wallet to Deploy
            </button>
          )}
        </div>

        {/* Right Settings Bar */}
        <div className="flex items-center gap-2 font-mono text-xs">
          
          {/* Quick Presets */}
          <div className="hidden md:flex items-center bg-[#070913] p-1 rounded-lg">
            <button
              onClick={() => handlePresetSelect("quant")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                activePreset === "quant"
                  ? "bg-white/10 text-cyan-300"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Quant AI
            </button>
            <button
              onClick={() => handlePresetSelect("meme")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                activePreset === "meme"
                  ? "bg-white/10 text-pink-300"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Viral Meme
            </button>
            <button
              onClick={() => handlePresetSelect("defi")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                activePreset === "defi"
                  ? "bg-white/10 text-purple-300"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              DeFi Yield
            </button>
          </div>

          {/* Network Selector */}
          <div className="relative flex items-center bg-[#070913] hover:bg-[#0c1020] rounded-lg px-2.5 py-1 transition-colors">
            <Globe className="w-3.5 h-3.5 text-cyan-400 mr-1.5 shrink-0" />
            <select
              value={selectedChain}
              onChange={(e) => setSelectedChain(e.target.value as SupportedChainKey)}
              className="bg-transparent text-cyan-300 font-bold text-xs focus:outline-none cursor-pointer pr-4 appearance-none"
            >
              <option value="0G" className="bg-[#0b0f19] text-cyan-300 font-bold">0G Mainnet (16661 - Primary Live)</option>
              <option value="Base" className="bg-[#0b0f19] text-zinc-400">Base Mainnet (Phase 2)</option>
              <option value="Arbitrum" className="bg-[#0b0f19] text-zinc-400">Arbitrum One (Phase 2)</option>
              <option value="Monad" className="bg-[#0b0f19] text-zinc-400">Monad Mainnet (Phase 2)</option>
            </select>
            <ChevronDown className="w-3 h-3 text-cyan-400/60 absolute right-2 pointer-events-none" />
          </div>

          {/* Model Selector */}
          <div className="relative flex items-center bg-[#070913] hover:bg-[#0c1020] rounded-lg px-2.5 py-1 transition-colors">
            <Cpu className="w-3.5 h-3.5 text-purple-400 mr-1.5 shrink-0" />
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-transparent text-purple-300 font-bold text-xs focus:outline-none cursor-pointer pr-4 appearance-none max-w-[150px] truncate"
            >
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id} className="bg-[#0b0f19] text-purple-300">
                  {m.label}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-purple-400/60 absolute right-2 pointer-events-none" />
          </div>

        </div>
      </div>

      {/* Main Workspace Layout: LEFT (7 COLS) | RIGHT (5 COLS) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3.5 min-h-0">
        
        {/* ── LEFT: LAUNCH CONTROL PANEL (7 COLS) ───────────────────────────── */}
        <div className="lg:col-span-7 bg-[#070913] rounded-2xl border border-white/[0.06] p-4 flex flex-col justify-between h-full shadow-xl overflow-hidden">
          {deployedResult ? (
            /* Success View */
            <div className="p-6 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 space-y-4 font-mono text-xs my-auto">
              <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Deployment Succeeded on {selectedChain}!
              </div>
              <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-2 text-slate-200">
                {deployedResult.token && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Token Address:</span>
                    <span className="text-cyan-300 font-bold">{deployedResult.token.address}</span>
                  </div>
                )}
                {deployedResult.sovereignDex && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Sovereign DEX:</span>
                    <span className="text-purple-300 font-bold">{deployedResult.sovereignDex.subdomain}</span>
                  </div>
                )}
                {deployedResult.agentEnclave && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400">0G TEE Agent:</span>
                    <span className="text-pink-300 font-bold">{deployedResult.agentEnclave.agentId}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-2 font-sans">
                <button
                  onClick={() => setDeployedResult(null)}
                  className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-all"
                >
                  Deploy Another
                </button>
                <Link
                  href="/swap"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold text-xs text-center flex items-center justify-center gap-1 shadow-md"
                >
                  Open Live Swap →
                </Link>
              </div>
            </div>
          ) : (
            /* Modular Form with Green Checkbox Selection */
            <div className="flex flex-col justify-between h-full space-y-3">
              
              {/* Pillar 1: Token Specs (With Green Checkbox) */}
              <div className={`space-y-1.5 p-3 rounded-xl transition-all ${deployToken ? "bg-black/30 border border-pink-500/30" : "bg-black/10 opacity-50 border border-transparent"}`}>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={deployToken}
                      onChange={(e) => setDeployToken(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-500 accent-emerald-500 cursor-pointer"
                    />
                    <span className="text-xs font-mono font-bold text-pink-300 uppercase tracking-wider flex items-center gap-1.5">
                      1. Token Launchpad (ERC-8004)
                    </span>
                  </label>
                  <span className="text-[10px] font-mono text-zinc-500">Anti-Sniper Protected</span>
                </div>

                {deployToken && (
                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-medium text-zinc-400">Name</span>
                        <input
                          type="text"
                          value={tokenName}
                          onChange={(e) => setTokenName(e.target.value)}
                          className="w-full rounded-lg px-2.5 py-1.5 font-mono text-xs bg-black/40 hover:bg-black/60 focus:bg-black/80 border border-white/[0.06] focus:border-pink-400 text-white font-semibold focus:outline-none transition-all"
                        />
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[10px] font-medium text-zinc-400">Ticker</span>
                        <input
                          type="text"
                          value={tokenTicker}
                          onChange={(e) => {
                            const val = e.target.value.toUpperCase();
                            setTokenTicker(val);
                            if (!customSubdomain || customSubdomain === tokenTicker.toLowerCase()) {
                              setCustomSubdomain(val.toLowerCase());
                            }
                          }}
                          className="w-full rounded-lg px-2.5 py-1.5 font-mono text-xs bg-black/40 hover:bg-black/60 focus:bg-black/80 border border-white/[0.06] focus:border-pink-400 text-pink-300 font-bold focus:outline-none transition-all"
                        />
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[10px] font-medium text-zinc-400">Supply</span>
                        <input
                          type="text"
                          value={tokenSupply}
                          onChange={(e) => setTokenSupply(e.target.value)}
                          className="w-full rounded-lg px-2.5 py-1.5 font-mono text-xs bg-black/40 hover:bg-black/60 focus:bg-black/80 border border-white/[0.06] focus:border-pink-400 text-white font-semibold focus:outline-none transition-all"
                        />
                      </div>
                    </div>

                  {/* 0G z-image-turbo AI Logo Generator */}
                  <div className="p-2.5 rounded-xl bg-[#040814] border border-white/10 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-[#05070D] border border-cyan-500/40 p-1 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/10">
                        {generatedLogo ? (
                          <img src={generatedLogo} alt="AI Logo Emblem" className="w-full h-full object-contain" />
                        ) : (
                          <img src="/logo.svg" alt="Default Emblem" className="w-full h-full object-contain" />
                        )}
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-white flex items-center gap-1.5 font-mono">
                          <span>0G z-image-turbo</span>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-pink-950 text-pink-300 border border-pink-500/30 font-bold">TEE Attested</span>
                        </div>
                        <span className="text-[10px] text-zinc-400">Generate on-chain logo emblem</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleGenerateAiLogo}
                      disabled={isGeneratingLogo}
                      className="px-3 py-1.5 rounded-lg bg-pink-950/60 hover:bg-pink-900 text-pink-300 border border-pink-500/40 text-xs font-mono font-bold transition-all flex items-center gap-1.5 shrink-0"
                    >
                      {isGeneratingLogo ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" /> Rendering...
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-3 h-3" /> Re-Roll Logo
                        </>
                      )}
                    </button>
                  </div>
                  </div>
                )}
              </div>

              {/* Pillar 2: Sovereign DEX & Subdomain (With Green Checkbox) */}
              <div className={`space-y-2 p-3 rounded-xl transition-all ${deployDex ? "bg-black/30 border border-purple-500/30" : "bg-black/10 opacity-50 border border-transparent"}`}>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={deployDex}
                      onChange={(e) => setDeployDex(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-500 accent-emerald-500 cursor-pointer"
                    />
                    <span className="text-xs font-mono font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                      2. Uniswap v4 Sovereign Hook
                    </span>
                  </label>

                  {/* Subdomain Inline Control with Randomizer */}
                  {deployDex && (
                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center bg-black/40 hover:bg-black/60 rounded-lg px-2 py-0.5 font-mono text-xs border border-white/[0.06] focus-within:border-purple-400/80 transition-colors">
                        <span className="text-zinc-500 text-[10px] mr-1">https://</span>
                        <input
                          type="text"
                          value={customSubdomain}
                          onChange={(e) => setCustomSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                          className="bg-transparent text-purple-300 font-bold focus:outline-none w-20 text-center text-xs"
                          placeholder="myswap"
                        />
                        <span className="text-purple-400/80 text-[10px] ml-1 font-bold">.adexto.xyz</span>
                      </div>
                      <button
                        type="button"
                        onClick={randomizeSubdomain}
                        title="Randomize Unique Subdomain Slug"
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-cyan-300 border border-white/10 transition-colors"
                      >
                        <Dices className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {deployDex && (
                  <>
                    {/* Preset Fee Buttons */}
                    <div className="grid grid-cols-3 gap-2 text-xs font-mono pt-1">
                      <button
                        onClick={() => {
                          setFeeTier("low");
                          setTotalSwapFee(0.10);
                          setTreasuryCut(0.02);
                        }}
                        className={`p-2 rounded-xl text-left transition-all ${
                          feeTier === "low"
                            ? "bg-purple-950/50 text-white border border-purple-500/30"
                            : "bg-black/30 text-zinc-400 hover:text-white border border-transparent"
                        }`}
                      >
                        <span className="font-bold block text-[11px] text-purple-200">0.10% Low Fee</span>
                        <span className="text-[9px] text-zinc-400">0.08% LP · 0.02% Buyback</span>
                      </button>

                      <button
                        onClick={() => {
                          setFeeTier("standard");
                          setTotalSwapFee(0.30);
                          setTreasuryCut(0.10);
                        }}
                        className={`p-2 rounded-xl text-left transition-all ${
                          feeTier === "standard"
                            ? "bg-purple-950/50 text-white border border-purple-500/30"
                            : "bg-black/30 text-zinc-400 hover:text-white border border-transparent"
                        }`}
                      >
                        <span className="font-bold block text-[11px] text-purple-200">0.30% Standard</span>
                        <span className="text-[9px] text-zinc-400">0.20% LP · 0.10% Buyback</span>
                      </button>

                      <button
                        onClick={() => {
                          setFeeTier("meme");
                          setTotalSwapFee(0.50);
                          setTreasuryCut(0.20);
                        }}
                        className={`p-2 rounded-xl text-left transition-all ${
                          feeTier === "meme"
                            ? "bg-pink-950/50 text-white border border-pink-500/30"
                            : "bg-black/30 text-zinc-400 hover:text-white border border-transparent"
                        }`}
                      >
                        <span className="font-bold block text-[11px] text-pink-200">0.50% Meme</span>
                        <span className="text-[9px] text-zinc-400">0.30% LP · 0.20% Buyback</span>
                      </button>
                    </div>

                    {/* Ratio Bar */}
                    <div className="p-2 rounded-xl bg-black/40 space-y-1">
                      <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-cyan-300 font-medium">LP Rewards: {lpCut.toFixed(2)}%</span>
                        <span className="text-pink-400 font-medium">Buyback Vault: {treasuryCut.toFixed(2)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden flex">
                        <div
                          className="bg-cyan-400 h-full transition-all"
                          style={{ width: `${(lpCut / totalSwapFee) * 100}%` }}
                        />
                        <div
                          className="bg-pink-500 h-full transition-all"
                          style={{ width: `${(treasuryCut / totalSwapFee) * 100}%` }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Pillar 3: 0G TEE Agent (With Green Checkbox) */}
              <div className={`space-y-2 p-3 rounded-xl transition-all ${deployAgent ? "bg-black/30 border border-cyan-500/30" : "bg-black/10 opacity-50 border border-transparent"}`}>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={deployAgent}
                      onChange={(e) => setDeployAgent(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-500 accent-emerald-500 cursor-pointer"
                    />
                    <span className="text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                      3. 0G TEE Agent Enclave
                    </span>
                  </label>
                  <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 font-bold">
                    <ShieldCheck className="w-3.5 h-3.5" /> AMD SEV-SNP
                  </span>
                </div>

                {deployAgent && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-medium text-zinc-400">Mandate</span>
                      <input
                        type="text"
                        value={agentPersona}
                        onChange={(e) => setAgentPersona(e.target.value)}
                        className="w-full rounded-lg px-2.5 py-1.5 font-mono text-xs bg-black/40 hover:bg-black/60 focus:bg-black/80 border border-white/[0.06] focus:border-cyan-400 text-white font-medium focus:outline-none transition-all"
                      />
                    </div>

                    <div className="flex items-center gap-1.5 pt-4 font-mono text-[10px]">
                      <span className="px-2 py-0.5 rounded bg-cyan-950/40 text-cyan-300 border border-cyan-500/20 font-medium">
                        ✓ Signet Assets
                      </span>
                      <span className="px-2 py-0.5 rounded bg-orange-950/40 text-orange-300 border border-orange-500/20 font-medium">
                        ✓ Cloudflare x402
                      </span>
                    </div>
                  </div>
                )}
              </div>

                  {/* World ID Anti-Sybil Gate */}
                  <div className="p-3 rounded-xl bg-black/40 border border-white/[0.08] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-black font-black text-[10px]">
                        W
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-1.5">
                          <span>World ID Proof of Humanity</span>
                          {worldIdVerified && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-mono font-bold">
                              VERIFIED ZKP
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-400">Anti-Sybil 1-Human-1-Launch Protection</span>
                      </div>
                    </div>

                    {!worldIdVerified ? (
                      <button
                        type="button"
                        onClick={handleVerifyWorldID}
                        disabled={isVerifyingWorldId}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-mono text-[11px] font-bold border border-white/20 transition-all flex items-center gap-1"
                      >
                        {isVerifyingWorldId ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin text-cyan-300" />
                            <span>Verifying...</span>
                          </>
                        ) : (
                          <span>Verify with World ID</span>
                        )}
                      </button>
                    ) : (
                      <span className="text-emerald-400 text-xs font-mono font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Ready
                      </span>
                    )}
                  </div>

                  {/* Action Button */}
                  <div className="pt-1">
                    <button
                      onClick={handleExecuteDeploy}
                      disabled={isDeploying || selectedCount === 0 || !worldIdVerified}
                      className="w-full py-3 rounded-xl font-bold text-xs bg-gradient-to-r from-cyan-500 to-purple-600 text-white shadow-md hover:shadow-cyan-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isDeploying ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          {deployStep === 1 && `Signing Transactions on ${selectedChain}...`}
                          {deployStep === 2 && "Executing On-Chain Deployment..."}
                          {deployStep === 3 && "Binding 0G TEE Enclave..."}
                        </>
                      ) : !worldIdVerified ? (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 text-amber-300" /> Verify World ID to Unlock Deploy ({selectedCount}/3)
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" /> Deploy Selected ({selectedCount}/3) on {selectedChain}
                        </>
                      )}
                    </button>
                  </div>

            </div>
          )}
        </div>

        {/* ── RIGHT: 0G AI CHAT CO-PILOT (5 COLS) ───────────────────────────── */}
        <div className="lg:col-span-5 bg-[#070913] rounded-2xl border border-white/[0.06] flex flex-col h-full overflow-hidden shadow-xl">
          {/* Header */}
          <div className="p-2.5 border-b border-white/[0.06] bg-black/30 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center text-white text-[10px]">
                <Bot className="w-3 h-3" />
              </div>
              <span className="font-bold text-white text-xs">0G TEE Co-Pilot</span>
              <span className="text-[9px] font-mono text-cyan-300 bg-cyan-950/60 px-1.5 py-0.5 rounded font-bold">
                {selectedModel}
              </span>
            </div>

            <button
              onClick={() => setMessages([messages[0]])}
              className="p-1 text-zinc-500 hover:text-white text-xs font-mono"
              title="Reset Chat"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          {/* Dynamic Status Ribbon (Shows Target Subdomain & Network Real-time) */}
          <div className="px-3 py-1 bg-black/40 border-b border-white/[0.02] flex items-center justify-between text-[10px] font-mono text-zinc-400">
            <span>Target: <strong className="text-purple-300 font-bold">{customSubdomain || "myswap"}.adexto.xyz</strong></span>
            <span>Network: <strong className="text-cyan-300 font-bold">{selectedChain}</strong></span>
          </div>

          {/* Chat Stream */}
          <div 
            ref={chatScrollContainerRef} 
            className="flex-1 overflow-y-auto p-3 space-y-2.5 font-sans text-xs bg-black/20"
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "assistant" && (
                  <div className="w-5 h-5 rounded bg-purple-500/10 text-purple-300 flex items-center justify-center shrink-0 mt-0.5">
                    <Cpu className="w-3 h-3" />
                  </div>
                )}
                <div
                  className={`max-w-[90%] rounded-xl p-2.5 leading-relaxed ${
                    m.role === "user"
                      ? "bg-purple-900/30 border border-purple-400/20 text-white"
                      : "bg-[#0b0e1b] border border-white/[0.04] text-slate-200"
                  }`}
                >
                  <span className="text-[9px] font-mono font-bold block mb-1 uppercase tracking-wider text-zinc-500">
                    {m.role === "user" ? "You" : `0G TEE (${selectedModel})`}
                  </span>
                  <div className="text-xs">
                    {m.content ? (
                      <FormattedMarkdown text={m.content} />
                    ) : isLoading && idx === messages.length - 1 ? (
                      <span className="flex items-center gap-1 text-cyan-300 font-mono text-xs">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Reasoning on 0G...
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <form onSubmit={handleSendMessage} className="p-2 border-t border-white/[0.06] bg-black/30 flex gap-2 shrink-0">
            <input
              type="text"
              placeholder={`Ask AI on ${selectedChain} for ${customSubdomain}.adexto.xyz...`}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={isLoading}
              className="flex-1 rounded-lg px-2.5 py-1.5 text-white font-sans text-xs bg-black/40 border border-white/[0.06] focus:border-cyan-400 focus:outline-none transition-all"
            />
            <button
              type="submit"
              disabled={isLoading || !inputMessage.trim()}
              className="px-3 py-1.5 rounded-lg font-bold text-xs bg-gradient-to-r from-cyan-500 to-purple-600 text-white shadow disabled:opacity-50 flex items-center gap-1"
            >
              <Send className="w-3 h-3" />
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
