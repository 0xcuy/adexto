"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import {
  ShieldCheck, RefreshCw, ExternalLink, Bot, Send, Copy, Check,
  CloudLightning, Cpu, AlertTriangle, Lock, ArrowDownUp, Settings2, CheckCircle2, Network,
} from "lucide-react";

import { useWallet } from "@/context/WalletContext";
import WalletMenu from "@/components/WalletMenu";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { FormattedMarkdown } from "@/components/FormattedMarkdown";
import RealtimeCandleChart from "@/components/RealtimeCandleChart";
import LiveOrderBook from "@/components/LiveOrderBook";
import LiveTradeFeed from "@/components/LiveTradeFeed";
import Link from "next/link";
import { CHAIN_LIST, explorerAddressUrl, explorerTxUrl } from "@/lib/chains";
import { claimCreatorFees, describeTxError } from "@/lib/dex";
import { FALLBACK_PRICES, assetPriceUsd, formatSmallNumber, formatTokenAmount, formatUsd, plainDecimal, type AssetPrices } from "@/lib/pricing";
import { useSovereignSwap } from "@/lib/use-sovereign-swap";

/**
 * Market terminal.
 *
 * Trading runs through the shared `useSovereignSwap` engine, so this page and
 * /swap cannot drift apart again. The specific defects it closes:
 *   - SELL used to send `value: parseEther(amount)`, i.e. entering 50000 asked the
 *     wallet to transfer 50,000 native coins. Selling is now approve + transferFrom.
 *   - The displayed price and the price used for the quote disagreed because of
 *     `priceUSD < 0.1 ? priceUSD : 0.00015`. Both now come from the pool reserves.
 *   - `payCurrency` was initialised from `agent.chain` on first render, before the
 *     async project fetch resolved, and never resynced. The pay asset is now derived
 *     from the market's chain and is the only asset the pool accepts.
 *   - "Market Cap" printed the token supply. It is now supply × price in USD.
 */

export interface TerminalProject {
  symbol: string;
  slug: string;
  name: string;
  tokenAddress: string;
  poolAddress: string | null;
  chainId: number;
  chainLabel: string;
  nativeSymbol: string;
  priceNative: number;
  supply: number;
  lpFeeBps: number;
  treasuryBuybackBps: number;
  agentModel: string;
  agentPersona: string;
  agentStatus: string;
  image: string;
  teeRoot: string | null;
  txHash: string | null;
  verified: boolean;
  curated: boolean;
  poolLive: boolean;
  edgeProvider: string;
  mcpTools: string[];
}

export interface TerminalDeployment {
  chainId: number;
  chainKey: string;
  chainName: string;
  nativeSymbol: string;
  tokenAddress: string;
  poolAddress: string | null;
  priceNative: number;
  tradable: boolean;
  isCurrent: boolean;
}

const SLIPPAGE_OPTIONS = [50, 100, 300, 500];

