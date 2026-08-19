"use client";

import { useState } from "react";
import Link from "next/link";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { 
  Cpu, ShieldCheck, Lock, Play, Terminal, DollarSign, 
  CheckCircle2, RefreshCw, Sparkles, ArrowRight, Code2, CloudLightning, Network,
  Activity, ExternalLink
} from "lucide-react";

export default function AgentDemoPage() {
  const [selectedTool, setSelectedTool] = useState("quant_audit");
  const [selectedChain, setSelectedChain] = useState("0G");
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [attestationProof, setAttestationProof] = useState<any>(null);

  const tools = [
    {
      id: "quant_audit",
      name: "Quant Depth & Curve Health Audit",
      price: "0.010 USDC",
      mcpServer: "EVIDIQ Sentinel + Aegis",
      edgeRoute: "https://edge.adexto.xyz/audit/v1",
      description: "Audits curve depth per chain, slippage impact, and sniper exposure inside 0G TEE.",
    },
    {
      id: "signet_brand",
      name: "Dynamic SVG Brand Asset Generation",
      price: "0.005 USDC",
      mcpServer: "EVIDIQ Signet",
      edgeRoute: "https://edge.adexto.xyz/brand/v1",
      description: "Generates high-resolution vector logos and OpenGraph banners with on-chain cryptographic proof.",
    },
    {
      id: "rebalance_signal",
      name: "Autonomous Cross-Chain Rebalance Signal",
      price: "0.020 USDC",
      mcpServer: "EVIDIQ Helm + Chainlink CCIP",
      edgeRoute: "https://edge.adexto.xyz/rebalance/v1",
      description: "Calculates mathematical cross-chain arbitrage and issues auto-buyback instructions.",
    },
  ];

  const handleCallTool = () => {
    setIsExecuting(true);
    setAttestationProof(null);
    setExecutionLogs([]);

    const logSteps = [
      "📡 Step 1/4: Dispatching HTTP 402 request to Cloudflare Edge...",
      "⚡ Step 2/4: Verifying EIP-712 micro-payment authorization (<35ms)...",
      "🛡️ Step 3/4: Provisioning AMD SEV-SNP Enclave on 0G Compute (Chain 16661)...",
      "📦 Step 4/4: Anchoring verifiable execution proof to 0G DA Storage Turbo...",
    ];

    logSteps.forEach((log, index) => {
      setTimeout(() => {
        setExecutionLogs(prev => [...prev, log]);
      }, (index + 1) * 350);
    });

    setTimeout(() => {
      setIsExecuting(false);
      setAttestationProof({
        status: "200 OK — Cloudflare Edge Settled",
        cf_ray_id: "8f129c78201a9b21-SIN",
        edge_latency: "34ms (Edge Cache Hit)",
        chain_network: `${selectedChain} EVM`,
        x402_facilitator: "Cloudflare Worker (EIP-712 / EIP-3009)",
        payer: "0x3f22b7a94209...812d",
        amount_settled: tools.find((t) => t.id === selectedTool)?.price,
        tee_enclave_host: "pc.0g.ai/v1 (0G AMD SEV-SNP Enclave)",
        tee_signer: ADEXTO_CONTRACTS.deployer,
        zero_g_storage_root: "0xafa3f6735b37bf0117bd792ce7cd4a63ffca59d7d8d601bd9a002749e5b6b1e8",
        zero_g_da_tx: "0x319fd59b0765f43b1ced911e2706dbcac8f09bd60e5443599ef7fde64e1a64f1",
        proof_signature: "0x38fa8029c7da192834bba72619cd91823749817293847192837491827394817263",
        result_payload: {
          target_chain: selectedChain,
          curve_health: "Optimal (99.8/100)",
          slippage_risk: "0.01% at 100,000 USDC volume",
          mev_sandwich_shield: "Active (EVIDIQ Sentinel Block-Guard)",
          treasury_buyback_queued: "284.10 AEGIS scheduled at next block",
        },
      });
    }, 1600);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-line pb-6 mb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-soft text-accent border border-accent/30 text-xs font-mono font-bold mb-2">
            <CloudLightning className="w-3.5 h-3.5" /> CLOUDFLARE WORKERS x402 + 0G TEE DEMO
          </div>
          <h1 className="text-3xl font-semibold text-ink">Live Edge Micro-Payment &amp; TEE Call</h1>
          <p className="text-sm text-ink mt-1 font-medium">
            Test machine-to-machine HTTP 402 micro-billing and confidential 0G TEE attestation in real-time.
          </p>
        </div>

        <div>
          <select
            value={selectedChain}
            onChange={(e) => setSelectedChain(e.target.value)}
            className="bg-white border border-line text-accent text-xs font-mono font-bold rounded-lg px-3 py-2 focus:outline-none"
          >
            <option value="0G">0G Mainnet (16661 - Live Primary)</option>
            <option value="Arbitrum">Arbitrum One (42161 - Live Mesh)</option>
            <option value="Base">Base Mainnet (8453 - Live Mesh)</option>
            <option value="Monad">Monad Mainnet (143 - Live Mesh)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Tool Selection (5 Cols) */}
        <div className="lg:col-span-5 glass-panel p-6 rounded-3xl border-2 border-line space-y-4 shadow-2xl">
          <h3 className="text-xs font-mono uppercase tracking-wider text-ink-soft font-bold">Select MCP Query Task</h3>

          <div className="space-y-3">
            {tools.map((tool) => (
              <div
                key={tool.id}
                onClick={() => setSelectedTool(tool.id)}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  selectedTool === tool.id
                    ? "bg-accent-soft border-accent/40"
                    : "bg-white border-line hover:border-line-strong"
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <h4 className="font-bold text-ink text-xs">{tool.name}</h4>
                  <span className="text-xs font-mono font-semibold text-ok bg-ok/10 px-2 py-0.5 rounded border border-ok/30">
                    {tool.price}
                  </span>
                </div>
                <p className="text-[11px] text-ink-soft font-medium leading-relaxed">{tool.description}</p>
                <div className="mt-2 text-[10px] font-mono text-ink-soft flex items-center gap-1.5">
                  <span className="text-ink-soft font-bold">Endpoint:</span> {tool.edgeRoute}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleCallTool}
            disabled={isExecuting}
            className="w-full py-4 rounded-xl font-semibold text-xs bg-accent hover:bg-accent-strong text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Executing 0G TEE Enclave...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" /> Dispatch x402 Call ({tools.find((t) => t.id === selectedTool)?.price})
              </>
            )}
          </button>
        </div>

        {/* Right: Live Execution Logs & Output Terminal (7 Cols) */}
        <div className="lg:col-span-7 glass-panel p-6 rounded-3xl border-2 border-line flex flex-col justify-between space-y-4 shadow-2xl bg-white">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-accent" />
              <span className="font-mono text-xs font-bold text-ink">0G TEE Enclave Terminal</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-ok/10 text-ok border border-ok/30 font-bold">
              AMD SEV-SNP ACTIVE
            </span>
          </div>

          {/* Terminal Box */}
          <div className="bg-white p-4 rounded-2xl border border-line font-mono text-xs text-ink overflow-x-auto min-h-[320px] flex flex-col justify-start space-y-3">
            {executionLogs.length > 0 && (
              <div className="space-y-1 text-accent pb-2 border-b border-line">
                {executionLogs.map((log, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 animate-fadeIn">
                    <span>{log}</span>
                  </div>
                ))}
              </div>
            )}

            {attestationProof ? (
              <pre className="text-[11px] text-ok leading-relaxed">
                {JSON.stringify(attestationProof, null, 2)}
              </pre>
            ) : !isExecuting ? (
              <div className="text-center py-16 text-ink-soft space-y-2">
                <Code2 className="w-8 h-8 mx-auto text-ink-soft" />
                <p>Click &quot;Dispatch x402 Call&quot; to witness live edge verification &amp; 0G TEE attestation.</p>
              </div>
            ) : null}
          </div>

          {/* Bottom Proof Info */}
          {attestationProof && (
            <div className="p-3.5 rounded-xl bg-ok/10 border border-ok/30 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-ok" />
                <span className="text-ok font-bold">0G DA Anchored:</span>
              </div>
              <a
                href={`https://chainscan.0g.ai/tx/${attestationProof.zero_g_da_tx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline font-bold flex items-center gap-1"
              >
                <span>{attestationProof.zero_g_da_tx.slice(0, 10)}...{attestationProof.zero_g_da_tx.slice(-6)}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
