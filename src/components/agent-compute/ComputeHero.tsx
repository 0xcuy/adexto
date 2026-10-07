/**
 * Hero `/agent-compute` (7 Okt, permintaan owner: "ganti gambar robot dengan maskot, warna ungu
 * diselaraskan dengan tema, standar perusahaan tier 1").
 *
 * - Maskot RESMI (`public/mascot/threequarter.webp`, dipotong dari lembar karakter), bukan gambar
 *   robot buatan model: versi model selalu melenceng dari karakter aslinya. Pose `threequarter`
 *   dipilih karena berkasnya yang terbesar setelah `front`, dan `front` sudah menjadi wajah landing.
 * - Warna dari token tema (`bg-cream`, `text-ink*`, `border-line`), sama seperti landing dan docs.
 *   Gradien ungu `#2e0f63 → #7c3aed` dan bayangan ungu lama dihapus; ungu tinggal di tombol utama,
 *   satu kata judul, dan cahaya halus di belakang maskot. Tema terang ikut tanpa kode tambahan.
 * - Yang ditampilkan di samping maskot adalah PRODUKNYA: endpoint dan model yang bisa disalin,
 *   bukan ilustrasi. Pengunjung yang hanya membaca hero tahu persis apa yang ia dapat.
 *
 * Server component. Bagian yang hidup (ping, tombol Copy) adalah pulau klien kecil di dalamnya.
 */
import Link from "next/link";
import { ArrowDown, ArrowRight, Check } from "lucide-react";
import Mascot from "@/components/Mascot";
import CopyField from "@/components/ui/CopyField";
import {
  AGENT_COMPUTE_ENDPOINT,
  AGENT_COMPUTE_MODEL,
  AGENT_COMPUTE_MODEL_FACTS,
  AGENT_COMPUTE_MODEL_LABEL,
} from "@/config/agent-compute";
import PingBadge from "@/components/agent-compute/PingBadge";

const fmt = (n: number) => n.toLocaleString("en-US");

const PROOF = ["One key per token, bound to your address", "No lock: unstake any time", "Usage counted in input + output tokens"];

function EndpointCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-panel)] ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Your endpoint</p>
        <PingBadge />
      </div>
      <div className="mt-3 space-y-2.5">
        <CopyField value={AGENT_COMPUTE_ENDPOINT} label="Base URL" />
        <CopyField value={AGENT_COMPUTE_MODEL} label="Model" />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
        {AGENT_COMPUTE_MODEL_LABEL} · OpenAI-compatible · {fmt(AGENT_COMPUTE_MODEL_FACTS.contextLength)}-token context ·{" "}
        {AGENT_COMPUTE_MODEL_FACTS.teeType}, as reported by the 0G router
      </p>
    </div>
  );
}

export default function ComputeHero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-line">
      <div className="relative mx-auto grid max-w-7xl items-center gap-8 px-4 pb-10 pt-8 sm:px-6 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:gap-10 lg:px-8 lg:pb-14 lg:pt-14">
        {/* `sm:pr-36`: di tablet maskot pojok kanan atas setinggi 168 px; ruang itu dipesan supaya
            paragraf di bawah judul tidak lewat di belakangnya. */}
        <div className="relative min-w-0 sm:pr-36 lg:pr-0">
          {/* Ponsel dan tablet: maskot kecil di pojok kanan atas teks. Mulai lg ia pindah ke kolom kanan. */}
          <div aria-hidden="true" className="pointer-events-none absolute -right-2 -top-2 lg:hidden">
            <span className="absolute inset-[-24px] rounded-full bg-[radial-gradient(circle,rgb(var(--accent-fill-rgb)/0.30)_0%,transparent_68%)]" />
            <Mascot pose="threequarter" priority className="relative h-[132px] w-auto drop-shadow-[0_16px_24px_rgba(0,0,0,0.45)] sm:h-[168px]" />
          </div>

          <p className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            Agent Compute <span aria-hidden="true">·</span> Beta
          </p>
          <h1 className="mt-4 max-w-[13ch] font-display text-[34px] font-semibold leading-[1.04] tracking-tight text-ink sm:max-w-none sm:text-[52px]">
            Turn your <span className="text-accent">stake</span>
            <br className="hidden sm:block" /> into agent compute.
          </h1>
          <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-ink-soft sm:text-[17px]">
            Stake a token you hold and get your own API key for {AGENT_COMPUTE_MODEL_LABEL} on 0G Compute. The
            endpoint is OpenAI-compatible, so any OpenAI client can call it, and you can unstake at any time.
          </p>
          {/* Ponsel: padding 12 px dan ikon hilang di bawah 360 px, supaya "Choose a token" tetap satu
              baris di kolom 142 px (audit-layout 7 Okt: labelwrap di 360 px). */}
          <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <a
              href="#choose"
              className="btn-glow inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-accent px-3 text-[14px] font-semibold text-white transition-colors hover:bg-accent-strong sm:px-5"
            >
              Choose a token <ArrowDown className="h-4 w-4 max-[359px]:hidden" aria-hidden="true" />
            </a>
            <Link
              href="/docs/compute"
              className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-line-strong bg-surface px-3 text-[14px] font-semibold text-ink transition-colors hover:border-accent/40 sm:px-5"
            >
              Read the guide <ArrowRight className="h-4 w-4 max-[359px]:hidden" aria-hidden="true" />
            </Link>
          </div>
          <ul className="mt-6 grid gap-2 text-[13px] text-ink-soft sm:flex sm:flex-wrap sm:gap-x-5">
            {PROOF.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <Check className="h-[14px] w-[14px] shrink-0 text-accent" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
          <EndpointCard className="mt-6 lg:hidden" />
        </div>

        {/* Desktop: maskot besar dengan kartu endpoint di depannya. */}
        {/* Desktop: maskot besar dengan kartu endpoint di depannya. Kartu 356 px supaya URL endpoint
            tampil utuh (330 px memotongnya jadi "https://compute.adexto.xy…"), dan maskot beserta
            cahayanya digeser 28 px ke kanan supaya tumpang-tindihnya tetap sama dan logo dadanya terlihat. */}
        <div className="relative hidden h-[420px] lg:block">
          <span
            aria-hidden="true"
            className="absolute right-[-28px] top-1 h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgb(var(--accent-fill-rgb)/0.28)_0%,rgb(var(--accent-fill-rgb)/0.08)_46%,transparent_70%)]"
          />
          <span aria-hidden="true" className="absolute right-[-10px] top-5 h-[360px] w-[360px] rounded-full border border-accent/15" />
          <div aria-hidden="true" className="absolute right-[14px] top-3">
            <Mascot pose="threequarter" priority className="h-[384px] w-auto drop-shadow-[0_24px_40px_rgba(0,0,0,0.5)]" />
          </div>
          <EndpointCard className="absolute bottom-0 left-0 w-[356px]" />
        </div>
      </div>
    </section>
  );
}
