import type { Metadata } from "next";
import { COMPUTE_STAKES } from "@/config/agent-compute";
import { entryFromSource, sourceView } from "@/lib/agent-compute-catalog";
import { poolConfigured } from "@/lib/agent-compute-pool";
import ComputeHero from "@/components/agent-compute/ComputeHero";
import AgentComputeApp from "@/components/agent-compute/AgentComputeApp";
import { ComputeAllowances, ComputeGuide, ComputeLimits, ComputeSteps } from "@/components/agent-compute/ComputeSections";

/**
 * `/agent-compute`.
 *
 * Disusun ulang 7 Okt untuk 1.000–10.000 pasar (owner: "arsitektur kalau sudah 1000, 10.000 agen agar
 * halaman rapih", lalu "kerjakan yang terbaik"). Urutannya mengikuti pertanyaan pengunjung:
 * apa ini (hero), bagaimana caranya (tiga langkah), apa yang sudah saya punya (Your compute), token
 * mana yang bisa saya stake (kartu bertingkat + direktori berhalaman), lalu cara memanggilnya, berapa
 * jatahnya, dan batasnya. Yang tumbuh bersama jumlah pasar hanya isi direktori, dan direktori itu
 * dipotong di server.
 *
 * `force-dynamic` karena alamat kontrak stake datang dari env saat jalan; di-prerender, halaman ini
 * akan menyimpan keadaan "belum ter-deploy" ke dalam HTML dan tetap menampilkannya setelah
 * kontraknya benar-benar hidup. Empat kartu bertingkat dikirim dari sini (bukan diimpor di klien)
 * dengan alasan yang sama.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent Compute — ADEXTO",
  description:
    "Stake $ADEXTO, $SAI or any ADEXTO market and get your own API key for DeepSeek-V4-Flash on 0G Compute. OpenAI-compatible, metered in tokens, and you can unstake at any time.",
};

export default function AgentComputePage() {
  const tiered = COMPUTE_STAKES.map((s) => sourceView(entryFromSource(s)));
  return (
    <div className="pb-16">
      <ComputeHero />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ComputeSteps />
        <AgentComputeApp tiered={tiered} configured={poolConfigured()} />
        <ComputeGuide />
        <ComputeAllowances />
        <ComputeLimits />
      </div>
    </div>
  );
}
