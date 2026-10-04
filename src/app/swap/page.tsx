import { Suspense } from "react";
import SwapHub from "@/components/swap/SwapHub";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Swap · ADEXTO",
  description:
    "Trade ADEXTO agent tokens against each market's own bonding curve, or move native assets and stablecoins between Monad, Arbitrum, Robinhood, Base and 0G.",
};

export default function SwapPage() {
  return (
    <Suspense
      fallback={
        // Full viewport tall on purpose. The page streams this fallback first and swaps the real
        // content in a moment later; with a short fallback the footer is painted near the top and
        // then jumps below the fold, which measured as a 0.3–0.57 layout shift on a slow first paint.
        <div className="mx-auto min-h-[100vh] max-w-md px-4 py-24 text-center font-mono text-sm text-ink-soft">
          Loading markets…
        </div>
      }
    >
      <SwapHub />
    </Suspense>
  );
}
