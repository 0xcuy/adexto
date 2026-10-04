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
  /** lg = area sentuh 40×40 px di ponsel, 30×30 px di desktop (baris daftar explorer). */
  size?: "sm" | "md" | "lg";
}) {
  const { has, toggle, ready } = useWatchlist();
  const key = watchKey(chainId, symbol);
  const on = ready && has(key);
  // px, bukan kelas rem: rem situs ini 14 px, jadi `h-10` hanya 35 px.
  const box =
    size === "lg"
      ? "h-[40px] w-[40px] rounded-xl lg:h-[30px] lg:w-[30px] lg:rounded-lg"
      : size === "sm"
      ? "h-7 w-7 rounded-lg"
      : "h-8 w-8 rounded-lg";
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
      className={`inline-flex ${box} shrink-0 items-center justify-center border transition-colors ${
        on ? "border-warn/40 bg-warn/10 text-warn" : "border-line bg-surface text-ink-faint hover:text-ink"
      }`}
    >
      <Star className={icon} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
