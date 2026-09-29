"use client";

import { Star } from "lucide-react";
import { useWatchlist, watchKey } from "@/lib/watchlist";

/** Tombol bintang watchlist untuk satu pasar (`chainId:SYMBOL`). */
export default function WatchStar({
  chainId,
  symbol,
  size = "md",
}: {
  chainId: number;
  symbol: string;
  size?: "sm" | "md";
}) {
  const { has, toggle, ready } = useWatchlist();
  const key = watchKey(chainId, symbol);
  const on = ready && has(key);
  const box = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const icon = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      type="button"
      onClick={(e) => {
        // Di daftar explorer bintangnya duduk di dalam baris bertautan; klik bintang tidak boleh
        // sekaligus membuka pasarnya.
        e.preventDefault();
        e.stopPropagation();
        toggle(key);
      }}
      aria-pressed={on}
      aria-label={on ? `Remove $${symbol} from your watchlist` : `Add $${symbol} to your watchlist`}
      title={on ? "In your watchlist (stored in this browser only)" : "Add to watchlist (stored in this browser only)"}
      data-watch-star={key}
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-lg border transition-colors ${
        on ? "border-warn/40 bg-warn/10 text-warn" : "border-line bg-surface text-ink-faint hover:text-ink"
      }`}
    >
      <Star className={icon} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