export default function TokenTerminal({
  project,
  deployments = [],
}: {
  project: TerminalProject;
  deployments?: TerminalDeployment[];
}) {
  const { address, isConnected, isConnecting, connectWallet, walletChainId, switchToChain, isOnChain } = useWallet();

  const market = useMemo(
    () => ({
      symbol: project.symbol,
      name: project.name,
      tokenAddress: project.tokenAddress,
      poolAddress: project.poolAddress,
      chainId: project.chainId,
      priceNative: project.priceNative,
      lpFeeBps: project.lpFeeBps,
      treasuryBuybackBps: project.treasuryBuybackBps,
    }),
    [project]
  );

  const swap = useSovereignSwap(market, address);
  const chain = swap.chain;

  const [prices, setPrices] = useState<AssetPrices>(FALLBACK_PRICES);
  const [showSlippage, setShowSlippage] = useState(false);
  const [copied, setCopied] = useState(false);
 const [claimingFees, setClaimingFees] = useState(false);
 const [claimLine, setClaimLine] = useState<string | null>(null);

  const onCorrectChain = isOnChain(project.chainId);
  const nativeUsd = assetPriceUsd(chain.nativeSymbol, prices);
  const tokenPriceUsd = swap.spotPriceNative * nativeUsd;
  /** Penghasilan creator dalam USD: 0.0₄1 0G tidak memberi tahu apa pun soal nilainya. */
  const creatorOwedUsd = swap.pool ? Number(ethers.formatEther(swap.pool.creatorOwed)) * nativeUsd : 0;
  const marketCapUsd = project.supply * tokenPriceUsd;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/prices");
        const data = await res.json();
        if (!cancelled && data?.prices) setPrices({ ...FALLBACK_PRICES, ...data.prices });
      } catch {
        // fallback table already in place
      }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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

  const copyAddress = () => {
    navigator.clipboard.writeText(project.tokenAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── agent chat ───────────────────────────────────────────────────────────
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChatMessages([
      {
        role: "assistant",
        content: `⚡ **${project.name} ($${project.symbol})**\n\n• Network: **${chain.name}** (${chain.chainId})\n• Fee split: **${(project.lpFeeBps / 100).toFixed(2)}% depth / ${(project.treasuryBuybackBps / 100).toFixed(2)}% buyback**, plus the creator's share of every swap\n• Token: \`${project.tokenAddress.slice(0, 10)}…${project.tokenAddress.slice(-8)}\`\n• Curve: ${project.poolAddress ? `\`${project.poolAddress.slice(0, 10)}…${project.poolAddress.slice(-8)}\`` : "**not deployed yet**"}\n\nAsk me about strategy, curve depth or swap telemetry.`,
      },
    ]);
  }, [
    project.name,
    project.symbol,
    project.tokenAddress,
    project.poolAddress,
    project.lpFeeBps,
    project.treasuryBuybackBps,
    chain.name,
    chain.chainId,
  ]);

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, chatLoading]);

  const sendChat = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chatInput.trim() || chatLoading) return;

    const next = [...chatMessages, { role: "user" as const, content: chatInput }];
    setChatMessages(next);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          model: "glm-5.2",
          chain: chain.name,
          // Panel ini menawarkan "ask me about pool depth or swap telemetry", jadi
          // state pool NYATA harus ikut dikirim. Sebelumnya prompt hanya memuat
          // alamat dan fee, sehingga agent menjawab "once you provide reserves…" —
          // janji yang tidak pernah dipenuhi aplikasi.
          systemPrompt:
            `You are ${project.name} ($${project.symbol}), the agent bound to this token on ${chain.name} (chainId ${chain.chainId}). ` +
            `Mandate: ${project.agentPersona}. Token ${project.tokenAddress}. ` +
            `Curve ${project.poolAddress ?? "not deployed"}. Fees ${(project.lpFeeBps / 100).toFixed(2)}% depth retained by the curve / ${(project.treasuryBuybackBps / 100).toFixed(2)}% agent buyback` +
            (swap.pool ? ` / ${(Number(swap.pool.creatorFeeBps) / 100).toFixed(2)}% to the creator` : "") +
            `. 100% of supply sits in the curve and the creator holds no tokens, so creator income comes from swap fees, not an allocation. ` +
            (swap.pool
              ? `LIVE CURVE STATE (constant product x*y=k over a VIRTUAL native reserve, read from chain just now): ` +
                `reserveNative=${ethers.formatEther(swap.pool.reserveNative)} ${chain.nativeSymbol}, ` +
                `reserveToken=${ethers.formatUnits(swap.pool.reserveToken, swap.pool.tokenDecimals)} ${project.symbol}, ` +
                `spotPrice=${swap.spotPriceNative} ${chain.nativeSymbol} per token. ` +
                `Buy math: fees are taken from the input, then tokensOut = reserveToken*dx/(reserveNative+dx) where dx = amountIn*(1-${(
                  (project.lpFeeBps + project.treasuryBuybackBps) /
                  10000
                ).toFixed(4)}). ` +
                `Sell math: grossOut = reserveNative*dt/(reserveToken+dt), then fees are taken from the output. ` +
                `A buy followed immediately by a sell returns (1-fee)^2 of the input regardless of size, because the price impact reverses. ` +
                `User balances: ${swap.nativeBalanceFormatted} ${chain.nativeSymbol}, ${swap.tokenBalanceFormatted} ${project.symbol}. ` +
                `Use these numbers directly; never ask the user to supply reserves. `
              : `The pool is not tradable yet, so there are no reserves to reason about. Say so plainly. `) +
            // Kontrak keluaran yang tegas. Tanpa ini glm-5.2 menuliskan kerja
            // hitungnya di kanal `content` ("Wait, let me just do it directly…"),
            // sehingga panel penuh aritmetika setengah jalan, bukan jawaban.
            `OUTPUT RULES, follow strictly: reply with the FINAL answer only. ` +
            `Maximum 4 short bullet points, each one line, under 90 words total. ` +
            `Show at most one number per bullet, already rounded. ` +
            `Never show intermediate arithmetic, never restate the question, never write "let me", "wait", or "actually". ` +
            `Never claim a trade settled unless the user reports a transaction hash.`,
          temperature: 0.1,
        }),
      });
      if (!res.ok || !res.body) throw new Error("chat unavailable");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";
      setChatMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        setChatMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: reply };
          return copy;
        });
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "The 0G Compute router is unreachable right now. Try again shortly." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="max-w-[1560px] mx-auto px-2 sm:px-4 py-6 space-y-4">
      {/* Header */}
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border-2 border-line flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl overflow-hidden bg-cream-2 border-2 border-accent/30 p-1 flex items-center justify-center shrink-0">
            <img src={project.image} alt={project.name} className="w-full h-full object-cover rounded-xl" />
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-semibold text-ink">{project.name}</h1>
              <span className="px-2.5 py-0.5 rounded-lg bg-gradient-to-r from-accent/20 to-accent/20 text-accent border border-accent/30 font-mono text-xs font-bold">
                ${project.symbol}
              </span>
              {project.verified ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-ok/10 text-ok border border-ok/30 font-bold inline-flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Contract verified on-chain
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-warn/10 text-warn border border-warn/30 font-bold inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Showcase entry — not factory-minted
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-ink-soft mt-1">
              <span className="text-accent font-bold bg-accent-soft px-2 py-0.5 rounded border border-accent/30">
                {project.chainLabel}
              </span>
              {deployments.length > 1 && (
                <span className="text-accent font-bold bg-accent-soft px-2 py-0.5 rounded border border-accent/30">
                  {deployments.length} chains
                </span>
              )}
              <button onClick={copyAddress} className="hover:text-ink flex items-center gap-1">
                <span>
                  {project.tokenAddress.slice(0, 6)}…{project.tokenAddress.slice(-4)}
                </span>
                {copied ? <Check className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3" />}
              </button>
              <a
                href={explorerAddressUrl(chain, project.tokenAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline flex items-center gap-1"
              >
                Explorer <ExternalLink className="w-3 h-3" />
              </a>
              {project.poolAddress && (
                <a
                  href={explorerAddressUrl(chain, project.poolAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline flex items-center gap-1"
                >
                  Pool <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <a
                href={`https://adexto-x402-edge.cucuvirtual.workers.dev/v1/x402/${project.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline flex items-center gap-1 font-bold"
              >
                x402 API <CloudLightning className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Market cap didahulukan, harga per token dibelakangkan.
            Dengan supply 1 miliar, harga per token selalu mikroskopis
            (0.0₅15 dan seterusnya) — itu angka yang paling sulit dibaca sekaligus
            paling jarang dipakai orang untuk memutuskan. Market cap dan nilai USD
            adalah yang benar-benar dibandingkan orang, jadi itu yang di depan.
            Angka mentahnya tetap bisa dilihat lewat tooltip. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs text-center">
          {/* Label menyebut chain-nya, karena angka ini per chain dan tanpa itu ia
              terbaca sebagai market cap proyek secara keseluruhan.
              Satu ticker yang diluncurkan di empat chain berarti EMPAT pasar
              terpisah, masing-masing dengan supply sendiri dan harga sendiri, dan
              tidak ada bridge yang bisa menyatukannya. Menjumlahkan keempatnya
              bukan angka yang bermakna, jadi tidak dijumlahkan di mana pun — tapi
              pembaca yang melihat satu angka besar tanpa keterangan chain akan
              menganggapnya total. Tooltipnya menyatakan batasannya dengan kata-kata. */}
          <Stat
            label={`Market cap · ${chain.key}`}
            value={marketCapUsd > 0 ? formatUsd(marketCapUsd, { compact: true }) : "—"}
            tone="accent"
            title={
              marketCapUsd > 0
                ? `${marketCapUsd} USD on ${chain.name} only. Each chain has its own curve, its own supply and its own price; there is no bridge, so these are separate markets and this figure is not a cross-chain total.`
                : undefined
            }
          />
          <Stat
            label="Price USD"
            value={tokenPriceUsd > 0 ? formatUsd(tokenPriceUsd) : "—"}
            tone="ink"
            title={tokenPriceUsd > 0 ? `${tokenPriceUsd.toFixed(18).replace(/0+$/, "")} USD per token` : undefined}
          />
          {/* Sama alasannya: ini supply di chain INI. Ticker yang diluncurkan di
              empat chain punya empat supply terpisah sebesar ini masing-masing, dan
              bukan satu supply yang dibagi-bagi. */}
          <Stat
            label={`Supply (${project.symbol}) · ${chain.key}`}
            value={formatTokenAmount(project.supply)}
            tone="accent"
            title={`${project.supply.toLocaleString()} ${project.symbol} minted on ${chain.name}. Each chain this ticker launched on has its own separate supply of this size — it is not one supply split across chains.`}
          />
          <Stat
            label={`Price (${chain.nativeSymbol})`}
            value={swap.spotPriceNative > 0 ? formatSmallNumber(swap.spotPriceNative) : "—"}
            tone="ink"
            title={
              swap.spotPriceNative > 0
                ? `${swap.spotPriceNative.toFixed(18).replace(/0+$/, "")} ${chain.nativeSymbol} per token`
                : undefined
            }
          />
        </div>
      </div>

      {/* Chain switcher. Selalu tampil, dan selalu menampilkan SEMUA chain yang
          didukung — bukan hanya chain tempat token ini ada. Dulu panel ini
          disembunyikan bila token hanya ada di satu chain, sehingga di terminal
          tidak ada cara berpindah chain dan tidak terlihat bahwa chain lain
          memang belum punya market untuk token ini. */}
      <div className="glass-panel rounded-2xl border border-line overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-cream-3/[0.03] px-3 py-2">
          <div className="flex items-center gap-2">
            <Network className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink">
              ${project.symbol} markets
            </span>
            <span className="rounded border border-accent/30 bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-bold text-accent">
              {deployments.length} of {CHAIN_LIST.length} chains
            </span>
          </div>
          <span className="font-mono text-[10px] text-ink-faint">
            Independent pool and price per chain · no bridging
          </span>
        </div>

        <div className="grid grid-cols-2 gap-px bg-cream-3 sm:grid-cols-4">
          {CHAIN_LIST.map((c) => {
            const d = deployments.find((x) => x.chainId === c.chainId);

            // Chain tanpa market: ditandai jelas, tidak bisa diklik. Membiarkannya
            // seolah bisa dipilih akan membuat user menunggu pool yang tidak ada.
            if (!d) {
              return (
                <div key={c.chainId} className="bg-white px-3 py-2.5 opacity-60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-ink-soft">{c.key}</span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">not launched</span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-ink-faint">
                    No ${project.symbol} market on this chain
                  </p>
                </div>
              );
            }

            return (
              <Link
                key={c.chainId}
                href={`/token/${project.slug}?chain=${c.chainId}`}
                aria-current={d.isCurrent ? "true" : undefined}
                className={`group bg-white px-3 py-2.5 transition-colors ${
                  d.isCurrent ? "bg-accent-soft ring-1 ring-inset ring-accent/40" : "hover:bg-cream-3"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-mono text-[11px] font-bold ${d.isCurrent ? "text-accent" : "text-ink"}`}
                  >
                    {c.key}
                  </span>
                  {d.isCurrent ? (
                    <span className="flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-wider text-accent">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> viewing
                    </span>
                  ) : d.tradable ? (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-ok">pool live</span>
                  ) : (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-warn">no pool</span>
                  )}
                </div>
                {/* USD di depan, native di tooltip — karena inilah panel tempat orang
                    MEMBANDINGKAN chain, dan satuan native tidak sebanding.
                    Sebelumnya baris ini hanya menampilkan harga native, sehingga Base
                    berbunyi 1.5847e-9 ETH dan Monad 1.4604e-4 MON. Dua angka yang
                    terlihat berbeda jauh padahal nilainya PERSIS sama, $4.000e-6:
                    keempat kurva dibuka pada market cap USD yang identik. Jadi panel
                    yang seharusnya memudahkan perbandingan justru membuat keempat
                    chain tampak paling berbeda, dan yang dibandingkan orang sebenarnya
                    hanya derau satuan.
                    Dengan USD di depan, harga yang sama terbaca sama, dan divergensi
                    yang muncul kemudian adalah divergensi yang sungguhan. */}
                {(() => {
                  const chainNativeUsd = assetPriceUsd(d.nativeSymbol, prices);
                  const usd = d.priceNative * chainNativeUsd;
                  return (
                    <p
                      className="mt-0.5 truncate font-mono text-[10px] text-ink-soft"
                      title={
                        d.priceNative > 0
                          ? `${formatSmallNumber(d.priceNative)} ${d.nativeSymbol} per token on ${c.name}${
                              usd > 0 ? ` · ${usd} USD` : ""
                            }`
                          : undefined
                      }
                    >
                      {d.priceNative <= 0
                        ? "not priced yet"
                        : usd > 0
                        ? `≈ $${formatSmallNumber(usd)}`
                        : `${formatSmallNumber(d.priceNative)} ${d.nativeSymbol}`}
                    </p>
                  );
                })()}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Chain guard */}
      {isConnected && !onCorrectChain && (
        <div className="p-3 rounded-2xl bg-warn/10 border border-warn/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2 text-xs font-mono text-warn">
            <AlertTriangle className="w-4 h-4 text-warn mt-0.5 shrink-0" />
            <span>
              Your wallet is on chain <strong>{walletChainId ?? "unknown"}</strong> but this market settles on{" "}
              <strong>
                {chain.name} ({chain.chainId})
              </strong>
              . Trading stays blocked until you switch — otherwise native value would go to an address that only exists on
              another chain.
            </span>
          </div>
          <button
            type="button"
            onClick={() => switchToChain(chain).catch((e) => swap.setErrorLine(describeTxError(e)))}
            className="px-3 py-1.5 rounded-lg bg-warn hover:bg-warn/90 text-white font-semibold text-xs shrink-0 transition-colors"
          >
            Switch to {chain.name}
          </button>
        </div>
      )}

      {/* Pool not tradable */}
      {swap.poolChecked && !swap.tradable && (
        <div className="p-3 rounded-2xl bg-cream-3 border border-warn/30 flex items-start gap-2 text-xs font-mono text-warn">
          <Lock className="w-4 h-4 text-warn mt-0.5 shrink-0" />
          <span>{swap.poolStatusMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: chart + depth */}
        <div className="lg:col-span-7 space-y-4">
          <div className="glass-panel p-4 rounded-3xl border-2 border-line h-[470px] shadow-2xl bg-white flex flex-col justify-between">
            <RealtimeCandleChart
              symbol={project.symbol}
              chainId={project.chainId}
              fallbackPriceNative={project.priceNative}
              nativeSymbol={chain.nativeSymbol}
              nativeUsd={nativeUsd}
              poolLive={swap.tradable}
            />
            <div className="p-2.5 rounded-xl bg-white border border-line flex items-center justify-between text-[10px] font-mono text-ink-soft mt-2 shrink-0">
              <span className="flex items-center gap-1.5 text-ink">
                <Cpu className="w-3.5 h-3.5 text-accent" /> {project.agentModel}
              </span>
              <span className="text-accent font-bold">
                {(project.treasuryBuybackBps / 100).toFixed(2)}% auto-buyback
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="glass-panel p-4 rounded-3xl border-2 border-line min-h-[260px] shadow-2xl bg-white overflow-hidden">
              <LiveOrderBook
                symbol={project.symbol}
                chainId={project.chainId}
                nativeSymbol={chain.nativeSymbol}
                nativeUsd={nativeUsd}
              />
            </div>
            <div className="glass-panel p-4 rounded-3xl border-2 border-line min-h-[260px] shadow-2xl bg-white overflow-hidden">
              <LiveTradeFeed symbol={project.symbol} chainId={project.chainId} nativeUsd={nativeUsd} />
            </div>
          </div>
        </div>

        {/* Right: swap + chat */}
        <div className="lg:col-span-5 space-y-4">
          {/* Penghasilan creator.
              Hanya tampil bagi alamat creator yang terkunci di kurva, karena hanya
              dia yang bisa menerimanya. Klaim memakai pola tarik, bukan dorong:
              kalau fee didorong tiap swap, wallet creator berupa kontrak yang revert
              akan membekukan seluruh perdagangan token ini. */}
          {isConnected &&
            swap.pool?.isCurve &&
            swap.pool.creator &&
            address &&
            swap.pool.creator.toLowerCase() === address.toLowerCase() && (
              <div className="rounded-2xl border border-ok/30 bg-ok/10 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ok/90">
                    Your creator revenue
                  </span>
                  <span className="font-mono text-[10px] text-ink-faint">
                    {(Number(swap.pool.creatorFeeBps) / 100).toFixed(2)}% of every swap
                  </span>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    {/* Tooltip berisi angka mentah: penghasilan adalah angka yang
                        orang ingin baca tepat, bukan ditebak dari notasi ringkas. */}
                    <p
                      className="font-mono text-lg font-bold text-ink"
                      title={`${plainDecimal(Number(ethers.formatEther(swap.pool.creatorOwed)))} ${chain.nativeSymbol}`}
                    >
                      {formatSmallNumber(Number(ethers.formatEther(swap.pool.creatorOwed)))} {chain.nativeSymbol}
                      {creatorOwedUsd > 0 && (
                        <span className="text-ink-soft text-xs font-normal"> · {formatUsd(creatorOwedUsd)}</span>
                      )}
                    </p>
                    <p className="font-mono text-[10px] text-ink-faint">unclaimed</p>
                  </div>
                  <button
                    type="button"
                    disabled={swap.pool.creatorOwed === 0n || claimingFees}
                    onClick={async () => {
                      setClaimingFees(true);
                      setClaimLine(null);
                      try {
                        const ethereum = getActiveEip1193();
                        if (!ethereum) throw new Error("No wallet available.");
                        const { hash } = await claimCreatorFees({
                          ethereum,
                          chain,
                          curveAddress: project.poolAddress as string,
                        });
                        setClaimLine(`Claimed. ${hash.slice(0, 10)}…`);
                        swap.refresh();
                      } catch (e) {
                        setClaimLine(describeTxError(e));
                      } finally {
                        setClaimingFees(false);
                      }
                    }}
                    className="rounded-xl bg-ok px-3 py-2 font-mono text-[11px] font-semibold text-white transition-colors hover:bg-ok/90 disabled:opacity-40"
                  >
                    {claimingFees ? "Claiming…" : "Claim"}
                  </button>
                </div>
                {claimLine && <p className="font-mono text-[10px] text-ok">{claimLine}</p>}
              </div>
            )}

          {/* Sama seperti /swap: strip wallet hanya muncul setelah tersambung,
              agar tidak ada dua ajakan "Connect wallet" bertumpuk. */}
          {isConnected && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Trading wallet</span>
              <WalletMenu />
            </div>
          )}

          <div className="glass-panel p-5 rounded-3xl border-2 border-line shadow-2xl bg-white space-y-3">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <span className="font-mono text-xs font-bold text-ink">Sovereign Curve Swap</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSlippage((v) => !v)}
                  className="p-1 rounded text-ink-soft hover:text-ink"
                  title="Slippage settings"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </button>
                <div className="flex rounded-lg bg-cream-2 p-0.5 border border-line font-mono text-[10px]">
                  {(["buy", "sell"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => swap.setMode(m)}
                      className={`px-3 py-1 rounded-md font-bold transition-all uppercase ${
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
              </div>
            </div>

            {showSlippage && (
              <div className="p-2.5 rounded-xl bg-cream-2 border border-line flex items-center justify-between font-mono text-[10px]">
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

            <div className="space-y-2 font-mono text-xs">
              {/* You pay */}
              <div className="p-3 rounded-2xl bg-cream-2 border border-line space-y-1">
                <div className="flex justify-between text-[10px] text-ink-soft">
                  <span>You pay</span>
                  <div className="flex items-center gap-1.5">
                    <span>
                      Balance:{" "}
                      {swap.mode === "buy"
                        ? `${swap.nativeBalanceFormatted} ${chain.nativeSymbol}`
                        : `${swap.tokenBalanceFormatted} ${project.symbol}`}
                    </span>
                    {isConnected && (
                      <button
                        type="button"
                        onClick={swap.setMaxAmount}
                        className="px-1.5 rounded bg-accent-soft text-accent border border-accent/30 text-[9px] font-bold"
                      >
                        MAX
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={swap.amountInput}
                    onChange={(e) => swap.setAmountInput(e.target.value)}
                    className="w-2/3 bg-transparent text-xl font-semibold text-ink focus:outline-none"
                    placeholder="0.0"
                  />
                  {/* The pool only accepts the chain's native asset, so this is fixed
                      rather than a dropdown of assets it cannot route. */}
                  <span className="bg-white border border-line text-accent font-bold px-2.5 py-1 rounded-lg text-xs">
                    {swap.mode === "buy" ? chain.nativeSymbol : project.symbol}
                  </span>
                </div>
                <span className="text-[10px] text-ink-faint block">≈ {formatUsd(inputUsd)}</span>
              </div>

              <div className="flex justify-center -my-1">
                <button
                  type="button"
                  onClick={() => swap.setMode(swap.mode === "buy" ? "sell" : "buy")}
                  className="p-1.5 rounded-lg bg-accent-soft hover:bg-accent-soft text-ink border border-accent/30"
                  title="Flip direction"
                >
                  <ArrowDownUp className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* You receive */}
              <div className="p-3 rounded-2xl bg-cream-2 border border-line space-y-1">
                <div className="flex justify-between text-[10px] text-ink-soft">
                  <span>You receive (estimated)</span>
                  <span
                    title={
                      swap.spotPriceNative > 0
                        ? `${plainDecimal(swap.spotPriceNative)} ${chain.nativeSymbol} per token`
                        : undefined
                    }
                  >
                    1 {project.symbol} ={" "}
                    {swap.spotPriceNative > 0 ? formatSmallNumber(swap.spotPriceNative) : "—"}{" "}
                    {chain.nativeSymbol}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xl font-semibold text-accent truncate w-2/3">
                    {swap.outputAmount > 0 ? formatTokenAmount(swap.outputAmount) : "0"}
                  </div>
                  <span className="font-bold text-accent bg-accent-soft px-2.5 py-1 rounded-lg text-xs">
                    {swap.mode === "buy" ? `$${project.symbol}` : chain.nativeSymbol}
                  </span>
                </div>
                {swap.quote && swap.quote.amountOut > 0n && (
                  <div className="pt-1 space-y-0.5 text-[10px] text-ink-faint">
                    <div className="flex justify-between">
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

              {/* Three fee lines, because the fee genuinely splits three ways now.
                  Showing only depth and buyback would hide where the creator's
                  revenue comes from. */}
              <div className="p-2.5 rounded-xl bg-accent-soft border border-accent/30 text-[10px] space-y-1 text-ink-soft">
                <div className="flex justify-between">
                  <span>Curve depth ({(project.lpFeeBps / 100).toFixed(2)}%) — stays in curve</span>
                  <span>{formatUsd(feeUsd.lp)}</span>
                </div>
                {swap.pool?.creatorFeeBps ? (
                  <div className="flex justify-between text-ok">
                    <span>↳ Creator ({(Number(swap.pool.creatorFeeBps) / 100).toFixed(2)}%)</span>
                    <span>{formatUsd(feeUsd.creator)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-accent font-bold">
                  <span>↳ Agent buyback ({(project.treasuryBuybackBps / 100).toFixed(2)}%)</span>
                  <span>{formatUsd(feeUsd.buyback)}</span>
                </div>
              </div>
            </div>

            {swap.errorLine && (
              <div className="p-2.5 rounded-xl bg-danger/10 border border-danger/30 text-[10px] font-mono text-danger flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
                <span>{swap.errorLine}</span>
              </div>
            )}

            {swap.txHash && !swap.errorLine && (
              <div className="p-2.5 rounded-xl bg-ok/10 border border-ok/30 text-[10px] font-mono text-ok flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-ok mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <div>{swap.statusLine}</div>
                  <a
                    href={explorerTxUrl(chain, swap.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-bold text-accent inline-flex items-center gap-1"
                  >
                    {swap.txHash.slice(0, 10)}…{swap.txHash.slice(-8)} <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>
            )}

            <button
              onClick={() => (isConnected ? swap.execute(address) : connectWallet())}
              disabled={isConnected ? swap.busy || !swap.tradable || swap.parsedAmount <= 0n : isConnecting}
              /* Beli/jual adalah ARAH, jadi di sini hijau dan merah memang tepat.
                 Sebelumnya keduanya gradien dua warna yang berakhir di ungu, jadi
                 tombol beli dan tombol jual berbagi separuh warna yang sama — pada
                 satu-satunya kontrol di halaman yang salah tekannya mahal. Sekarang
                 satu warna pekat per arah, teks putih supaya kontrasnya lolos. */
              className={`w-full py-3.5 rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:bg-cream-3 disabled:text-ink-soft ${
                swap.mode === "buy" ? "bg-ok text-white" : "bg-danger text-white"
              }`}
            >
              {swap.busy ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {swap.statusLine ?? "Working…"}
                </>
              ) : !isConnected ? (
                "Connect wallet to trade"
              ) : !swap.tradable ? (
                "Trading unavailable"
              ) : !onCorrectChain ? (
                `Switch to ${chain.name} first`
              ) : swap.mode === "buy" ? (
                `Buy $${project.symbol}`
              ) : (
                `Approve & sell $${project.symbol}`
              )}
            </button>

            {swap.mode === "sell" && swap.tradable && (
              <p className="text-[9px] font-mono text-ink-faint leading-relaxed">
                Selling moves ERC-20 tokens via <code className="text-accent">approve</code> +{" "}
                <code className="text-accent">transferFrom</code>. No native {chain.nativeSymbol} leaves your wallet
                beyond gas.
              </p>
            )}
          </div>

          {/* Agent chat */}
          <div className="glass-panel p-4 rounded-3xl border-2 border-line h-[340px] shadow-2xl bg-white flex flex-col justify-between overflow-hidden">
            <div className="flex items-center justify-between border-b border-line pb-2 mb-2 shrink-0">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-accent" />
                <span className="font-mono text-xs font-bold text-ink">Chat with ${project.symbol} agent</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-ok/10 text-ok border border-ok/30 font-bold">
                0G TEE
              </span>
            </div>

            <div ref={chatScrollRef} className="flex-1 overflow-y-auto space-y-2 p-1 font-sans text-xs">
              {chatMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-xl text-xs leading-relaxed ${
                    m.role === "user"
                      ? "bg-accent-soft border border-accent/30 text-ink ml-4"
                      : "bg-white border border-line text-ink mr-2"
                  }`}
                >
                  <span className="text-[9px] font-mono font-bold block mb-1 uppercase text-ink-faint">
                    {m.role === "user" ? "You" : `${project.name} (0G TEE)`}
                  </span>
                  <FormattedMarkdown text={m.content} />
                </div>
              ))}
              {chatLoading && (
                <div className="p-2 rounded-xl bg-cream-2 text-accent font-mono text-[11px] flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Reasoning on 0G…
                </div>
              )}
            </div>

            <form onSubmit={sendChat} className="pt-2 border-t border-line flex gap-1.5 shrink-0">
              <input
                type="text"
                placeholder={`Ask ${project.symbol} agent…`}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={chatLoading}
                className="flex-1 rounded-xl px-3 py-2 text-xs bg-cream-2 border border-line focus:border-accent/30 focus:outline-none text-ink"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="p-2 rounded-xl bg-accent text-white disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Satu angka pasar.
 *
 * `tone` dulu berupa "white" | "cyan" | "pink" — sisa dari tema gelap berenam
 * aksen. Setelah palet disatukan, "cyan" dan "pink" menghasilkan kelas yang sama
 * persis, jadi pemanggil harus memilih di antara dua nama yang tidak berbeda.
 * Sekarang namanya menyebut maksudnya: "accent" untuk angka yang ingin ditonjolkan,
 * "ink" untuk angka biasa.
 */
function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone: "accent" | "ink";
  /** Angka mentah tanpa notasi ringkas, supaya notasi subscript bisa dibaca. */
  title?: string;
}) {
  const color = tone === "accent" ? "text-accent" : "text-ink";
  return (
    <div className="p-3 rounded-2xl bg-white border border-line" title={title}>
      <span className="text-[10px] text-ink-soft block">{label}</span>
      <span className={`text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}
