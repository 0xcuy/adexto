"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Link2, Loader2, UserRound } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { personalSign } from "@/lib/personal-sign";
import { handleRegistrationMessage, normalizeRefCode } from "@/lib/referral-tag";
import { explorerTxUrl } from "@/lib/chains";
import { formatUsd } from "@/lib/pricing";
import { REFERRAL_TERMS } from "@/config/growth-programs";

interface Week {
  week: string;
  trades: number;
  wallets: number;
  volumeUsd: number;
  protocolFeeUsd: number;
  rewardUsd?: number;
  meetsMinimum?: boolean;
}
interface Stats {
  program: { referrers: number; wallets: number; trades: number; volumeUsd: number };
  termsConfirmed: boolean;
  address?: string;
  handles?: string[];
  weeks?: Week[];
  totals?: { trades: number; wallets: number; volumeUsd: number; protocolFeeUsd: number };
  recent?: Array<{ chainId: number; txHash: string; time: number; symbol: string; isBuy: boolean; wallet: string; volumeUsd: number; source: string }>;
}

const usd = (v: number) => (v === 0 ? "$0" : formatUsd(v));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function RewardsClient() {
  const { address, isConnected, connectWallet } = useWallet();
  const [stats, setStats] = useState<Stats | null>(null);
  const [origin, setOrigin] = useState(process.env.NEXT_PUBLIC_APP_URL || "");
  const [handleInput, setHandleInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!origin) setOrigin(window.location.origin);
  }, [origin]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/referral/stats${address ? `?address=${address}` : ""}`, { cache: "no-store" });
    if (res.ok) setStats(await res.json());
  }, [address]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const code = stats?.handles?.[0] ?? address?.toLowerCase() ?? null;
  const link = code ? `${origin || "https://adexto.xyz"}/?ref=${code}` : null;

  const register = async () => {
    if (!address) return;
    const handle = normalizeRefCode(handleInput);
    if (!handle || handle.startsWith("0x")) {
      setLine({ text: "Use 3 to 20 characters: a-z, 0-9 and underscore.", tone: "err" });
      return;
    }
    setBusy(true);
    setLine(null);
    try {
      const issuedAt = Date.now();
      const signature = await personalSign(handleRegistrationMessage({ handle, address, issuedAt }), address);
      const res = await fetch("/api/referral/handle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, address, issuedAt, signature }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setLine({ text: `Your link now uses “${body.handle}”.`, tone: "ok" });
      setHandleInput("");
      await load();
    } catch (e: any) {
      setLine({ text: String(e?.shortMessage ?? e?.message ?? e), tone: "err" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-7">
        <section className="glass-panel space-y-3 rounded-card border border-line bg-surface p-5 shadow-[var(--shadow-panel)]">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Link2 className="h-4 w-4 text-accent" aria-hidden /> Your referral link
          </h2>
          {!isConnected || !address ? (
            <div className="space-y-2">
              <p className="text-xs text-ink-soft">Connect the wallet that should receive referral credit. Your address is your code; a handle is optional.</p>
              <button
                type="button"
                onClick={() => connectWallet().catch(() => {})}
                className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-strong"
              >
                Connect wallet
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <code className="flex-1 truncate rounded-xl border border-line bg-cream-2 px-3 py-2 text-[12px] text-accent" data-testid="referral-link">
                  {link}
                </code>
                <button
                  type="button"
                  onClick={async () => {
                    if (!link) return;
                    try {
                      await navigator.clipboard.writeText(link);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    } catch {}
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-strong"
                >
                  {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-faint">
                Add <code className="text-accent">?ref={code}</code> to any ADEXTO link, a market page included. Someone who opens it and then
                trades from this site carries your address in the transaction itself, so the credit cannot be claimed by anyone else.
              </p>
              <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-end">
                <label className="flex-1 text-[11px] text-ink-soft">
                  <span className="mb-1 flex items-center gap-1 font-semibold text-ink">
                    <UserRound className="h-3.5 w-3.5" aria-hidden /> Handle {stats?.handles?.[0] ? `(now “${stats.handles[0]}”)` : "(optional)"}
                  </span>
                  <input
                    value={handleInput}
                    onChange={(e) => setHandleInput(e.target.value)}
                    placeholder="your_handle"
                    maxLength={20}
                    className="w-full rounded-xl border border-line bg-cream-2 px-3 py-2 text-xs text-ink focus:border-accent/40 focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !handleInput.trim()}
                  onClick={register}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink hover:border-accent/40 disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Sign to claim handle
                </button>
              </div>
              {line && <p className={`text-[11px] ${line.tone === "ok" ? "text-ok" : "text-danger"}`}>{line.text}</p>}
            </>
          )}
        </section>

        {isConnected && address && stats?.totals && (
          <section className="glass-panel overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-panel)]">
            <h2 className="border-b border-line px-5 py-3 text-sm font-semibold text-ink">What you referred</h2>
            <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
              {[
                ["Trades", String(stats.totals.trades)],
                ["Wallets", String(stats.totals.wallets)],
                ["Volume", usd(stats.totals.volumeUsd)],
                ["Protocol fee", usd(stats.totals.protocolFeeUsd)],
              ].map(([k, v]) => (
                <div key={k} className="bg-surface px-4 py-3">
                  <span className="block text-[10px] uppercase tracking-[0.08em] text-ink-faint">{k}</span>
                  <span className="mt-0.5 block font-display text-[17px] text-ink" data-numeric>
                    {v}
                  </span>
                </div>
              ))}
            </div>
            {stats.weeks && stats.weeks.length > 0 && (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                    <th className="px-4 py-2">Week (UTC)</th>
                    <th className="px-4 py-2 text-right">Trades</th>
                    <th className="px-4 py-2 text-right">Wallets</th>
                    <th className="px-4 py-2 text-right">Volume</th>
                    <th className="px-4 py-2 text-right">Protocol fee</th>
                    {stats.termsConfirmed && <th className="px-4 py-2 text-right">Est. reward</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {stats.weeks.map((w) => (
                    <tr key={w.week}>
                      <td className="px-4 py-2 text-ink">{w.week}</td>
                      <td className="px-4 py-2 text-right" data-numeric>{w.trades}</td>
                      <td className="px-4 py-2 text-right" data-numeric>{w.wallets}</td>
                      <td className="px-4 py-2 text-right" data-numeric>{usd(w.volumeUsd)}</td>
                      <td className="px-4 py-2 text-right" data-numeric>{usd(w.protocolFeeUsd)}</td>
                      {stats.termsConfirmed && (
                        <td className="px-4 py-2 text-right" data-numeric>
                          {usd(w.rewardUsd ?? 0)}
                          {!w.meetsMinimum && <span className="ml-1 text-[10px] text-ink-faint">below minimum</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {stats.recent && stats.recent.length > 0 ? (
              <ul className="divide-y divide-line border-t border-line text-[11px]">
                {stats.recent.map((r) => (
                  <li key={`${r.chainId}-${r.txHash}`} className="flex items-center justify-between gap-2 px-4 py-2">
                    <span className="text-ink">
                      {r.isBuy ? "Buy" : "Sell"} ${r.symbol} by <span className="font-mono">{short(r.wallet)}</span>
                    </span>
                    <a href={explorerTxUrl(r.chainId, r.txHash)} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">
                      {usd(r.volumeUsd)} · tx
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-line px-4 py-3 text-xs text-ink-soft">No referred trade yet. Share your link to start.</p>
            )}
          </section>
        )}
      </div>

      <aside className="space-y-5 lg:col-span-5">
        <section className="glass-panel space-y-2 rounded-card border border-line bg-surface p-5 text-[12px] leading-relaxed text-ink-soft shadow-[var(--shadow-panel)]">
          <h2 className="text-sm font-semibold text-ink">How it works</h2>
          {REFERRAL_TERMS.confirmed ? (
            <p>
              You earn {REFERRAL_TERMS.sharePctOfProtocolFee}% of the 0.10% protocol fee on the volume you refer, counted weekly (Monday to
              Monday, UTC) and paid by the ADEXTO team for each week whose reward reaches ${REFERRAL_TERMS.minPayoutUsd}.
            </p>
          ) : (
            <p>
              Referred volume and the protocol fee it pays are recorded from today. The reward share and payout schedule are being finalised
              and will be published on this page before any payout.
            </p>
          )}
          <ul className="list-disc space-y-1 pl-4">
            <li>One level only: you are credited for the wallets you bring, not for the wallets they bring.</li>
            <li>You cannot refer yourself. A trade whose buyer, seller or recipient is your own address does not count.</li>
            <li>ADEXTO team wallets can neither refer nor be referred.</li>
            <li>Credit is in the transaction itself: the trade carries the referrer&apos;s address in its data, which the curve ignores.</li>
            <li>No token is promised, and referral totals are not points that can be transferred or traded.</li>
            <li>Payouts are reviewed by hand. Patterns that look like one person trading through many wallets to farm credit are excluded.</li>
          </ul>
        </section>
        {stats && (
          <section className="glass-panel rounded-card border border-line bg-surface p-5 text-[12px] text-ink-soft shadow-[var(--shadow-panel)]">
            <h2 className="mb-2 text-sm font-semibold text-ink">Program so far</h2>
            <p data-numeric>
              {stats.program.referrers} referrer{stats.program.referrers === 1 ? "" : "s"} · {stats.program.wallets} referred wallet
              {stats.program.wallets === 1 ? "" : "s"} · {stats.program.trades} trade{stats.program.trades === 1 ? "" : "s"} · {usd(stats.program.volumeUsd)} volume
            </p>
            <p className="mt-2">
              See which markets are moving on the{" "}
              <Link href="/leaderboard" className="font-semibold text-accent hover:underline">
                Leaderboard
              </Link>
              .
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}
