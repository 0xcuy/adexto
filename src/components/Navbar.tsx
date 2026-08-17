"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Compass, ArrowDownUp, CloudLightning, BookOpen, 
  Award, ShieldCheck, LogOut, Wallet, Sparkles, Vote
} from "lucide-react";
import { useWallet } from "@/context/WalletContext";

export default function Navbar() {
  const pathname = usePathname();
  const { address, isConnected, isConnecting, connectWallet, disconnectWallet, chainName } = useWallet();

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
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/20 p-1 bg-[#05070D] group-hover:border-cyan-400/60 transition-all shadow-lg shadow-purple-500/10">
              <img src="/logo.svg" alt="ADEXTO Protocol Logo" className="w-full h-full object-contain" />
            </div>
            <div className="flex flex-col text-left">
              <span className="font-black tracking-tight text-white flex items-center gap-1.5 text-base leading-tight">
                ADEXTO
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  adexto.xyz
                </span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400">Autonomous DeFi &amp; Token OS</span>
            </div>
          </Link>

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

        {/* Web3 Wallet Connect Button */}
        <div className="flex items-center gap-3">
          {isConnected ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex flex-col text-right font-mono text-[10px]">
                <span className="text-emerald-400 font-bold flex items-center gap-1 justify-end">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {chainName}
                </span>
                <span className="text-zinc-400">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
              </div>
              <button
                onClick={disconnectWallet}
                className="p-2 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-300 transition-all text-xs flex items-center gap-1"
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
              <span className="relative px-4 py-2 transition-all ease-in duration-200 bg-[#07080d] rounded-[10px] group-hover:bg-transparent flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-cyan-300" />
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </span>
            </button>
          )}

          <Link
            href="/studio"
            className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            Studio Cockpit
          </Link>
        </div>
      </div>
    </header>
  );
}
