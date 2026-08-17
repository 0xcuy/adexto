"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Compass, ArrowDownUp, CloudLightning, BookOpen, 
  Award, ShieldCheck, LogOut, Wallet, Sparkles, Vote, Menu, X, Twitter, Github
} from "lucide-react";
import { useWallet } from "@/context/WalletContext";

export default function Navbar() {
  const pathname = usePathname();
  const { address, isConnected, isConnecting, connectWallet, disconnectWallet, chainName } = useWallet();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const links = [
    { href: "/explorer", label: "Live Explorer", icon: Compass },
    { href: "/swap", label: "DEX Swap", icon: ArrowDownUp },
    { href: "/governance", label: "DAO Governance", icon: Vote },
    { href: "/agent/demo", label: "TEE Demo (x402)", icon: CloudLightning },
    { href: "/pitch", label: "Grant Deck", icon: Award },
    { href: "/docs", label: "Specs", icon: ShieldCheck },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#04060a]/95 backdrop-blur-2xl">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3 group" onClick={() => setMobileMenuOpen(false)}>
            <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/20 p-1 bg-[#05070D] group-hover:border-cyan-400/60 transition-all shadow-lg shadow-purple-500/10 shrink-0">
              <img src="/logo.svg" alt="ADEXTO Protocol Logo" className="w-full h-full object-contain" />
            </div>
            <div className="flex flex-col text-left">
              <span className="font-black tracking-tight text-white flex items-center gap-1.5 text-base leading-tight">
                ADEXTO
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  adexto.xyz
                </span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400">Autonomous DeFi OS</span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {links.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    active
                      ? "text-cyan-300 bg-cyan-500/20 border border-cyan-500/40 shadow-sm"
                      : "text-zinc-300 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Social Icons Desktop */}
          <div className="hidden md:flex items-center gap-1.5 border-r border-white/10 pr-2 mr-1">
            <a
              href="https://x.com/adexto_"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-xl text-zinc-400 hover:text-cyan-300 hover:bg-white/5 transition-colors"
              title="X (Twitter) @adexto_"
            >
              <Twitter className="w-4 h-4" />
            </a>
            <a
              href="https://github.com/0xcuy/adexto"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-xl text-zinc-400 hover:text-purple-300 hover:bg-white/5 transition-colors"
              title="GitHub Open-Source Repo"
            >
              <Github className="w-4 h-4" />
            </a>
          </div>

          {/* Web3 Wallet Connect Button */}
          {isConnected ? (
            <div className="flex items-center gap-2">
              <div className="flex flex-col text-right font-mono text-[10px]">
                <span className="text-emerald-400 font-bold flex items-center gap-1 justify-end">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {chainName.split(" ")[0]}
                </span>
                <span className="text-zinc-400 text-[9px]">{address?.slice(0, 4)}...{address?.slice(-3)}</span>
              </div>
              <button
                onClick={disconnectWallet}
                className="p-1.5 sm:p-2 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-300 transition-all text-xs flex items-center gap-1"
                title="Disconnect Wallet"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              disabled={isConnecting}
              className="relative inline-flex items-center justify-center p-0.5 overflow-hidden rounded-xl font-black text-xs group bg-gradient-to-br from-cyan-500 via-purple-600 to-pink-500 text-white shadow-lg shadow-purple-500/30 hover:shadow-cyan-500/50 transition-all duration-300"
            >
              <span className="relative px-3 sm:px-4 py-1.5 sm:py-2 transition-all ease-in duration-200 bg-[#07080d] rounded-[10px] group-hover:bg-transparent flex items-center gap-1.5 text-[11px] sm:text-xs">
                <Wallet className="w-3.5 h-3.5 text-cyan-300" />
                {isConnecting ? "Connecting..." : "Connect"}
              </span>
            </button>
          )}

          <Link
            href="/studio"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-xs font-black bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            Studio
          </Link>

          {/* Mobile Hamburger Toggle Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-xl bg-[#080d1a] border border-white/15 text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Toggle Mobile Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5 text-cyan-300" /> : <Menu className="w-5 h-5 text-slate-200" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-[#050813]/98 border-b border-white/15 px-4 py-4 space-y-2 backdrop-blur-2xl shadow-2xl animate-fadeIn">
          <div className="grid grid-cols-2 gap-2 pb-2 border-b border-white/10">
            <Link
              href="/studio"
              onClick={() => setMobileMenuOpen(false)}
              className="p-3 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-bold text-xs flex items-center gap-2 shadow-md"
            >
              <Sparkles className="w-4 h-4 text-white" />
              <span>Studio Launchpad</span>
            </Link>
            <Link
              href="/swap"
              onClick={() => setMobileMenuOpen(false)}
              className="p-3 rounded-xl bg-[#0a1024] border border-purple-500/30 text-purple-300 font-bold text-xs flex items-center gap-2"
            >
              <ArrowDownUp className="w-4 h-4" />
              <span>DEX Swap</span>
            </Link>
          </div>

          <div className="space-y-1 pt-1 font-mono text-xs">
            {links.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${
                    active
                      ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 text-cyan-400" />
                    <span>{link.label}</span>
                  </div>
                  <span className="text-[10px] text-zinc-500">→</span>
                </Link>
              );
            })}
          </div>

          {/* Social Links on Mobile */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10 font-mono text-xs">
            <a
              href="https://x.com/adexto_"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-white/5 text-zinc-300 hover:text-cyan-300 flex items-center justify-center gap-2"
            >
              <Twitter className="w-4 h-4" />
              <span>@adexto_</span>
            </a>
            <a
              href="https://github.com/0xcuy/adexto"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-white/5 text-zinc-300 hover:text-purple-300 flex items-center justify-center gap-2"
            >
              <Github className="w-4 h-4" />
              <span>GitHub</span>
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
