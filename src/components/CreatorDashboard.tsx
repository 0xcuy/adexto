"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Coins, RefreshCw, ExternalLink, Wallet, CheckCircle2, AlertTriangle, Info, Layers } from "lucide-react";
import { ethers } from "ethers";
import { useWallet } from "@/context/WalletContext";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { claimCreatorFees, claimCreatorFeesBatch, describeTxError } from "@/lib/dex";
import { explorerTxUrl, resolveChain } from "@/lib/chains";
import { formatSmallNumber } from "@/lib/pricing";
import type { CreatorEarnings, CreatorMarket } from "@/lib/creator-earnings";

/**
 * /creator: penghasilan creator lintas pasar dan chain, dengan klaim per pasar atau per chain.
 *
 * Semua angka datang dari `/api/creator/earnings`, yang membacanya dari kurva saat halaman
 * dibuka. Halaman ini tidak menghitung apa pun selain format tampilan. Teks yang dirender
 * WAJIB bahasa Inggris.
 */

type Loaded = CreatorEarnings & { success: true };

const STATUS_LABEL: Record<CreatorMarket["status"], { label: string; cls: string; title: string }> = {
  listed: { label: "listed", cls: "border-ok/30 bg-ok/10 text-ok", title: "Listed on this site" },
  live: { label: "live", cls: "border-ok/30 bg-ok/10 text-ok", title: "Live on chain" },
  superseded: {
    label: "superseded",
    cls: "border-line bg-cream-3 text-ink-soft",
    title: "Replaced by a relaunch. The curve still trades and still pays its creator.",
  },
  test: {
    label: "test",
    cls: "border-line bg-cream-3 text-ink-soft",
    title: "A test launch that is not listed. The curve still exists and can still be traded directly.",
  },
};

