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
      label: "AdextoTrinityFactory (0G Mainnet 16661)",
      address: ADEXTO_CONTRACTS.og.factoryAddress,
      explorerUrl: `https://chainscan.0g.ai/address/${ADEXTO_CONTRACTS.og.factoryAddress}`,
      badge: "0G factory · v1",
      color: "border-accent/30 bg-accent-soft text-accent",
    },
    {
      label: "AdextoTrinityFactory (Arbitrum One 42161)",
      address: ADEXTO_CONTRACTS.arbitrum.factoryAddress,
      explorerUrl: `https://arbiscan.io/address/${ADEXTO_CONTRACTS.arbitrum.factoryAddress}`,
      badge: "Arbitrum factory · v1",
      color: "border-accent/30 bg-accent-soft text-accent",
    },
    {
      label: "SovereignHook AMM (Arbitrum One 42161)",
      address: ADEXTO_CONTRACTS.arbitrum.sovereignHookAddress,
      explorerUrl: `https://arbiscan.io/address/${ADEXTO_CONTRACTS.arbitrum.sovereignHookAddress}`,
      badge: "Arbitrum hook · v1",
      color: "border-accent/30 bg-accent-soft text-accent",
    },
    {
      label: "AdextoTrinityFactory (Base Mainnet 8453)",
      address: ADEXTO_CONTRACTS.base.factoryAddress,
      explorerUrl: `https://basescan.org/address/${ADEXTO_CONTRACTS.base.factoryAddress}`,
      badge: "Base factory · v1",
      color: "border-accent/30 bg-accent-soft text-accent",
    },
    {
      label: "SovereignHook AMM (Base Mainnet 8453)",
      address: ADEXTO_CONTRACTS.base.sovereignHookAddress,
      explorerUrl: `https://basescan.org/address/${ADEXTO_CONTRACTS.base.sovereignHookAddress}`,
      badge: "Base hook · v1",
      color: "border-accent/30 bg-accent-soft text-accent",
    },
    {
      label: "AdextoTrinityFactory (Monad Mainnet 143)",
      address: ADEXTO_CONTRACTS.monad.factoryAddress,
      explorerUrl: `https://monadvision.com/address/${ADEXTO_CONTRACTS.monad.factoryAddress}`,
      badge: "Monad factory · v1",
      color: "border-accent/30 bg-accent-soft text-accent",
    },
    {
      label: "SovereignHook AMM (Monad Mainnet 143)",
      address: ADEXTO_CONTRACTS.monad.sovereignHookAddress,
      explorerUrl: `https://monadvision.com/address/${ADEXTO_CONTRACTS.monad.sovereignHookAddress}`,
      badge: "Monad hook · v1",
      color: "border-accent/30 bg-accent-soft text-accent",
    },
    {
      label: "The Graph Subgraph (Decentralized Network Mainnet)",
      address: GRAPH_STUDIO_CONFIG.subgraphId,
      explorerUrl: GRAPH_STUDIO_CONFIG.explorerUrl,
      badge: "The Graph Published",
      color: "border-accent/30 bg-accent-soft text-accent",
    },
    {
      label: "SovereignHook AMM (0G Mainnet 16661)",
      address: ADEXTO_CONTRACTS.og.sovereignHookAddress,
      explorerUrl: `https://chainscan.0g.ai/address/${ADEXTO_CONTRACTS.og.sovereignHookAddress}`,
      badge: "0G hook · v1",
      color: "border-accent/30 bg-accent-soft text-accent",
    },
    {
      label: "0G DA Storage Attestation Root (Metadata Flow)",
      address: "0xeaa56a1fe9b216f0f58cc0957c8d4793451c69a423c5a73ad6e420749eb4509d",
      explorerUrl: `https://chainscan.0g.ai/tx/0xcfac6cd412f69cefeb2d509edf5dbdeef5dc0fb4613932223b99a4ce535b8c55`,
      badge: "0G DA Storage Turbo",
      color: "border-ok/30 bg-ok/10 text-ok",
    },
    {
      label: "Cloudflare Workers x402 Edge Paywall Gateway",
      address: ADEXTO_CONTRACTS.edgeX402Gateway,
      explorerUrl: ADEXTO_CONTRACTS.edgeX402Gateway,
      badge: "HTTP 402 Edge Active",
      color: "border-warn/30 bg-warn/10 text-warn",
    },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 py-10 overflow-hidden">
      {/* Tanpa bingkai luar: tabel di dalamnya sudah punya bingkai sendiri, dan
          setelah seksi lain dilepas bingkainya, kotak ini menjadi satu-satunya
          kotak besar di halaman — bingkai ganda yang justru menarik perhatian
          ke wadah, bukan ke isinya. */}
      <div className="relative overflow-hidden">
        {/* Glow Accent */}
        <div className="hidden sm:block absolute top-0 right-0 w-96 h-96 bg-accent-soft rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-line pb-6 mb-6">
          <div>
            {/* Badge ini dulu berbunyi "LIVE ON-CHAIN", padahal kontrak di bawah
                adalah generasi v1 dan factory v2 yang eksekutabel belum di-broadcast
                (`/api/deploy` melaporkan `dexLive: false`). Mengaku "live" sementara
                trading terkunci adalah klaim yang tidak bisa dipertahankan. */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cream-3 border border-line text-ink-soft text-xs font-mono font-bold mb-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-ok" />
              <span>DEPLOYED &amp; VERIFIABLE ON-CHAIN</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold text-ink flex items-center gap-2">
              <span>Deployed contract registry</span>
            </h2>
            <p className="text-xs sm:text-sm text-ink-soft mt-1">
              Addresses below are the <strong className="text-ink">v1</strong> generation, deployed and verifiable on
              each chain. The executable <code className="text-accent">AdextoTrinityFactoryV3</code> is not broadcast to
              mainnet yet, so launching and trading stay disabled in the UI until it is.
            </p>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-white border border-line text-ink-soft">
              RPC: <span className="text-accent font-bold">evmrpc.0g.ai</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-white border border-line text-ink-soft">
              DA: <span className="text-ok font-bold">indexer-turbo</span>
            </div>
          </div>
        </div>

        {/* Daftar kontrak.
            Dulu ini 11 kartu dalam grid dua kolom, masing-masing dengan kotak
            alamat sendiri dan dua tautan berlabel teks — satu bagian memakan
            hampir separuh tinggi halaman dan terbaca seperti dump basis data.
            Sekarang baris ramping: label, badge, alamat, dan dua aksi ikon.
            Data, tautan, dan logika salin tidak berubah. */}
        <div className="rounded-xl border border-line overflow-hidden">
          {/* Badge diberi kolom sendiri. Saat ia ikut mengalir bersama label,
              label panjang seperti "AdextoTrinityFactory (Arbitrum One 42161)"
              mendorong badge ke baris kedua dan tinggi baris jadi tidak rata. */}
          <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)_auto] items-center gap-3 border-b border-line bg-cream-3/[0.03] px-3 py-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Contract</span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Gen</span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Address</span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Verify</span>
          </div>

          <div className="divide-y divide-line/[0.06]">
            {records.map((rec, i) => {
              const isCopied = copiedKey === `rec_${i}`;
              return (
                <div
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 transition-colors hover:bg-cream-3/[0.025] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)_auto] sm:gap-3"
                >
                  <span className="min-w-0 truncate text-[11px] font-bold text-ink" title={rec.label}>
                    {rec.label}
                  </span>

                  <span
                    className={`justify-self-end whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider sm:justify-self-start ${rec.color}`}
                  >
                    {rec.badge}
                  </span>

                  <span className="addr col-span-2 min-w-0 truncate text-accent/90 sm:col-span-1" title={rec.address}>
                    {rec.address}
                  </span>

                  <div className="col-span-2 flex items-center gap-1 justify-end sm:col-span-1">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(rec.address, `rec_${i}`)}
                      title={isCopied ? "Copied" : "Copy address"}
                      aria-label={`Copy address for ${rec.label}`}
                      className="rounded-md p-1.5 text-ink-soft transition-colors hover:bg-cream-3 hover:text-ink"
                    >
                      {isCopied ? (
                        <Check className="h-3.5 w-3.5 text-ok" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <a
                      href={rec.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Verify on explorer"
                      aria-label={`Verify ${rec.label} on explorer`}
                      className="rounded-md p-1.5 text-accent transition-colors hover:bg-accent-soft hover:text-accent"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
