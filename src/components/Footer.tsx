import Link from "next/link";
import { Terminal, Shield, Cpu, Zap, Github, Twitter, Layers, CloudLightning } from "lucide-react";

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#020306] relative z-10 text-zinc-300 text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl overflow-hidden border border-white/20 p-1 bg-[#05070D]">
                <img src="/logo.svg" alt="ADEXTO Protocol Logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <span className="font-black text-white tracking-wide text-base block leading-tight">ADEXTO PROTOCOL</span>
                <span className="text-[10px] font-mono text-zinc-400">Autonomous Decentralized EXchange &amp; Token Orchestrator</span>
              </div>
            </div>
            <p className="text-zinc-300 leading-relaxed text-xs">
              Autonomous Decentralized EXchange &amp; Token Orchestrator powered by 0G Private Computer (TEE) &amp; Cloudflare Workers Edge x402.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                ● 0G TEE Mainnet Ready
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-orange-500/10 text-orange-300 border border-orange-500/30">
                Cloudflare x402 Edge
              </span>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-zinc-100 mb-3 uppercase tracking-wider text-xs">Protocol &amp; Apps</h4>
            <ul className="space-y-2 text-zinc-300">
              <li><Link href="/studio" className="hover:text-cyan-300 transition-colors">Launch Studio</Link></li>
              <li><Link href="/explorer" className="hover:text-cyan-300 transition-colors">Live Explorer</Link></li>
              <li><Link href="/swap" className="hover:text-cyan-300 transition-colors">Sovereign DEX Swap</Link></li>
              <li><Link href="/agent/demo" className="hover:text-cyan-300 transition-colors">Cloudflare x402 Demo</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-zinc-100 mb-3 uppercase tracking-wider text-xs">Architecture &amp; Trust</h4>
            <ul className="space-y-2 text-zinc-300">
              <li><Link href="/whitepaper" className="hover:text-cyan-300 transition-colors">Whitepaper &amp; Tokenomics</Link></li>
              <li><Link href="/pitch" className="hover:text-cyan-300 transition-colors">VC Memorandum &amp; Grants</Link></li>
              <li><Link href="/docs" className="hover:text-cyan-300 transition-colors">EVIDIQ MCP Suite</Link></li>
              <li><Link href="/docs#0g-tee" className="hover:text-cyan-300 transition-colors">0G TEE Verifiable Compute</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-zinc-100 mb-3 uppercase tracking-wider text-xs">Supported EVM Chains</h4>
            {/* Dulu empat baris berkotak dengan border cyan/sky/ungu/biru dan empat
                titik berkedip. Kolom footer lain berupa daftar polos, jadi kotak
                pelangi ini terlihat seperti tabel yang tersesat — dan empat animasi
                berkedip sekaligus hanya menarik mata tanpa memberi informasi.
                Sekarang: satu daftar, pemisah hairline, angka rata kanan. */}
            <ul className="divide-y divide-white/[0.06] text-xs">
              {[
                { name: "0G Mainnet", id: "16661" },
                { name: "Arbitrum One", id: "42161" },
                { name: "Monad Mainnet", id: "143" },
                { name: "Base Mainnet", id: "8453" },
              ].map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-zinc-300">{c.name}</span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {c.id} <span className="text-emerald-400/90">Live</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

      <div className="mt-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-400">
        <p>© 2026 ADEXTO (adexto.xyz). All rights reserved. Zero central points of failure.</p>
        <div className="flex items-center gap-4">
          <a
            href="https://x.com/adexto_"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-zinc-300 hover:text-cyan-300 transition-colors font-mono font-semibold"
          >
            <Twitter className="w-4 h-4" />
            <span>@adexto_</span>
          </a>
          <a
            href="https://github.com/0xcuy/adexto"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-zinc-300 hover:text-purple-300 transition-colors font-mono font-semibold"
          >
            <Github className="w-4 h-4" />
            <span>GitHub</span>
          </a>
        </div>
      </div>
      </div>
    </footer>
  );
}
