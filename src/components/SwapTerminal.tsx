"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ethers } from "ethers";
import { RefreshCw, ExternalLink, CheckCircle2, AlertTriangle, Lock, Settings2, ShieldCheck } from "lucide-react";

import { useWallet } from "@/context/WalletContext";
import WalletMenu from "@/components/WalletMenu";
import MarketPicker, { filterByChain } from "@/components/MarketPicker";
import { FeeLines, SlippageRow, TradeAmounts, slippagePercent } from "@/components/swap-parts";
import { explorerAddressUrl, explorerTxUrl, resolveChainOrDefault } from "@/lib/chains";
import { describeTxError } from "@/lib/dex";
import { FALLBACK_PRICES, assetPriceUsd, type AssetPrices } from "@/lib/pricing";
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

/* Panel jumlah, lencana aset, baris slippage, dan baris biaya hidup di
   swap-parts.tsx. Halaman ini dan /token/[token] memperdagangkan hal yang sama lewat
   mesin yang sama, dan sebelumnya tampilannya ditulis dua kali — lengkap dengan
   selisih yang tidak pernah diputuskan siapa pun. Alasan lengkapnya di berkas itu. */

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
  // Syarat filternya milik MarketPicker supaya daftar yang DIGAMBAR dan pilihan
  // yang DIANGGAP SAH tidak pernah memakai aturan berbeda.
  const visibleMarkets = useMemo(() => filterByChain(markets, chainFilter), [markets, chainFilter]);

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
      {/* Lencana mono berbingkai "SOVEREIGN BONDING CURVE · VIRTUAL RESERVE" diganti
          `.kicker`, bentuk eyebrow yang sama dengan seluruh situs. Yang lama adalah
          satu-satunya elemen bertipografi terminal di atas lipatan halaman ini, dan
          huruf monospace bertingkat huruf besar pada 12px justru paling lambat
          dibaca dari semua teks di kartu — tepat kebalikan dari tugas sebuah eyebrow. */}
      <div className="mb-8 flex flex-col items-center text-center">
        <p className="kicker mb-3">Sovereign bonding curve · virtual reserve</p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Swap</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          Native ↔ token routing through each project&apos;s own bonding curve. Every fill splits the fee three ways
          on-chain: depth that stays in the curve, the creator&apos;s share, and the agent buyback vault.
        </p>
        {!loading && (
          <p className="mt-3 text-xs text-ink-faint">
            <span data-numeric>{tradableCount}</span> of <span data-numeric>{markets.length}</span> markets have an
            executable curve
          </p>
        )}
      </div>

      <div className="max-w-md mx-auto">
        {/* Strip wallet hanya ditampilkan saat SUDAH tersambung. Saat belum,
            tombol utama di bawah kartu ("Connect wallet to swap") dan tombol di
            navbar sudah menjadi ajakan yang sama — tiga CTA identik dalam satu
            layar hanya membuat bingung. */}
        {isConnected && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-3.5 py-2.5">
            <span className="text-xs font-medium text-ink-soft">Trading wallet</span>
            <WalletMenu />
          </div>
        )}

        {/* `border-2 ... shadow-2xl` dihapus. `.glass-panel` sudah membawa bayangan
            halusnya sendiri, jadi keduanya bersama menghasilkan garis dobel tebal
            plus bayangan pekat — berat, dan di tema cream terbaca seperti kartu yang
            melayang terlalu tinggi. Kedalaman di sini datang dari bayangan, bukan
            dari bingkai yang makin tebal. */}
        <div className="glass-panel rounded-3xl p-5 sm:p-6">
          {/* Pemilih market. Dulu dua `<select>` bawaan sistem — satu untuk chain,
              satu untuk market — dan alasan lengkap penggantiannya ada di
              MarketPicker.tsx. Filter chain sekarang hidup DI DALAM pemilih itu,
              karena "chain mana" hanyalah cara menyaring market, bukan keputusan
              terpisah yang layak menempati barisnya sendiri di kartu. */}
          <MarketPicker
            markets={markets}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            chainFilter={chainFilter}
            onChainFilter={setChainFilter}
            loading={loading}
          />

          {selected && (
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1 text-xs">
              <span className="flex items-center gap-2">
                <span className={selected.tradable ? "font-medium text-ok" : "font-medium text-warn"}>
                  {selected.tradable ? "Pool live" : "No executable pool"}
                </span>
                <span aria-hidden="true" className="h-3 w-px bg-line-strong" />
                {/* lpFeeBps kini berarti porsi depth yang mengendap di kurva, jadi
                    labelnya "depth" — bukan "LP", karena tidak ada penyedia likuiditas. */}
                <span className="text-ink-soft">
                  <span data-numeric>{(selected.lpFeeBps / 100).toFixed(2)}%</span> depth ·{" "}
                  <span data-numeric>{(selected.treasuryBuybackBps / 100).toFixed(2)}%</span> buyback
                </span>
              </span>
              <a
                href={explorerAddressUrl(chain, selected.poolAddress ?? selected.tokenAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-ink-faint transition-colors hover:text-ink"
              >
                <span className="font-mono">
                  {(selected.poolAddress ?? selected.tokenAddress).slice(0, 6)}…
                  {(selected.poolAddress ?? selected.tokenAddress).slice(-4)}
                </span>
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          )}

          {selected && selected.deployedChainCount > 1 && (
            <p className="mt-1 px-1 text-xs text-ink-faint">
              Also launched on <span data-numeric>{selected.deployedChainCount - 1}</span> more chain
              {selected.deployedChainCount > 2 ? "s" : ""} — each one is a separate market with its own price.
            </p>
          )}

          <div className="mt-4" />

          {/* Registry benar-benar kosong — penyebabnya BUKAN filter, jadi jangan
              tawarkan "Show all chains" yang sama kosongnya. Sebelum ini keadaan
              ini tidak dijelaskan sama sekali pada filter "all": panel hanya
              menampilkan dropdown kosong tanpa sebab. */}
          {!loading && markets.length === 0 && (
            <div className="mb-4 rounded-2xl border border-line bg-white p-3.5">
              <div className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-soft">
                <Lock className="w-3.5 h-3.5 text-ink-faint mt-0.5 shrink-0" />
                {/* The reason had to change when the fact did. This read "the curve
                    factory has not been broadcast to mainnet", which was true until
                    0.10.0 went live on all four chains and then quietly became false
                    — the same trap /explorer already carries a note about. The panel
                    is still empty, but for a completely different reason: launching
                    works and nobody has used it yet. */}
                <span>
                  <strong className="text-ink">No markets exist yet.</strong> The curve factory is live on all four
                  mainnets and launching is enabled — nothing has been launched through it yet, so there is nothing
                  to swap. This panel fills in on its own as soon as the first curve goes live.
                </span>
              </div>
            </div>
          )}

          {/* Chain terpilih tidak punya market: jelaskan, jangan biarkan panel kosong tanpa sebab */}
          {!loading && markets.length > 0 && visibleMarkets.length === 0 && chainFilter !== "all" && (
            <div className="mb-4 space-y-2 rounded-2xl border border-accent/30 bg-white p-3.5">
              <div className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-soft">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <span>
                  <strong className="font-semibold text-ink">
                    No market on {resolveChainOrDefault(Number(chainFilter)).name} yet.
                  </strong>{" "}
                  Markets are created per chain, so a token launched elsewhere does not appear here automatically.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setChainFilter("all")}
                className="w-full rounded-xl border border-accent/30 bg-accent-soft py-2 text-xs font-semibold text-accent"
              >
                Show all chains (<span data-numeric>{markets.length}</span> markets)
              </button>
            </div>
          )}

          {/* Chain guard */}
          {isConnected && selected && !onCorrectChain && (
            <div className="mb-4 space-y-2 rounded-2xl border border-warn/30 bg-warn/10 p-3.5">
              <div className="flex items-start gap-2.5 text-xs leading-relaxed text-ink">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                <span>
                  Wallet is on chain <span className="font-mono">{walletChainId ?? "unknown"}</span>; $
                  {selected.symbol} settles on {chain.name} (<span className="font-mono">{chain.chainId}</span>).
                </span>
              </div>
              <button
                type="button"
                onClick={() => switchToChain(chain).catch((e) => swap.setErrorLine(describeTxError(e)))}
                className="w-full rounded-xl bg-warn py-2 text-xs font-semibold text-white transition-colors hover:bg-warn/90"
              >
                Switch to {chain.name}
              </button>
            </div>
          )}

          {/* Pool unavailable */}
          {selected && swap.poolChecked && !swap.tradable && (
            <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-warn/30 bg-cream-3 p-3.5 text-xs leading-relaxed text-ink">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
              <span>{swap.poolStatusMessage}</span>
            </div>
          )}

          {/* Direction */}
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex rounded-xl border border-line bg-cream-2 p-1 text-xs">
              {(["buy", "sell"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => swap.setMode(m)}
                  aria-pressed={swap.mode === m}
                  className={`rounded-lg px-3.5 py-1.5 font-semibold capitalize transition-colors ${
                    swap.mode === m
                      ? m === "buy"
                        ? "bg-ok/10 text-ok"
                        : "bg-danger/10 text-danger"
                      : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowSlippage((v) => !v)}
              aria-expanded={showSlippage}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-soft transition-colors hover:bg-cream-2 hover:text-ink"
              title="Slippage settings"
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span data-numeric>{slippagePercent(swap.slippageBps)}</span>
            </button>
          </div>

          {showSlippage && <SlippageRow value={swap.slippageBps} onChange={swap.setSlippageBps} />}

          {/* Panel jumlah, tombol tukar arah, dan rincian kuotasi kini datang dari
              swap-parts.tsx — satu definisi yang dipakai halaman ini dan
              /token/[token]. Sebelumnya keduanya menulis panel yang sama dua kali,
              dan selisihnya (ukuran input, letak saldo, gaya lencana simbol) tidak
              pernah diputuskan siapa pun. */}
          <TradeAmounts
            swap={swap}
            tokenSymbol={selected?.symbol ?? "—"}
            tokenLogo={selected?.image ?? null}
            inputUsd={inputUsd}
            isConnected={isConnected}
          />

          <div className="mb-4" />

          {selected && (
            <div className="mb-5">
              <FeeLines
                lpFeeBps={selected.lpFeeBps}
                treasuryBuybackBps={selected.treasuryBuybackBps}
                creatorFeeBps={swap.pool?.creatorFeeBps ? Number(swap.pool.creatorFeeBps) : null}
                feeUsd={feeUsd}
              />
            </div>
          )}

          {swap.errorLine && (
            <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-danger/30 bg-danger/10 p-3.5 text-xs leading-relaxed text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <span>{swap.errorLine}</span>
            </div>
          )}

          {swap.txHash && !swap.errorLine && (
            <div className="mb-4 space-y-2 rounded-2xl border border-ok/30 bg-ok/10 p-4 text-center">
              <div className="flex items-center justify-center gap-2 text-sm font-semibold text-ok">
                <CheckCircle2 className="h-5 w-5 text-ok" /> Swap settled
              </div>
              <p className="text-xs text-ink-soft">{swap.statusLine}</p>
              <a
                href={explorerTxUrl(chain, swap.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
              >
                {/* Hash transaksi: string mesin, jadi monospace memang tempatnya. */}
                <span className="font-mono">
                  {swap.txHash.slice(0, 10)}…{swap.txHash.slice(-8)}
                </span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          <button
            onClick={() => (isConnected ? swap.execute(address) : connectWallet())}
            disabled={isConnected ? swap.busy || !swap.tradable || swap.parsedAmount <= 0n : isConnecting}
            /* Sama seperti tombol launch di studio: keadaan nonaktif diberi warna
               sendiri alih-alih diredupkan, supaya alasan terkuncinya tetap terbaca. */
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-4 text-[15px] font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-cream-3 disabled:text-ink-soft"
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
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4 text-xs">
              <span className="flex items-center gap-1.5 text-ink-faint">
                {selected.verified ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-ok" /> Contract verified
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" /> Showcase entry
                  </>
                )}
              </span>
              <Link
                href={`/token/${selected.slug}?chain=${selected.chainId}`}
                className="shrink-0 font-semibold text-accent hover:underline"
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
