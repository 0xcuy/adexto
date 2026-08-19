"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ethers } from "ethers";
import {
  ArrowDownUp, RefreshCw, ExternalLink, Flame, CheckCircle2,
  AlertTriangle, Lock, Settings2, ShieldCheck,
} from "lucide-react";

import { useWallet } from "@/context/WalletContext";
import WalletMenu from "@/components/WalletMenu";
import { CHAIN_LIST, explorerAddressUrl, explorerTxUrl, resolveChainOrDefault } from "@/lib/chains";
import { describeTxError } from "@/lib/dex";
import { FALLBACK_PRICES, assetPriceUsd, formatSmallNumber, formatTokenAmount, formatUsd, plainDecimal, type AssetPrices } from "@/lib/pricing";
import { useSovereignSwap, type SwapMarket } from "@/lib/use-sovereign-swap";

/**
 * Sovereign DEX swap surface.
 *
 * Rewritten to remove four defects found in the audit:
 *   - the token list was replaced wholesale by the /api/graphql response and the
 *     chain dropdown's `onChange` looked markets up in a *different* static array,
 *     so selecting a network could load a price object that was not in the visible
 *     dropdown (QNOVA flipped between $0.00018 and $0.292);
 *   - prices were parsed out of unit-mixed strings and treated as USD;
 *   - the trade was a bare native transfer with no calldata and no slippage bound;
 *   - nothing checked that the wallet was on the market's chain.
 *
 * The chain control is now a *filter* over markets. The chain a trade executes on
 * always comes from the selected market, so the two can no longer disagree.
 */

interface Market extends SwapMarket {
  /** `chainId:SYMBOL` — the ticker alone is no longer unique across chains. */
  marketKey: string;
  slug: string;
  image: string;
  agentModel: string;
  chainLabel: string;
  chainKey: string;
  nativeSymbol: string;
  verified: boolean;
  tradable: boolean;
  poolLive: boolean;
  deployedChainCount: number;
}

const SLIPPAGE_OPTIONS = [50, 100, 300, 500];

