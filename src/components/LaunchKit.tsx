"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, Clock, Copy, Download, Info, Layers, Radar, Send, ShieldCheck, XCircle } from "lucide-react";
import LaunchAnnouncement from "@/components/LaunchAnnouncement";
import type { LaunchProofResult } from "@/lib/launch-proof";
import {
  STAKE_ANCHOR,
  launchProofUrlFor,
  proofComposeLinks,
  proofPostText,
  telegramAlertLink,
  type ListingStatus,
} from "@/lib/launch-kit";
import { marketUrlFor } from "@/lib/launch-announcement";
import { hubRefuses, stakeHubFor } from "@/config/stake-hubs";
import { SHARE_CARD_VERSION } from "@/lib/share-card-format";

/**
 * Launch kit di layar sukses Studio, satu per chain yang berhasil.
 *
 * Isinya: kartu bagikan, draf pengumuman (komponen yang sudah ada), bukti launch bersih beserta
 * composer post X yang menautkannya, bot alert Telegram (hanya bila `/api/telegram/info` menyebut botnya), status
 * listing agregator, dan catatan stake hub. Semua angka datang dari rute yang juga dipakai halaman
 * token; kit ini tidak menghitung apa pun sendiri.
 *
 * Tautan referral menyusul bersama program referral (P2.5): sebelum itu tidak ada kode untuk ditautkan.
 */
export default function LaunchKit({
  name,
  symbol,
  chainName,
  chainId,
  tokenAddress,
}: {
  name: string;
  symbol: string;
  chainName: string;
  chainId: number;
  tokenAddress: string;
}) {
  const slug = symbol.toLowerCase();
  const [origin, setOrigin] = useState(process.env.NEXT_PUBLIC_APP_URL || "");
  useEffect(() => {
    if (!origin) setOrigin(window.location.origin);
  }, [origin]);
  const base = origin || "https://adexto.xyz";
  const marketPath = `/token/${encodeURIComponent(slug)}?chain=${chainId}`;
  const cardUrl = `/api/share-card/${encodeURIComponent(slug)}?chain=${chainId}&v=${SHARE_CARD_VERSION}`;
  // Username bot dari server (`/api/telegram/info`); tanpa bot, tombolnya tidak dirender.
  const [botName, setBotName] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/telegram/info")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setBotName(typeof b?.username === "string" ? b.username : null))
      .catch(() => setBotName(null));
  }, []);
  const telegram = telegramAlertLink(botName, chainId, tokenAddress);
  const hub = stakeHubFor(chainId);
  const stakeable = Boolean(hub) && !hubRefuses(chainId, tokenAddress);

  return (
    <section
      className="space-y-3 rounded-2xl border border-line bg-cream-2 p-3 font-sans"
      aria-label={`Launch kit for $${symbol} on ${chainName}`}
      data-testid="launch-kit"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-ink">
          Launch kit · ${symbol} on {chainName}
        </span>
        <a href={marketUrlFor(base, slug, chainId)} className="text-[11px] font-semibold text-accent hover:underline">
          Market page →
        </a>
      </div>

      {/* Kartu bagikan: gambar yang sama dengan pratinjau tautan pasar. */}
      <div className="space-y-1.5">
        <a href={cardUrl} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element -- gambar dinamis dari rute API, tidak lewat optimizer */}
          <img src={cardUrl} alt={`Share card for $${symbol} on ${chainName}`} width={1200} height={630} className="h-auto w-full" loading="lazy" />
        </a>
        <a
          href={cardUrl}
          download={`${slug}-${chainId}-card.png`}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
        >
          <Download className="h-3 w-3" aria-hidden /> Download the share card
        </a>
      </div>

      <LaunchAnnouncement name={name} symbol={symbol} chainName={chainName} chainId={chainId} tokenAddress={tokenAddress} />

      <ProofBlock chainId={chainId} chainName={chainName} token={tokenAddress} slug={slug} symbol={symbol} origin={base} />

      <ul className="space-y-2 text-[12px] leading-relaxed text-ink-soft">
        {telegram && (
          <li className="flex gap-2">
            <Send className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
            <span>
              <a href={telegram} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">
                Add the alert bot to your Telegram group
              </a>{" "}
              to post every buy of ${symbol} there.
            </span>
          </li>
        )}
        {stakeable && (
          <li className="flex gap-2">
            <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
            <span>
              ${symbol} can be staked right away in the {chainName} stake hub, with nothing to deploy.{" "}
              <Link href={`${marketPath}#${STAKE_ANCHOR}`} className="font-semibold text-accent hover:underline">
                Stake panel →
              </Link>
            </span>
          </li>
        )}
        <ListingRows chainId={chainId} token={tokenAddress} chainName={chainName} />
      </ul>
    </section>
  );
}