function fmtUsd(v: number | null): string {
  if (v === null) return "—";
  if (v === 0) return "$0";
  if (v >= 0.01) return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${formatSmallNumber(v)}`;
}

function fmtNative(v: number | null, symbol: string): string {
  if (v === null) return "—";
  return `${formatSmallNumber(v)} ${symbol}`;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function CreatorDashboard() {
  const { address, isConnected, isConnecting, connectWallet } = useWallet();
  /** Alamat dari `?address=` untuk melihat creator lain, hanya-baca. */
  const [override, setOverride] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string; href?: string } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("address");
    if (q && ethers.isAddress(q)) setOverride(ethers.getAddress(q));
  }, []);

  const target = override ?? address ?? null;
  const own = Boolean(address && target && address.toLowerCase() === target.toLowerCase());

  const load = useCallback(async (who: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/creator/earnings?address=${who}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `request failed (${res.status})`);
      setData(json as Loaded);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Could not read earnings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (target) load(target);
    else setData(null);
  }, [target, load]);

  const setUrlAddress = (who: string | null) => {
    try {
      const url = new URL(window.location.href);
      if (who) url.searchParams.set("address", who);
      else url.searchParams.delete("address");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    } catch {
      // URL tidak wajib ikut.
    }
  };

  const view = () => {
    const v = lookup.trim();
    if (!ethers.isAddress(v)) {
      setError("That is not a valid 0x address.");
      return;
    }
    const a = ethers.getAddress(v);
    setOverride(a);
    setUrlAddress(a);
    setLookup("");
  };

  const claimOne = async (m: CreatorMarket) => {
    const chain = resolveChain(m.chainId);
    if (!chain) return;
    setClaiming(m.key);
    setNotice(null);
    try {
      const { hash } = await claimCreatorFees({ ethereum: getActiveEip1193(), chain, curveAddress: m.curve });
      setNotice({ kind: "ok", text: `Claimed $${m.symbol} on ${m.chainName}.`, href: explorerTxUrl(chain, hash) });
      if (target) await load(target);
    } catch (e) {
      setNotice({ kind: "error", text: describeTxError(e) });
    } finally {
      setClaiming(null);
    }
  };

  const claimChain = async (chainId: number) => {
    const chain = resolveChain(chainId);
    if (!chain || !data) return;
    const curves = data.markets
      .filter((m) => m.chainId === chainId && m.owedWei && BigInt(m.owedWei) > 0n)
      .map((m) => m.curve);
    setClaiming(`chain:${chainId}`);
    setNotice(null);
    try {
      const { hash } = await claimCreatorFeesBatch({ ethereum: getActiveEip1193(), chain, curveAddresses: curves });
      setNotice({
        kind: "ok",
        text: `Claimed ${curves.length} markets on ${chain.name} in one transaction.`,
        href: explorerTxUrl(chain, hash),
      });
      if (target) await load(target);
    } catch (e) {
      setNotice({ kind: "error", text: describeTxError(e) });
    } finally {
      setClaiming(null);
    }
  };

  const listed = data?.markets.filter((m) => m.status === "listed").length ?? 0;
  const batchable = data?.chains.filter((c) => c.claimableMarkets >= 2 && c.multicall3) ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8" data-testid="creator-dashboard">
      <div className="mb-8 border-b-2 border-line pb-6">
        <div className="kicker mb-3">CREATOR</div>
        <h1 className="font-display text-3xl font-light tracking-tight text-ink sm:text-4xl">Creator earnings</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
          Every market pays its creator a share of each swap, on chain. This page reads what your markets have earned
          straight from each curve when it loads, across every chain, and lets you claim it.
        </p>
      </div>

      {/* Alamat yang ditampilkan */}
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs">
          {target ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-ink-soft">Showing</span>
              <span className="font-mono font-bold text-ink" data-testid="creator-address" title={target}>
                {short(target)}
              </span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                  own ? "border-ok/30 bg-ok/10 text-ok" : "border-line bg-cream-3 text-ink-soft"
                }`}
              >
                {own ? "your wallet" : "read-only"}
              </span>
              {override && address && !own && (
                <button
                  type="button"
                  onClick={() => {
                    setOverride(null);
                    setUrlAddress(null);
                  }}
                  className="font-semibold text-accent hover:underline"
                >
                  Back to my wallet
                </button>
              )}
            </span>
          ) : (
            <span className="text-ink-soft">Connect a wallet to see what your markets have earned.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isConnected && (
            <button
              type="button"
              onClick={() => connectWallet()}
              disabled={isConnecting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white hover:bg-accent-strong disabled:opacity-60"
            >
              <Wallet className="h-3.5 w-3.5" /> {isConnecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
          <label className="sr-only" htmlFor="creator-lookup">
            Look up another address
          </label>
          <input
            id="creator-lookup"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && view()}
            placeholder="0x… any creator address"
            className="w-44 rounded-lg border border-line bg-cream-2 px-2.5 py-1.5 font-mono text-[11px] text-ink focus:border-accent/40 focus:outline-none sm:w-56"
          />
          <button
            type="button"
            onClick={view}
            className="rounded-lg border border-line bg-cream-2 px-3 py-1.5 text-xs font-bold text-ink hover:border-accent/40"
          >
            View
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          className={`mb-4 flex items-start gap-2 rounded-xl border p-3 text-xs ${
            notice.kind === "ok" ? "border-ok/30 bg-ok/10 text-ok" : "border-danger/30 bg-danger/10 text-danger"
          }`}
          data-testid="creator-notice"
          data-kind={notice.kind}
        >
          {notice.kind === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>
            {notice.text}{" "}
            {notice.href && (
              <a href={notice.href} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                View transaction
              </a>
            )}
          </span>
        </div>
      )}

      {target && loading && !data && (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-xs text-ink-soft" data-testid="creator-loading">
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" /> Reading every curve this address created…
        </div>
      )}

      {data && (
        <div data-testid="creator-data" data-markets={data.markets.length}>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Earned, all time</div>
              <div className="mt-1 font-display text-2xl text-ink" data-testid="creator-lifetime-usd">
                {fmtUsd(data.totals.lifetimeUsd)}
              </div>
              <div className="mt-0.5 text-[10px] text-ink-faint">paid out plus claimable</div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Claimable now</div>
              <div className="mt-1 font-display text-2xl text-ink" data-testid="creator-owed-usd">
                {fmtUsd(data.totals.owedUsd)}
              </div>
              <div className="mt-0.5 text-[10px] text-ink-faint">
                {data.chains
                  .filter((c) => c.owed > 0)
                  .map((c) => `${formatSmallNumber(c.owed)} ${c.nativeSymbol} on ${c.chainName}`)
                  .join(" · ") || "nothing to claim"}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Markets</div>
              <div className="mt-1 font-display text-2xl text-ink" data-testid="creator-market-count">
                {data.totals.markets}
              </div>
              <div className="mt-0.5 text-[10px] text-ink-faint">
                {listed} listed{data.totals.markets - listed > 0 ? `, ${data.totals.markets - listed} superseded or test` : ""}
                {data.totals.unpriced > 0 ? ` · ${data.totals.unpriced} without a dollar price` : ""}
              </div>
            </div>
          </div>

          {own && batchable.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {batchable.map((c) => (
                <button
                  key={c.chainId}
                  type="button"
                  onClick={() => claimChain(c.chainId)}
                  disabled={claiming !== null}
                  data-testid={`claim-all-${c.chainId}`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-xs font-bold text-accent hover:border-accent/60 disabled:opacity-50"
                >
                  {claiming === `chain:${c.chainId}` ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                  Claim all on {c.chainName} · {c.claimableMarkets} markets · one transaction
                </button>
              ))}
            </div>
          )}

          {data.markets.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-ink-soft" data-testid="creator-empty">
              No curve on any chain names this address as its creator.{" "}
              <Link href="/studio?mode=express" className="font-semibold text-accent hover:underline">
                Launch a market
              </Link>{" "}
              and its fees start here.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 border-b border-line bg-cream-3/[0.04] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint md:grid">
                <span>Market</span>
                <span>Chain</span>
                <span>Contract</span>
                <span>Earned</span>
                <span>Claimable</span>
                <span className="w-16" />
              </div>
              <div className="divide-y divide-line/[0.08]">
                {data.markets.map((m) => {
                  const s = STATUS_LABEL[m.status];
                  const owedPositive = Boolean(m.owedWei && BigInt(m.owedWei) > 0n);
                  return (
                    <div
                      key={m.key}
                      className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-3 text-xs md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center"
                      data-testid="creator-row"
                      data-symbol={m.symbol}
                      data-chain={m.chainId}
                      data-curve={m.curve}
                      data-owed-wei={m.owedWei ?? ""}
                      data-paid-wei={m.paidWei ?? ""}
                    >
                      <div className="col-span-2 min-w-0 md:col-span-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {m.slug && m.status === "listed" ? (
                            <Link href={`/token/${m.slug}?chain=${m.chainId}`} className="font-bold text-ink hover:text-accent">
                              ${m.symbol}
                            </Link>
                          ) : (
                            <span className="font-bold text-ink">${m.symbol}</span>
                          )}
                          <span className={`rounded border px-1 py-px text-[9px] font-bold uppercase ${s.cls}`} title={s.title}>
                            {s.label}
                          </span>
                        </div>
                        <a
                          href={`${m.explorer}/address/${m.curve}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-faint hover:text-accent"
                        >
                          curve {short(m.curve)} <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </div>
                      <div className="text-ink-soft">
                        <span className="text-[9px] uppercase text-ink-faint md:hidden">Chain </span>
                        {m.chainName}
                      </div>
                      <div className="text-ink-soft">
                        <span className="text-[9px] uppercase text-ink-faint md:hidden">Contract </span>
                        {m.version ? `v${m.version}` : "pre-0.11.0"}
                        {m.creatorFeeBps !== null && (
                          <span className="block text-[10px] text-ink-faint">
                            your share {(m.creatorFeeBps / 100).toFixed(2)}%
                            {m.totalFeeBps !== null ? ` · fee ${(m.totalFeeBps / 100).toFixed(2)}%` : ""}
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="text-[9px] uppercase text-ink-faint md:hidden">Earned </span>
                        <span className="font-mono text-ink">{fmtNative(m.lifetime, m.nativeSymbol)}</span>
                        <span className="block text-[10px] text-ink-faint">{fmtUsd(m.lifetimeUsd)}</span>
                      </div>
                      <div>
                        <span className="text-[9px] uppercase text-ink-faint md:hidden">Claimable </span>
                        <span className="font-mono text-ink">{fmtNative(m.owed, m.nativeSymbol)}</span>
                        <span className="block text-[10px] text-ink-faint">{fmtUsd(m.owedUsd)}</span>
                      </div>
                      <div className="col-span-2 flex justify-end md:col-span-1 md:w-16">
                        {m.error ? (
                          <span className="text-[10px] text-warn" title={m.error}>
                            not readable
                          </span>
                        ) : own && owedPositive ? (
                          <button
                            type="button"
                            onClick={() => claimOne(m)}
                            disabled={claiming !== null}
                            data-testid="claim-one"
                            className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-accent-strong disabled:opacity-50"
                          >
                            {claiming === m.key ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Coins className="h-3 w-3" />}
                            Claim
                          </button>
                        ) : (
                          <span className="text-[10px] text-ink-faint">{owedPositive ? "" : "nothing owed"}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-ink-faint">
            <span>
              Read from chain at {new Date(data.readAt).toISOString().slice(11, 19)} UTC · {data.checked} curves checked
              {data.unreadable > 0 ? ` · ${data.unreadable} could not be read and are missing` : ""}
            </span>
            <button
              type="button"
              onClick={() => target && load(target)}
              disabled={loading}
              className="inline-flex items-center gap-1 font-semibold text-accent hover:underline disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Info className="h-3.5 w-3.5 text-accent" /> How these numbers are read
        </h2>
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-soft">
          <li>
            Each curve is asked three things: <code className="text-accent">creator()</code>,{" "}
            <code className="text-accent">creatorOwed()</code> and <code className="text-accent">totalCreatorFeesPaid()</code>.
            Earned all time is paid out plus claimable. Nothing comes from our database.
          </li>
          <li>
            Markets come from the site&apos;s registry and from the record of every launch on chain, and one counts only
            when the curve&apos;s own <code className="text-accent">creator()</code> is this address.
          </li>
          <li>
            Dollar values use today&apos;s price of each chain&apos;s native coin, not the price on the day a fee was
            earned.
          </li>
          <li>
            Claiming is permissionless and always pays the creator address fixed in the curve, so no one can redirect it.
            Claim all bundles the claims on one chain into a single transaction through Multicall3. A claim costs gas, and
            when the amount owed is smaller than the gas, claiming loses money.
          </li>
        </ul>
      </div>
    </div>
  );
}