export default function SwapTerminal() {
  const searchParams = useSearchParams();
  const requestedSymbol = (searchParams.get("token") || "").toUpperCase();
  const chainParam = searchParams.get("chain");
  const requestedChainId = chainParam && Number.isFinite(Number(chainParam)) ? Number(chainParam) : null;

  const { address, isConnected, isConnecting, connectWallet, walletChainId, switchToChain, isOnChain } = useWallet();

  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [chainFilter, setChainFilter] = useState<string>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [prices, setPrices] = useState<AssetPrices>(FALLBACK_PRICES);
  const [showSlippage, setShowSlippage] = useState(false);
  /**
   * Praseleksi dari ?token=/?chain= hanya boleh terjadi SEKALI. Tanpa penjaga ini,
   * mengosongkan pilihan (karena filter chain tidak memuat market apa pun) akan
   * langsung memicu praseleksi memilih market dari chain lain — persis desync yang
   * ingin dihilangkan.
   */
  const preselectDone = useRef(false);

  // ── market list (single source of truth) ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/graphql", { method: "POST" });
        const json = await res.json();
        const list: Market[] = (json?.data?.projects ?? []).map((p: any) => ({
          marketKey: String(p.marketKey ?? `${p.chainId}:${String(p.symbol).toUpperCase()}`),
          symbol: String(p.symbol).toUpperCase(),
          slug: String(p.slug ?? p.symbol).toLowerCase(),
          name: p.name,
          tokenAddress: p.tokenAddress,
          poolAddress: p.poolAddress ?? null,
          chainId: Number(p.chainId),
          chainLabel: p.chain,
          chainKey: String(p.chainKey ?? ""),
          nativeSymbol: p.nativeSymbol,
          priceNative: Number(p.priceNative) || 0,
          lpFeeBps: Number(p.lpFeeBps) || 20,
          treasuryBuybackBps: Number(p.treasuryBuybackBps) || 10,
          image: p.image || "/logo.svg",
          agentModel: p.agentModel || "0G Compute",
          verified: Boolean(p.verified),
          tradable: Boolean(p.tradable),
          poolLive: Boolean(p.poolLive),
          deployedChainCount: Number(p.deployedChainCount) || 1,
        }));
        if (cancelled) return;
        setMarkets(list);
      } catch {
        // leave list empty; the UI explains it
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/prices");
        const data = await res.json();
        if (!cancelled && data?.prices) setPrices({ ...FALLBACK_PRICES, ...data.prices });
      } catch {
        // fallback table already set
      }
    }
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Preselect from ?token= (optionally pinned with ?chain=), then the first
  // tradable market, then the first entry. Selection is by market key because the
  // same ticker can exist on several chains.
  const visibleMarkets = useMemo(
    () => (chainFilter === "all" ? markets : markets.filter((m) => m.chainId === Number(chainFilter))),
    [markets, chainFilter]
  );

  /**
   * Satu efek memiliki seluruh urusan pemilihan market, dengan urutan tegas.
   * Dulu ini dua efek terpisah dan yang kedua berjalan di commit yang SAMA dengan
   * yang pertama memakai state lama, sehingga menimpa pilihan dari URL
   * (`?token=CSENT` berakhir di QNOVA). `return` setelah praseleksi yang mencegahnya.
   */
  useEffect(() => {
    if (markets.length === 0) return;

    // 1. Praseleksi dari URL — sekali saja, saat market pertama kali tersedia.
    if (!preselectDone.current) {
      const byQuery = markets.filter((m) => m.symbol === requestedSymbol);
      // ?token= menang atas ?chain=. Kalau chain yang diminta tidak punya market
      // untuk symbol itu (tautan basi, salah ketik, chain sudah dihapus), jangan
      // pernah jatuh ke market symbol LAIN — user bisa membeli token yang salah.
      const pinned =
        (requestedChainId ? byQuery.find((m) => m.chainId === requestedChainId) : undefined) ??
        byQuery.find((m) => m.tradable) ??
        byQuery[0];
      const initial = pinned ?? markets.find((m) => m.tradable) ?? markets[0];
      preselectDone.current = true;
      setSelectedKey(initial.marketKey);
      // Filter DIBIARKAN "all". Memaksanya ke chain market terpilih akan
      // menyembunyikan market chain lain dari daftar tanpa alasan, dan "All chains"
      // bersama market mana pun memang tidak bertentangan.
      return;
    }

    // 2. Sesudahnya: filter chain dan market terpilih wajib sepakat. Dulu filter
    // hanya menyaring daftar, sehingga memilih chain tanpa market meninggalkan
    // header, biaya, harga dan panel trading pada market chain SEBELUMNYA —
    // terlihat seperti "ganti chain tidak berpengaruh". Sekarang kalau chain punya
    // market, pindah ke market chain itu; kalau tidak ada, kosongkan pilihan agar
    // seluruh panel jujur menyatakan tidak ada market.
    if (selectedKey && visibleMarkets.some((m) => m.marketKey === selectedKey)) return;
    const next = visibleMarkets.find((m) => m.tradable) ?? visibleMarkets[0] ?? null;
    setSelectedKey(next ? next.marketKey : null);
  }, [markets, visibleMarkets, requestedSymbol, requestedChainId, selectedKey, chainFilter]);

  const selected = useMemo(
    () => markets.find((m) => m.marketKey === selectedKey) ?? null,
    [markets, selectedKey]
  );

  const swap = useSovereignSwap(selected, address);
  const chain = swap.chain;
  const nativeUsd = assetPriceUsd(chain.nativeSymbol, prices);
  const onCorrectChain = selected ? isOnChain(selected.chainId) : false;

  const tokenPriceUsd = swap.spotPriceNative * nativeUsd;
  const inputUsd = useMemo(() => {
    if (swap.parsedAmount <= 0n) return 0;
    return swap.mode === "buy"
      ? Number(ethers.formatEther(swap.parsedAmount)) * nativeUsd
      : Number(ethers.formatUnits(swap.parsedAmount, swap.tokenDecimals)) * tokenPriceUsd;
  }, [swap.parsedAmount, swap.mode, swap.tokenDecimals, nativeUsd, tokenPriceUsd]);

  const feeUsd = useMemo(() => {
    if (!swap.quote) return { lp: 0, creator: 0, buyback: 0 };
    const native = (v: bigint) => Number(ethers.formatEther(v));
    return {
      lp: native(swap.quote.lpFee) * nativeUsd,
      creator: native(swap.quote.creatorFee) * nativeUsd,
      buyback: native(swap.quote.treasuryFee) * nativeUsd,
    };
  }, [swap.quote, nativeUsd]);

  const tradableCount = markets.filter((m) => m.tradable).length;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-accent-soft text-accent border border-accent/30 text-xs font-mono font-bold mb-2">
          SOVEREIGN BONDING CURVE · VIRTUAL RESERVE
        </div>
        <h1 className="text-3xl font-semibold text-ink">Sovereign DEX Swap</h1>
        <p className="text-xs sm:text-sm text-ink mt-1 max-w-lg mx-auto font-medium">
          Native ↔ token routing through each project&apos;s own bonding curve. Every fill splits the fee three ways
          on-chain: depth that stays in the curve, the creator&apos;s share, and the agent buyback vault.
        </p>
        {!loading && (
          <p className="text-[11px] font-mono text-ink-faint mt-2">
            {tradableCount} of {markets.length} markets have an executable curve
          </p>
        )}
      </div>

      <div className="max-w-md mx-auto">
        {/* Strip wallet hanya ditampilkan saat SUDAH tersambung. Saat belum,
            tombol utama di bawah kartu ("Connect wallet to swap") dan tombol di
            navbar sudah menjadi ajakan yang sama — tiga CTA identik dalam satu
            layar hanya membuat bingung. */}
        {isConnected && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Trading wallet</span>
            <WalletMenu />
          </div>
        )}

        <div className="glass-panel p-6 rounded-3xl border-2 border-line shadow-2xl">
          {/* Header + chain filter */}
          <div className="flex items-center justify-between border-b border-line pb-4 mb-4 gap-3">
            <div className="min-w-0">
              <span className="font-bold text-ink text-sm block truncate">
                {selected ? selected.name : "Select a market"}
              </span>
              <span className="text-[10px] text-ink-soft font-mono">
                {/* lpFeeBps kini berarti porsi depth yang mengendap di kurva, jadi
                    labelnya "depth" — bukan "LP", karena tidak ada penyedia likuiditas. */}
                {selected
                  ? `${(selected.lpFeeBps / 100).toFixed(2)}% depth / ${(selected.treasuryBuybackBps / 100).toFixed(2)}% buyback`
                  : "—"}
              </span>
            </div>
            <select
              value={chainFilter}
              onChange={(e) => setChainFilter(e.target.value)}
              className="bg-white border border-line text-accent text-xs font-mono font-bold rounded-lg px-2.5 py-1 focus:outline-none cursor-pointer shrink-0"
              aria-label="Filter markets by chain"
            >
              <option value="all">All chains</option>
              {CHAIN_LIST.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.name} ({c.chainId})
                </option>
              ))}
            </select>
          </div>

          {/* Market selector */}
          <div className="mb-4 p-3 rounded-xl bg-white border border-line space-y-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-ink-soft">
              <span>Market</span>
              {selected && (
                <span className={selected.tradable ? "text-ok" : "text-warn"}>
                  {selected.tradable ? "pool live" : "no executable pool"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selected && (
                <div className="w-7 h-7 rounded-lg overflow-hidden bg-cream-2 shrink-0 border border-line">
                  <img src={selected.image} alt={selected.name} className="w-full h-full object-cover" />
                </div>
              )}
              <select
                value={selectedKey ?? ""}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="flex-1 bg-transparent text-ink font-mono font-bold text-xs focus:outline-none cursor-pointer"
                aria-label="Select market"
              >
                {visibleMarkets.length === 0 && <option value="">No markets on this chain</option>}
                {visibleMarkets.map((m) => (
                  <option key={m.marketKey} value={m.marketKey} className="bg-white text-ink">
                    ${m.symbol} · {m.chainKey} — {m.name}
                    {m.tradable ? "" : " (no pool)"}
                  </option>
                ))}
              </select>
            </div>
            {selected && (
              <div className="flex items-center justify-between text-[10px] font-mono pt-1 border-t border-line">
                <span className="text-accent font-bold">
                  {selected.chainLabel}
                  {selected.deployedChainCount > 1 && (
                    <span className="ml-1.5 text-accent">
                      · also on {selected.deployedChainCount - 1} more chain{selected.deployedChainCount > 2 ? "s" : ""}
                    </span>
                  )}
                </span>
                <a
                  href={explorerAddressUrl(chain, selected.poolAddress ?? selected.tokenAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-soft hover:text-ink flex items-center gap-1"
                >
                  {(selected.poolAddress ?? selected.tokenAddress).slice(0, 6)}…
                  {(selected.poolAddress ?? selected.tokenAddress).slice(-4)}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            )}
          </div>

          {/* Chain terpilih tidak punya market: jelaskan, jangan biarkan panel kosong tanpa sebab */}
          {!loading && visibleMarkets.length === 0 && chainFilter !== "all" && (
            <div className="mb-4 p-3 rounded-xl bg-white border border-accent/30 space-y-2">
              <div className="flex items-start gap-2 text-[11px] font-mono text-accent">
                <AlertTriangle className="w-3.5 h-3.5 text-accent mt-0.5 shrink-0" />
                <span>
                  No market on {resolveChainOrDefault(Number(chainFilter)).name} yet. Markets are created per chain, so a
                  token launched elsewhere does not appear here automatically.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setChainFilter("all")}
                className="w-full py-1.5 rounded-lg bg-accent-soft text-accent border border-accent/30 font-semibold text-[11px]"
              >
                Show all chains ({markets.length} markets)
              </button>
            </div>
          )}

          {/* Chain guard */}
          {isConnected && selected && !onCorrectChain && (
            <div className="mb-4 p-3 rounded-xl bg-warn/10 border border-warn/30 space-y-2">
              <div className="flex items-start gap-2 text-[11px] font-mono text-warn">
                <AlertTriangle className="w-3.5 h-3.5 text-warn mt-0.5 shrink-0" />
                <span>
                  Wallet is on chain {walletChainId ?? "unknown"}; ${selected.symbol} settles on {chain.name} (
                  {chain.chainId}).
                </span>
              </div>
              <button
                type="button"
                onClick={() => switchToChain(chain).catch((e) => swap.setErrorLine(describeTxError(e)))}
                className="w-full py-1.5 rounded-lg bg-warn hover:bg-warn/90 text-white font-semibold text-[11px] transition-colors"
              >
                Switch to {chain.name}
              </button>
            </div>
          )}

          {/* Pool unavailable */}
          {selected && swap.poolChecked && !swap.tradable && (
            <div className="mb-4 p-3 rounded-xl bg-cream-3 border border-warn/30 flex items-start gap-2 text-[11px] font-mono text-warn">
              <Lock className="w-3.5 h-3.5 text-warn mt-0.5 shrink-0" />
              <span>{swap.poolStatusMessage}</span>
            </div>
          )}

          {/* Direction */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex rounded-lg bg-cream-2 p-0.5 border border-line font-mono text-[10px]">
              {(["buy", "sell"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => swap.setMode(m)}
                  className={`px-3 py-1 rounded-md font-bold uppercase transition-all ${
                    swap.mode === m
                      ? m === "buy"
                        ? "bg-ok/10 text-ok"
                        : "bg-danger/10 text-danger"
                      : "text-ink-soft"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowSlippage((v) => !v)}
              className="p-1 rounded text-ink-soft hover:text-ink"
              title="Slippage settings"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {showSlippage && (
            <div className="mb-3 p-2.5 rounded-xl bg-cream-2 border border-line flex items-center justify-between font-mono text-[10px]">
              <span className="text-ink-soft">Max slippage</span>
              <div className="flex gap-1">
                {SLIPPAGE_OPTIONS.map((bps) => (
                  <button
                    key={bps}
                    onClick={() => swap.setSlippageBps(bps)}
                    className={`px-2 py-0.5 rounded font-bold border ${
                      swap.slippageBps === bps
                        ? "bg-accent-soft text-accent border-accent/30"
                        : "bg-cream-3 text-ink-soft border-transparent"
                    }`}
                  >
                    {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* You pay */}
          <div className="p-4 rounded-2xl bg-white border border-line space-y-2 mb-2">
            <div className="flex justify-between items-center text-xs text-ink-soft font-medium">
              <span>You pay</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px]">
                  {swap.mode === "buy"
                    ? `${swap.nativeBalanceFormatted} ${chain.nativeSymbol}`
                    : `${swap.tokenBalanceFormatted} ${selected?.symbol ?? ""}`}
                </span>
                {isConnected && (
                  <button
                    type="button"
                    onClick={swap.setMaxAmount}
                    className="px-1.5 py-0.5 rounded bg-accent-soft text-accent border border-accent/30 text-[10px] font-mono font-semibold uppercase"
                  >
                    Max
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="w-1/2">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={swap.amountInput}
                  onChange={(e) => swap.setAmountInput(e.target.value)}
                  className="w-full bg-transparent text-2xl font-semibold text-ink font-mono focus:outline-none"
                  placeholder="0.0"
                />
                <span className="text-[10px] text-ink-soft font-mono block">≈ {formatUsd(inputUsd)}</span>
              </div>
              <span className="bg-cream-3 text-ink font-bold text-xs rounded-xl px-3 py-2 border border-line font-mono">
                {swap.mode === "buy" ? chain.nativeSymbol : selected?.symbol ?? "—"}
              </span>
            </div>
          </div>

          <div className="flex justify-center -my-2 z-10 relative">
            <button
              type="button"
              onClick={() => swap.setMode(swap.mode === "buy" ? "sell" : "buy")}
              className="p-2 rounded-xl bg-accent-soft hover:bg-accent-soft text-ink border border-accent/30 shadow-lg shadow-accent/10 transition-all"
              title="Flip direction"
            >
              <ArrowDownUp className="w-4 h-4" />
            </button>
          </div>

          {/* You receive */}
          <div className="p-4 rounded-2xl bg-white border border-line space-y-2 mt-2 mb-4">
            <div className="flex justify-between text-xs text-ink-soft font-medium">
              <span>You receive (estimated)</span>
              {selected && (
                <span
                  className="font-mono text-[11px]"
                  title={
                    swap.spotPriceNative > 0
                      ? `${plainDecimal(swap.spotPriceNative)} ${chain.nativeSymbol} per token`
                      : undefined
                  }
                >
                  1 {selected.symbol} ={" "}
                  {swap.spotPriceNative > 0 ? formatSmallNumber(swap.spotPriceNative) : "—"}{" "}
                  {chain.nativeSymbol}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-2xl font-semibold text-accent font-mono truncate w-2/3">
                {swap.outputAmount > 0 ? formatTokenAmount(swap.outputAmount) : "0"}
              </div>
              <span className="bg-accent-soft text-accent font-mono font-bold text-xs rounded-xl px-3 py-2 border border-accent/30">
                {swap.mode === "buy" ? selected?.symbol ?? "—" : chain.nativeSymbol}
              </span>
            </div>
            {swap.quote && swap.quote.amountOut > 0n && (
              <div className="pt-1 space-y-0.5 text-[10px] font-mono text-ink-faint border-t border-line">
                <div className="flex justify-between pt-1">
                  <span>
                    Minimum received ({(swap.slippageBps / 100).toFixed(swap.slippageBps % 100 === 0 ? 0 : 1)}%
                    slippage)
                  </span>
                  <span className="text-ink-soft">
                    {formatTokenAmount(
                      swap.mode === "buy"
                        ? Number(ethers.formatUnits(swap.minReceived, swap.tokenDecimals))
                        : Number(ethers.formatEther(swap.minReceived))
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Price impact</span>
                  <span className={swap.quote.priceImpactBps > 500 ? "text-warn" : "text-ink-soft"}>
                    {(swap.quote.priceImpactBps / 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Fees */}
          {selected && (
            <div className="p-3.5 rounded-xl bg-accent-soft border border-accent/30 space-y-1.5 text-xs font-mono mb-5 text-ink">
              <div className="flex justify-between">
                <span>Curve depth ({(selected.lpFeeBps / 100).toFixed(2)}%) — stays in curve</span>
                <span className="text-ink">{formatUsd(feeUsd.lp)}</span>
              </div>
              {swap.pool?.creatorFeeBps ? (
                <div className="flex justify-between text-ok">
                  <span>↳ Creator ({(Number(swap.pool.creatorFeeBps) / 100).toFixed(2)}%)</span>
                  <span>{formatUsd(feeUsd.creator)}</span>
                </div>
              ) : null}
              <div className="flex justify-between text-accent font-bold">
                <span className="flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-accent" /> Agent buyback (
                  {(selected.treasuryBuybackBps / 100).toFixed(2)}%)
                </span>
                <span>{formatUsd(feeUsd.buyback)}</span>
              </div>
            </div>
          )}

          {swap.errorLine && (
            <div className="mb-4 p-3 rounded-xl bg-danger/10 border border-danger/30 text-[11px] font-mono text-danger flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
              <span>{swap.errorLine}</span>
            </div>
          )}

          {swap.txHash && !swap.errorLine && (
            <div className="mb-4 p-4 rounded-xl bg-ok/10 border border-ok/30 text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-ok font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5 text-ok" /> Swap settled
              </div>
              <p className="text-xs text-ink font-medium">{swap.statusLine}</p>
              <a
                href={explorerTxUrl(chain, swap.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-accent font-bold hover:underline inline-flex items-center gap-1"
              >
                {swap.txHash.slice(0, 10)}…{swap.txHash.slice(-8)} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          <button
            onClick={() => (isConnected ? swap.execute(address) : connectWallet())}
            disabled={isConnected ? swap.busy || !swap.tradable || swap.parsedAmount <= 0n : isConnecting}
            /* Sama seperti tombol launch di studio: keadaan nonaktif diberi warna
               sendiri alih-alih diredupkan, supaya alasan terkuncinya tetap terbaca. */
            className="w-full py-4 rounded-xl font-semibold text-sm bg-accent hover:bg-accent-strong text-white transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:bg-cream-3 disabled:text-ink-soft"
          >
            {swap.busy ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> {swap.statusLine ?? "Working…"}
              </>
            ) : !isConnected ? (
              "Connect wallet to swap"
            ) : !selected ? (
              "Select a market"
            ) : !swap.tradable ? (
              "Trading unavailable"
            ) : !onCorrectChain ? (
              `Switch to ${chain.name} first`
            ) : swap.mode === "buy" ? (
              `Buy $${selected.symbol}`
            ) : (
              `Approve & sell $${selected.symbol}`
            )}
          </button>

          {selected && (
            <div className="mt-4 pt-4 border-t border-line flex items-center justify-between text-[10px] font-mono">
              <span className="text-ink-faint flex items-center gap-1">
                {selected.verified ? (
                  <>
                    <ShieldCheck className="w-3 h-3 text-ok" /> contract verified
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3 h-3 text-warn" /> showcase entry
                  </>
                )}
              </span>
              <Link
                href={`/token/${selected.slug}?chain=${selected.chainId}`}
                className="text-accent hover:underline font-bold"
              >
                Open ${selected.symbol} terminal →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