function ProofBlock({
  chainId,
  chainName,
  token,
  slug,
  symbol,
  origin,
}: {
  chainId: number;
  chainName: string;
  token: string;
  slug: string;
  symbol: string;
  origin: string;
}) {
  const [proof, setProof] = useState<LaunchProofResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const res = await fetch(`/api/launch-proof?chainId=${chainId}&token=${token}`);
        const body = await res.json();
        if (stop) return;
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setProof(body);
        setError(null);
        // Jendela launch baru saja dibuka: satu baris baru final sesudah ia lewat.
        if (body?.supported && !body.final) timer = setTimeout(load, 20_000);
      } catch (e: any) {
        if (stop) return;
        setError(String(e?.message ?? e));
        timer = setTimeout(load, 15_000);
      }
    };
    load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [chainId, token]);

  const proofUrl = launchProofUrlFor(origin, slug, chainId);
  const draft = useMemo(() => (proof?.supported ? proofPostText(proof, symbol, chainName) : ""), [proof, symbol, chainName]);
  const [body, setBody] = useState("");
  useEffect(() => setBody(draft), [draft]);
  const [copied, setCopied] = useState(false);

  const btn = "inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors";

  return (
    <div className="space-y-2 rounded-2xl border border-ok/30 bg-ok/5 p-3" data-testid="launch-kit-proof">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-ink">
          <ShieldCheck className="h-3.5 w-3.5 text-ok" aria-hidden /> Clean-launch proof
        </span>
        <span className="text-[10px] text-ink-faint">read from chain</span>
      </div>
      {!proof ? (
        <p className="text-[11px] text-ink-faint">{error ? `Could not read the launch yet (${error}). Retrying…` : "Reading the launch from chain…"}</p>
      ) : !proof.supported ? (
        <p className="text-[11px] text-ink-soft">No clean-launch proof for this market. {proof.reason}</p>
      ) : (
        <>
          <ul className="space-y-1">
            {proof.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-1.5 text-[11.5px] text-ink">
                <span className="mt-0.5 shrink-0">
                  {c.ok === true ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-ok" aria-label="passes" />
                  ) : c.ok === null ? (
                    <Clock className="h-3.5 w-3.5 text-ink-faint" aria-label="pending" />
                  ) : c.informational ? (
                    <Info className="h-3.5 w-3.5 text-warn" aria-label="disclosed" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-danger" aria-label="fails" />
                  )}
                </span>
                {c.label}
              </li>
            ))}
          </ul>
          <label className="sr-only" htmlFor={`proof-post-${chainId}`}>
            Proof post text
          </label>
          <textarea
            id={`proof-post-${chainId}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            className="w-full resize-y rounded-xl border border-line bg-surface p-2.5 text-[12px] leading-relaxed text-ink focus:border-accent/40 focus:outline-none"
            data-testid="proof-post-text"
          />
          <p className="truncate text-[10px] text-ink-faint">
            Link added at the end: <span className="font-mono text-accent">{proofUrl}</span>
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href={proofComposeLinks(body, proofUrl).xUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btn} border-line bg-surface text-ink hover:border-accent/40`}
              data-testid="proof-post-x"
            >
              Post the proof on X
            </a>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${body}\n${proofUrl}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  setCopied(false);
                }
              }}
              className={`${btn} border-ok/30 bg-ok text-white hover:bg-ok/90`}
            >
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? "Copied" : "Copy proof post"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ListingRows({ chainId, token, chainName }: { chainId: number; token: string; chainName: string }) {
  const [status, setStatus] = useState<ListingStatus | null>(null);
  useEffect(() => {
    let stop = false;
    fetch(`/api/listing-status?chainId=${chainId}&token=${token}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!stop && s) setStatus(s);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [chainId, token]);

  const text = (state: string) =>
    state === "listed"
      ? "listed"
      : state === "not-listed"
      ? "not listed yet"
      : state === "unsupported-chain"
      ? `does not support ${chainName}`
      : "could not check right now";

  return (
    <li className="flex gap-2">
      <Radar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
      <span>
        Aggregators:{" "}
        {!status
          ? "checking…"
          : status.aggregators.map((a, i) => (
              <span key={a.name}>
                {i > 0 ? " · " : ""}
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">
                    {a.name} {text(a.state)}
                  </a>
                ) : (
                  <>
                    {a.name} {text(a.state)}
                  </>
                )}
              </span>
            ))}
        {status && status.aggregators.some((a) => a.state === "not-listed") && (
          <span className="block text-[11px] text-ink-faint">A market appears there once the aggregator indexes ADEXTO curves on {chainName}.</span>
        )}
      </span>
    </li>
  );
}
