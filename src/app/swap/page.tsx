import { Suspense } from "react";
import SwapTerminal from "@/components/SwapTerminal";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sovereign DEX Swap · ADEXTO",
  description: "Swap native assets against ADEXTO agent tokens through each project's own sovereign bonding curve.",
};

export default function SwapPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto px-4 py-24 text-center font-mono text-sm text-ink-soft">
          Loading markets…
        </div>
      }
    >
      <SwapTerminal />
    </Suspense>
  );
}
