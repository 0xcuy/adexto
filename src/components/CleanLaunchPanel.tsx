"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, ExternalLink, Info, Share2, ShieldCheck, XCircle } from "lucide-react";
import type { LaunchProofCheck, LaunchProofResult } from "@/lib/launch-proof";
import { CLEAN_LAUNCH_ANCHOR, launchProofUrlFor, proofComposeLinks, proofPostText } from "@/lib/launch-kit";
import { explorerTxUrl } from "@/lib/chains";

/**
 * Panel "Clean launch" di halaman token: setiap pemeriksaan dari `src/lib/launch-proof.ts`, apa
 * adanya, termasuk yang tidak lolos. Tidak ada angka yang dihitung di sini; panel hanya
 * menampilkan jawaban `/api/launch-proof`.
 *
 * `?proof=1` di URL (tautan yang dibagikan dari tombol "Share proof") menggulir ke panel ini.
 */
export default function CleanLaunchPanel({
  chainId,
  chainName,
  token,
  slug,
  symbol,
}: {
  chainId: number;
  chainName: string;
  token: string;
  slug: string;
  symbol: string;
}) {
  const [proof, setProof] = useState<LaunchProofResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState(process.env.NEXT_PUBLIC_APP_URL || "");
  const ref = useRef<HTMLDivElement>(null);

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
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [proof]);

  const shell = "glass-panel rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-panel)] scroll-mt-24";

  if (!proof) {
    return (
      <div ref={ref} id={CLEAN_LAUNCH_ANCHOR} className={shell} data-testid="clean-launch-panel">
        <Header />
        <p className="mt-2 text-xs text-ink-faint">{error ? `Could not read the launch from chain yet (${error}).` : "Reading the launch from chain…"}</p>
      </div>
    );
  }

  if (!proof.supported) {
    return (
      <div ref={ref} id={CLEAN_LAUNCH_ANCHOR} className={shell} data-testid="clean-launch-panel">
        <Header />
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">No clean-launch proof for this market. {proof.reason}</p>
      </div>
    );
  }

  const proofUrl = launchProofUrlFor(origin || "https://adexto.xyz", slug, chainId);
  const share = proofComposeLinks(proofPostText(proof, symbol, chainName), proofUrl);

  return (
    <div ref={ref} id={CLEAN_LAUNCH_ANCHOR} className={shell} data-testid="clean-launch-panel">
      <Header clean={proof.clean} final={proof.final} generation={proof.generation} />
      <ul className="mt-3 space-y-2.5">
        {proof.checks.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-[11px]">
        <a
          href={explorerTxUrl(chainId, proof.launch.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
        >
          Launch transaction <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
        <a
          href={share.xUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
          data-testid="clean-launch-share-x"
        >
          <Share2 className="h-3 w-3" aria-hidden /> Share proof on X
        </a>
        <a
          href={`/api/launch-proof?chainId=${chainId}&token=${proof.token}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-ink-soft hover:text-accent hover:underline"
        >
          Raw JSON
        </a>
      </div>
    </div>
  );
}

function Header({ clean, final, generation }: { clean?: boolean; final?: boolean; generation?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
        <ShieldCheck className="h-4 w-4 text-accent" aria-hidden /> Clean launch
      </span>
      <span className="flex items-center gap-1.5">
        {generation && <span className="text-[10px] text-ink-faint">contracts {generation}</span>}
        {clean !== undefined && (
          <span
            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
              clean ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn"
            }`}
          >
            {clean ? (final ? "All checks pass" : "Passing so far") : "See details"}
          </span>
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
        <span className="block text-xs font-semibold text-ink">{check.label}</span>
        <span className="block text-[11px] leading-relaxed text-ink-faint">{check.detail}</span>
      </span>
    </li>
  );
}
