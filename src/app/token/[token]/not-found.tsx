import Link from "next/link";
import { SearchX, Compass, Sparkles } from "lucide-react";

export default function TokenNotFound() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-24 text-center space-y-6">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-red-950/40 border border-red-500/30 flex items-center justify-center">
        <SearchX className="w-8 h-8 text-red-400" />
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-black text-white">Market not found</h1>
        <p className="text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
          No ADEXTO market is registered under this ticker. Only tokens minted by{" "}
          <code className="text-cyan-300 font-mono text-xs">AdextoTrinityFactoryV2</code> and confirmed on-chain get a
          terminal page, so an unknown ticker will never render a tradable market.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
        <Link
          href="/explorer"
          className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-sm flex items-center gap-2 transition-colors"
        >
          <Compass className="w-4 h-4" /> Browse live markets
        </Link>
        <Link
          href="/studio"
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-bold text-sm flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> Launch a token
        </Link>
      </div>
    </div>
  );
}
