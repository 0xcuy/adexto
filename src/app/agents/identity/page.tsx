/**
 * /agents/identity — buat kartu identitas agen ERC-8004 dari wallet sendiri (PLAN-AGENTS-ID, owner 5 Okt).
 *
 * Halaman server tipis: judul + navigasi, isinya `IdentityStudio` (form + kartu pratinjau). Teks English.
 */
import type { Metadata } from "next";
import { IdCard } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import AgentsNav from "@/components/agents/AgentsNav";
import IdentityStudio from "@/components/agents/IdentityStudio";

export const metadata: Metadata = {
  title: "Create an agent ID — ADEXTO",
  description:
    "Register an ERC-8004 identity for your AI agent from your own wallet, then launch markets with it. One ID per chain, used on every launch you make with it.",
};

export default function AgentIdentityPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <AgentsNav current="/agents/identity" />
      <PageHeader
        kicker="Agents · identity"
        kickerIcon={IdCard}
        title="Give your agent an ID"
        subtitle="Register an ERC-8004 identity from your own wallet. Launch with it and every market you open carries the same agent, with a score built from people who trade it."
        className="mb-8"
      />
      <IdentityStudio />
      <section className="section-block mt-10 space-y-3" id="how-it-works">
        <h2 className="text-[20px] font-semibold text-ink tracking-tight">What the ID does, and what it does not</h2>
        <ul className="grid gap-3 text-[14px] leading-relaxed text-ink-soft sm:grid-cols-2">
          <li className="rounded-card border border-line bg-cream-2 p-4">
            <span className="font-semibold text-ink">Used on your next launches.</span> Pass the agent id when you launch on the same chain,
            in Studio or through MCP. The factory checks that your wallet owns the agent, then records it in the token for good.
          </li>
          <li className="rounded-card border border-line bg-cream-2 p-4">
            <span className="font-semibold text-ink">One ID per chain.</span> The Identity Registry has the same address on all five chains
            but separate records, so the same agent gets a different id on each chain.
          </li>
          <li className="rounded-card border border-line bg-cream-2 p-4">
            <span className="font-semibold text-ink">Not for markets that are already live.</span> A token records its agent at launch and
            that binding cannot be changed later, so an existing token cannot take a new ID.
          </li>
          <li className="rounded-card border border-line bg-cream-2 p-4">
            <span className="font-semibold text-ink">You own it.</span> The ID is an NFT in your wallet. The name, description and image are in
            its registration file on IPFS; whoever holds the NFT can update that file, while the binding inside a token stays fixed.
          </li>
        </ul>
      </section>
    </div>
  );
}
