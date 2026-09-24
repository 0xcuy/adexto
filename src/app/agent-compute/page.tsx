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
    "Stake $ADEXTO to activate an autonomous agent and open its compute allowance on the 0G Compute Router.",
};

export default function AgentComputePage() {
  return <AgentComputePanel />;
}
