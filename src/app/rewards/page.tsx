import type { Metadata } from "next";
import RewardsClient from "./RewardsClient";

/** `/rewards` (P2.5): tautan referral, handle, dan angka yang dirujuk. Isi interaktifnya di `RewardsClient`. */
export const metadata: Metadata = {
  title: "Referrals · ADEXTO",
  description: "Share an ADEXTO link and get credit for the trades it brings. Credit is carried in the transaction itself.",
};

export default function RewardsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <p className="kicker mb-2">Referrals</p>
        <h1 className="font-display text-[28px] font-light leading-[1.1] tracking-tight text-ink sm:text-[36px]">Bring traders, get credit</h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-ink-soft">
          Share a link with your code. When someone opens it and trades on ADEXTO, the trade carries your address on chain and counts toward
          your weekly total.
        </p>
      </div>
      <RewardsClient />
    </div>
  );
}
