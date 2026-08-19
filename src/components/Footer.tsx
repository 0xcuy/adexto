import Link from "next/link";
import { Terminal, Shield, Cpu, Zap, Github, Twitter, Layers, CloudLightning } from "lucide-react";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-cream-2 relative z-10 text-ink-soft text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl overflow-hidden border border-line p-1 bg-white">
                <img src="/logo.svg" alt="ADEXTO Protocol Logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <span className="font-semibold text-ink tracking-wide text-base block leading-tight">ADEXTO PROTOCOL</span>
                <span className="text-[10px] font-mono text-ink-soft">Autonomous Decentralized EXchange &amp; Token Orchestrator</span>
              </div>
            </div>
            <p className="text-ink-soft leading-relaxed text-xs">
              Autonomous Decentralized EXchange &amp; Token Orchestrator powered by 0G Private Computer (TEE) &amp; Cloudflare Workers Edge x402.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-ok/10 text-ok border border-ok/30">
                ● 0G TEE Mainnet Ready
              </span>
              {/* Amber di sini dulu terbaca sebagai peringatan. Cloudflare x402
                  adalah nama fitur, bukan keadaan, jadi warna peringatan
                  dikembalikan untuk keperluan aslinya. */}
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-accent-soft text-accent border border-accent/30">
                Cloudflare x402 Edge
              </span>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-ink mb-3 uppercase tracking-wider text-xs">Protocol &amp; Apps</h4>
            <ul className="space-y-2 text-ink-soft">
              <li><Link href="/studio" className="hover:text-accent transition-colors">Launch Studio</Link></li>
              <li><Link href="/explorer" className="hover:text-accent transition-colors">Live Explorer</Link></li>
              <li><Link href="/swap" className="hover:text-accent transition-colors">Sovereign DEX Swap</Link></li>
              <li><Link href="/agent/demo" className="hover:text-accent transition-colors">Cloudflare x402 Demo</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-ink mb-3 uppercase tracking-wider text-xs">Architecture &amp; Trust</h4>
            <ul className="space-y-2 text-ink-soft">
              <li><Link href="/whitepaper" className="hover:text-accent transition-colors">Whitepaper &amp; Tokenomics</Link></li>
              <li><Link href="/pitch" className="hover:text-accent transition-colors">VC Memorandum &amp; Grants</Link></li>
              <li><Link href="/docs" className="hover:text-accent transition-colors">EVIDIQ MCP Suite</Link></li>
              <li><Link href="/docs#0g-tee" className="hover:text-accent transition-colors">0G TEE Verifiable Compute</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-ink mb-3 uppercase tracking-wider text-xs">Supported EVM Chains</h4>
            {/* Dulu empat baris berkotak dengan border cyan/sky/ungu/biru dan empat
                titik berkedip. Kolom footer lain berupa daftar polos, jadi kotak
                pelangi ini terlihat seperti tabel yang tersesat — dan empat animasi
                berkedip sekaligus hanya menarik mata tanpa memberi informasi.
                Sekarang: satu daftar, pemisah hairline, angka rata kanan. */}
            <ul className="divide-y divide-line/[0.06] text-xs">
              {[
                { name: "0G Mainnet", id: "16661" },
                { name: "Arbitrum One", id: "42161" },
                { name: "Monad Mainnet", id: "143" },
                { name: "Base Mainnet", id: "8453" },
              ].map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-ink-soft">{c.name}</span>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {c.id} <span className="text-ok/90">Live</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

      <div className="mt-8 pt-6 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink-soft">
        <p>© 2026 ADEXTO (adexto.xyz). All rights reserved. Zero central points of failure.</p>
        <div className="flex items-center gap-4">
          <a
            href="https://x.com/adexto_"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-ink-soft hover:text-accent transition-colors font-mono font-semibold"
          >
            <Twitter className="w-4 h-4" />
            <span>@adexto_</span>
          </a>
          <a
            href="https://github.com/0xcuy/adexto"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-ink-soft hover:text-accent transition-colors font-mono font-semibold"
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
