import Link from "next/link";
import { SearchX, Compass, Sparkles } from "lucide-react";

export default function TokenNotFound() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-24 text-center space-y-6">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-danger/10 border border-danger/30 flex items-center justify-center">
        <SearchX className="w-8 h-8 text-danger" />
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink">Market not found</h1>
        <p className="text-sm text-ink-soft max-w-md mx-auto leading-relaxed">
          No ADEXTO market is registered under this ticker. Only tokens minted by{" "}
          <code className="text-accent font-mono text-xs">AdextoCurveFactory</code> and confirmed on-chain get a
          terminal page, so an unknown ticker will never render a tradable market.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
        <Link
          href="/explorer"
          className="px-5 py-2.5 rounded-xl bg-cream-3 hover:bg-cream-3 text-ink font-bold text-sm flex items-center gap-2 transition-colors"
        >
          <Compass className="w-4 h-4" /> Browse live markets
        </Link>
        <Link
          href="/studio"
          className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-strong text-white font-bold text-sm flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> Launch a token
        </Link>
      </div>
    </div>
  );
}
