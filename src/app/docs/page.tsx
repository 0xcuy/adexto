import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import VerifiedDeploymentCard from "@/components/VerifiedDeploymentCard";
import Disclosure from "@/components/ui/Disclosure";
import DocsShell from "@/app/docs/DocsShell";
import { DocSection, SourceNote } from "@/app/docs/DocBlocks";
import { DOC_GROUPS, DOC_SUMMARIES } from "@/app/docs/docs-nav";
import { chainNameList } from "@/lib/chains";
import ComponentStatus, { ComputeAttestation } from "@/app/docs/TechnicalStatus";
import { docArt } from "@/app/docs/docs-art";

/**
 * Beranda docs (`/docs`, juga `docs.adexto.xyz`).
 *
 * Dibuat ulang 4 Okt atas permintaan owner, meniru docs comfy.fun: "What is ADEXTO" dalam kalimat pendek,
 * "Where to start", daftar panduan, lalu kontrak dan status di bagian akhir. Sebelumnya halaman ini dibuka
 * dengan sembilan kartu kecil lalu esai status komponen sepanjang beberapa layar.
 *
 * Yang DIJAGA dari versi lama:
 *   - `<VerifiedDeploymentCard />` tetap dirender DI BERKAS INI (`audit_consistency.mjs` memeriksa bahwa
 *     registry kontrak hidup di halaman permanen, dan `/explorer` menunjuk ke sini untuk daftar kontrak).
 *   - Tabel attestation router 0G (`ComputeAttestation`) tetap terbuka: pil "0G TeeML · TDX reported" di
 *     footer menaut ke halaman ini.
 *   - Status komponen demi komponen (`ComponentStatus`) dipindah utuh ke `TechnicalStatus.tsx` dan
 *     dirender di sini dalam satu lipatan.
 * Semua teks publik English; klaim mengikuti UI-POLISH §2.4 (launch, stake dan claim mengembalikan
 * transaksi tanpa tanda tangan; `pay_and_buy` memakai kunci operator).
 */
export const metadata: Metadata = {
  title: "Docs — ADEXTO",
  description:
    "What ADEXTO is, how a launch, a trade and the fees work, and how an agent uses it over MCP and x402. Short guides, with the contract addresses and status at the end.",
};

const TOC = [
  { id: "where-to-start", label: "Where to start" },
  { id: "guides", label: "All guides" },
  { id: "contracts", label: "Contracts and status" },
];

function Lead({ word, children }: { word: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-[16px] leading-[1.7] text-ink-soft">
      <span aria-hidden="true" className="mt-[0.72em] h-[5px] w-[5px] shrink-0 rounded-full bg-accent" />
      <span>
        <strong className="font-semibold text-ink">{word}</strong> {children}
      </span>
    </li>
  );
}

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="font-medium text-accent underline decoration-accent/30 underline-offset-[3px] hover:decoration-accent">
    {children}
  </Link>
);

export default function DocsHome() {
  return (
    <DocsShell
      current="/docs"
      title="What is ADEXTO"
      kicker="Docs"
      art={docArt("home")}
      toc={TOC}
      intro={
        <p>
          ADEXTO is a place to launch a token and trade it on a bonding curve, on {chainNameList()}.
        </p>
      }
    >
      <ul className="space-y-3">
        <Lead word="Launch">
          a market in one transaction. You pay gas only: there is no liquidity deposit, and the whole supply goes into
          the curve.
        </Lead>
        <Lead word="Trade">
          any market on its own page. Every market trades against its own curve, and each chain is a separate market.
        </Lead>
        <Lead word="Earn">
          as the creator. You hold no allocation; on the standard fee preset you are paid 0.70% of every trade instead.
        </Lead>
        <Lead word="Build">
          with an agent. Bind a token to an ERC-8004 agent at launch, and let the agent launch, stake and claim over
          MCP: the server returns unsigned transactions and the agent signs them with its own key.
        </Lead>
      </ul>
      <div className="mt-6 rounded-panel border border-accent/25 bg-accent-soft p-4 text-[15px] leading-relaxed text-ink">
        Launches and trades are real transactions on mainnet. Check the network and the transaction in your wallet
        before you confirm.
      </div>

      <div className="mt-12">
        <DocSection id="where-to-start" heading="Where to start">
          <ul className="mt-4 space-y-3">
            <Lead word="New here?">
              Start with the <A href="/docs/quickstart">Quickstart</A>, and keep the <A href="/docs/glossary">Glossary</A>{" "}
              open for the words you do not know.
            </Lead>
            <Lead word="Launching a token?">
              Read <A href="/docs/launch">Launch a market</A> and <A href="/docs/studio-guide">Studio, step by step</A>, then
              what a trade costs in <A href="/docs/fees">Fees</A>.
            </Lead>
            <Lead word="Want to trade?">
              Read <A href="/docs/trading">Trading</A> and <A href="/docs/market-page">The market page</A>, then open the{" "}
              <A href="/explorer">markets</A>.
            </Lead>
            <Lead word="Building an agent?">
              Point it at the <A href="/docs/mcp">MCP server</A> or <A href="/docs/a2a">A2A</A>, launch with{" "}
              <A href="/docs/agent-launch">Launch from an agent</A>, or pay from another chain with <A href="/docs/x402">x402</A>.
            </Lead>
            <Lead word="Checking before you trust anything?">
              Read <A href="/docs/security">Security</A>, <A href="/docs/check-a-market">Check a market</A> and{" "}
              <A href="/docs/risks">Risks</A>, then the <A href="/docs#contracts">contract addresses</A> below.
            </Lead>
            <Lead word="Something went wrong?">
              See <A href="/docs/troubleshooting">Troubleshooting</A> and the <A href="/docs/faq">FAQ</A>.
            </Lead>
          </ul>
        </DocSection>
      </div>

      <div className="mt-12">
        <DocSection id="guides" heading="All guides">
          <div className="mt-5 space-y-8">
            {/* Semua grup, termasuk Start: halaman ini sendiri (slug null) tersaring di bawah, jadi Start
                tinggal Quickstart dan Glossary. */}
            {DOC_GROUPS.map((g) => {
              const pages = g.items.filter((i) => i.slug);
              if (!pages.length) return null;
              return (
                <div key={g.label}>
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{g.label}</p>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {pages.map((p) => (
                      <li key={p.href}>
                        <Link
                          href={p.href}
                          className="group flex h-full flex-col rounded-panel border border-line bg-surface p-4 transition-colors hover:border-accent/40 hover:bg-cream-2"
                        >
                          <span className="flex items-center gap-1.5 text-[15px] font-semibold text-ink group-hover:text-accent">
                            {p.label}
                            <ArrowRight className="h-[14px] w-[14px] text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                          </span>
                          <span className="mt-1 text-[14px] leading-snug text-ink-soft">{DOC_SUMMARIES[p.slug as string]?.[0]}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </DocSection>
      </div>

      <div className="mt-12">
        <DocSection id="contracts" heading="Contracts and status">
          <p className="mt-4 text-[16px] leading-[1.75] text-ink-soft">
            Every contract address the app uses, the attestation the 0G compute router reports for the models an agent
            can call, and the status of each component, for anyone who wants to check before trusting the docs above.
          </p>
          <VerifiedDeploymentCard />
          <ComputeAttestation />
          <Disclosure id="status" className="mt-8" summary="Component status, in detail" hint="long read">
            <ComponentStatus />
          </Disclosure>
        </DocSection>
      </div>
      <SourceNote />
    </DocsShell>
  );
}
