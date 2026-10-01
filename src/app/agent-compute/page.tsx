import type { Metadata } from "next";
import AgentComputePanel from "@/components/AgentComputePanel";

/**
 * `/agent-compute`.
 *
 * `force-dynamic` karena panelnya membaca chain per dompet dan alamat kontrak stake datang dari env
 * saat jalan. Di-prerender, halaman ini akan menyimpan keadaan "belum ter-deploy" ke dalam HTML dan
 * tetap menampilkannya setelah kontraknya benar-benar hidup.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent Compute — ADEXTO",
  description:
    "Stake $ADEXTO on 0G, or $SAI on Arbitrum One or Robinhood Chain, and get an API key per token with a compute allowance on 0G Compute.",
};

export default function AgentComputePage() {
  return <AgentComputePanel />;
}
