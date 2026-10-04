"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Clock, ExternalLink, Info, Share2, ShieldCheck, XCircle } from "lucide-react";
import type { LaunchProofCheck, LaunchProofResult } from "@/lib/launch-proof";
import { CLEAN_LAUNCH_ANCHOR, launchProofUrlFor, proofComposeLinks, proofPostText } from "@/lib/launch-kit";
import { explorerTxUrl } from "@/lib/chains";

/**
 * Panel "Clean launch" di halaman token: setiap pemeriksaan dari `src/lib/launch-proof.ts`, apa
 * adanya, termasuk yang tidak lolos. Tidak ada angka yang dihitung di sini; panel hanya
 * menampilkan jawaban `/api/launch-proof`.
 *
 * Tertutup bawaannya; kepalanya tetap menyebut hasilnya ("All checks pass"). `?proof=1` di URL (tautan
 * yang dibagikan dari tombol "Share proof") membukanya dan menggulir ke sini.
 */
export default function CleanLaunchPanel({
  chainId,
  chainName,
  token,
  slug,
  symbol,
  collapsible = true,
}: {
  chainId: number;
  chainName: string;
  token: string;
  slug: string;
  symbol: string;
  /** False di dalam tab terminal: isinya langsung terbuka. */
  collapsible?: boolean;
}) {
  const [proof, setProof] = useState<LaunchProofResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState(process.env.NEXT_PUBLIC_APP_URL || "");
  const ref = useRef<HTMLDivElement>(null);
  const [openState, setOpen] = useState(false);
  const open = !collapsible || openState;

  useEffect(() => {
    if (!origin) setOrigin(window.location.origin);
  }, [origin]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const res = await fetch(`/api/launch-proof?chainId=${chainId}&token=${token}`);
        const body = await res.json();
        if (stop) return;
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setProof(body as LaunchProofResult);
        setError(null);
        // Selama jendela launch masih berjalan, satu baris belum final: baca lagi sebentar lagi.
        if (body?.supported && !body.final) timer = setTimeout(load, 20_000);
      } catch (e: any) {
        if (stop) return;
        setError(String(e?.message ?? e));
        timer = setTimeout(load, 30_000);
      }
    };
    load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [chainId, token]);

  useEffect(() => {
    if (!proof) return;
    if (new URLSearchParams(window.location.search).get("proof") === "1") {
      setOpen(true);
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [proof]);

  const shell = "glass-panel rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-panel)] scroll-mt-24";

  if (!proof) {
    return (
      <div ref={ref} id={CLEAN_LAUNCH_ANCHOR} className={shell} data-testid="clean-launch-panel">
        <Header />
        <p className="mt-2 text-[12px]/snug text-ink-faint">{error ? `Could not read the launch from chain yet (${error}).` : "Reading the launch from chain…"}</p>
      </div>
    );
  }

  if (!proof.supported) {
    return (
      <div ref={ref} id={CLEAN_LAUNCH_ANCHOR} className={shell} data-testid="clean-launch-panel">
        <Header />
        <p className="mt-2 text-[12px]/snug leading-relaxed text-ink-soft">No clean-launch proof for this market. {proof.reason}</p>
      </div>
    );
  }

  const proofUrl = launchProofUrlFor(origin || "https://adexto.xyz", slug, chainId);
  const share = proofComposeLinks(proofPostText(proof, symbol, chainName), proofUrl);

  return (
    <div ref={ref} id={CLEAN_LAUNCH_ANCHOR} className={shell} data-testid="clean-launch-panel">
      <button
        type="button"
        onClick={() => collapsible && setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="clean-launch-body"
        disabled={!collapsible}
        className="block w-full text-left"
      >
        <Header clean={proof.clean} final={proof.final} generation={proof.generation} open={collapsible ? open : undefined} />
      </button>
      <div id="clean-launch-body" hidden={!open}>
      <ul className="mt-3 space-y-2.5">
        {proof.checks.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </ul>
      {/* Di bawah lg tiap tautan setinggi 36 px (dulu 18 px dan rapat: ERROR tap<24); jaraknya diambil
          dari gap, jadi tinggi kakinya hampir sama. Desktop tetap seperti dulu. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 border-t border-line pt-1.5 text-[12px] lg:mt-3 lg:gap-x-4 lg:gap-y-2 lg:pt-3">
        <a
          href={explorerTxUrl(chainId, proof.launch.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[36px] items-center gap-1 font-semibold text-accent hover:underline lg:min-h-0"
        >
          Launch transaction <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
        <a
          href={share.xUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[36px] items-center gap-1 font-semibold text-accent hover:underline lg:min-h-0"
          data-testid="clean-launch-share-x"
        >
          <Share2 className="h-3 w-3" aria-hidden /> Share proof on X
        </a>
        <a
          href={`/api/launch-proof?chainId=${chainId}&token=${proof.token}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[36px] items-center font-semibold text-ink-soft hover:text-accent hover:underline lg:min-h-0"
        >
          Raw JSON
        </a>
      </div>
      </div>
    </div>
  );
}

function Header({ clean, final, generation, open }: { clean?: boolean; final?: boolean; generation?: string; open?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${open === false ? "" : "border-b border-line pb-2"}`}>
      <span className="flex items-center gap-2 text-[13px]/snug font-semibold text-ink">
        <ShieldCheck className="h-4 w-4 text-accent" aria-hidden /> Clean launch
      </span>
      <span className="flex items-center gap-1.5">
        {generation && <span className="text-[12px] text-ink-faint">contracts {generation}</span>}
        {clean !== undefined && (
          <span
            className={`rounded-md border px-2 py-0.5 text-[12px] font-semibold ${
              clean ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn"
            }`}
          >
            {clean ? (final ? "All checks pass" : "Passing so far") : "See details"}
          </span>
        )}
        {open !== undefined && (
          <ChevronDown className={`h-4 w-4 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        )}
      </span>
    </div>
  );
}

function CheckRow({ check }: { check: LaunchProofCheck }) {
  const icon =
    check.ok === true ? (
      <CheckCircle2 className="h-4 w-4 text-ok" aria-label="passes" />
    ) : check.ok === null ? (
      <Clock className="h-4 w-4 text-ink-faint" aria-label="pending" />
    ) : check.informational ? (
      <Info className="h-4 w-4 text-warn" aria-label="disclosed" />
    ) : (
      <XCircle className="h-4 w-4 text-danger" aria-label="fails" />
    );
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12px]/snug font-semibold text-ink">{check.label}</span>
        <span className="block text-[12px] leading-relaxed text-ink-faint">{check.detail}</span>
      </span>
    </li>
  );
}
