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
            `You are ${project.name} ($${project.symbol}), an ERC-8004 agent on ${chain.name} (chainId ${chain.chainId}). ` +
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
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border-2 border-white/15 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl overflow-hidden bg-black border-2 border-cyan-500/40 p-1 flex items-center justify-center shrink-0">
            <img src={project.image} alt={project.name} className="w-full h-full object-cover rounded-xl" />
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black text-white">{project.name}</h1>
              <span className="px-2.5 py-0.5 rounded-lg bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-300 border border-cyan-500/40 font-mono text-xs font-bold">
                ${project.symbol}
              </span>
              {project.verified ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/40 font-bold inline-flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Contract verified on-chain
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40 font-bold inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Showcase entry — not factory-minted
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-zinc-400 mt-1">
              <span className="text-cyan-300 font-bold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
                {project.chainLabel}
              </span>
              {deployments.length > 1 && (
                <span className="text-purple-300 font-bold bg-purple-950/50 px-2 py-0.5 rounded border border-purple-500/30">
                  {deployments.length} chains
                </span>
              )}
              <button onClick={copyAddress} className="hover:text-white flex items-center gap-1">
                <span>
                  {project.tokenAddress.slice(0, 6)}…{project.tokenAddress.slice(-4)}
                </span>
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
              <a
                href={explorerAddressUrl(chain, project.tokenAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline flex items-center gap-1"
              >
                Explorer <ExternalLink className="w-3 h-3" />
              </a>
              {project.poolAddress && (
                <a
                  href={explorerAddressUrl(chain, project.poolAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-300 hover:underline flex items-center gap-1"
                >
                  Pool <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <a
                href={`https://adexto-x402-edge.cucuvirtual.workers.dev/v1/x402/${project.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400 hover:underline flex items-center gap-1 font-bold"
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
          <Stat
            label="Market cap"
            value={marketCapUsd > 0 ? formatUsd(marketCapUsd, { compact: true }) : "—"}
            tone="cyan"
            title={marketCapUsd > 0 ? `${marketCapUsd} USD` : undefined}
          />
          <Stat
            label="Price USD"
            value={tokenPriceUsd > 0 ? formatUsd(tokenPriceUsd) : "—"}
            tone="white"
            title={tokenPriceUsd > 0 ? `${tokenPriceUsd.toFixed(18).replace(/0+$/, "")} USD per token` : undefined}
          />
          <Stat label={`Supply (${project.symbol})`} value={formatTokenAmount(project.supply)} tone="pink" />
          <Stat
            label={`Price (${chain.nativeSymbol})`}
            value={swap.spotPriceNative > 0 ? formatSmallNumber(swap.spotPriceNative) : "—"}
            tone="white"
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
      <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="flex items-center gap-2">
            <Network className="h-3.5 w-3.5 shrink-0 text-purple-300" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-200">
              ${project.symbol} markets
            </span>
            <span className="rounded border border-purple-500/30 bg-purple-950/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-purple-200">
              {deployments.length} of {CHAIN_LIST.length} chains
            </span>
          </div>
          <span className="font-mono text-[10px] text-zinc-500">
            Independent pool and price per chain · no bridging
          </span>
        </div>

        <div className="grid grid-cols-2 gap-px bg-white/5 sm:grid-cols-4">
          {CHAIN_LIST.map((c) => {
            const d = deployments.find((x) => x.chainId === c.chainId);

            // Chain tanpa market: ditandai jelas, tidak bisa diklik. Membiarkannya
            // seolah bisa dipilih akan membuat user menunggu pool yang tidak ada.
            if (!d) {
              return (
                <div key={c.chainId} className="bg-[#050912] px-3 py-2.5 opacity-60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-zinc-400">{c.key}</span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">not launched</span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
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
                className={`group bg-[#050912] px-3 py-2.5 transition-colors ${
                  d.isCurrent ? "bg-cyan-950/30 ring-1 ring-inset ring-cyan-500/40" : "hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-mono text-[11px] font-bold ${d.isCurrent ? "text-cyan-200" : "text-white"}`}
                  >
                    {c.key}
                  </span>
                  {d.isCurrent ? (
                    <span className="flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" /> viewing
                    </span>
                  ) : d.tradable ? (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-400">pool live</span>
                  ) : (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-amber-400">no pool</span>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-400">
                  {d.priceNative > 0 ? `${formatSmallNumber(d.priceNative)} ${d.nativeSymbol}` : "not priced yet"}
                </p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Chain guard */}
      {isConnected && !onCorrectChain && (
        <div className="p-3 rounded-2xl bg-amber-950/40 border border-amber-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2 text-xs font-mono text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
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
            className="px-3 py-1.5 rounded-lg bg-amber-500 text-black font-black text-xs shrink-0"
          >
            Switch to {chain.name}
          </button>
        </div>
      )}

      {/* Pool not tradable */}
      {swap.poolChecked && !swap.tradable && (
        <div className="p-3 rounded-2xl bg-[#1a1206] border border-amber-500/30 flex items-start gap-2 text-xs font-mono text-amber-200">
          <Lock className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <span>{swap.poolStatusMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: chart + depth */}
        <div className="lg:col-span-7 space-y-4">
          <div className="glass-panel p-4 rounded-3xl border-2 border-white/15 h-[470px] shadow-2xl bg-[#030610] flex flex-col justify-between">
            <RealtimeCandleChart
              symbol={project.symbol}
              chainId={project.chainId}
              fallbackPriceNative={project.priceNative}
              nativeSymbol={chain.nativeSymbol}
              nativeUsd={nativeUsd}
              poolLive={swap.tradable}
            />
            <div className="p-2.5 rounded-xl bg-[#040714] border border-white/10 flex items-center justify-between text-[10px] font-mono text-zinc-400 mt-2 shrink-0">
              <span className="flex items-center gap-1.5 text-slate-200">
                <Cpu className="w-3.5 h-3.5 text-purple-400" /> {project.agentModel}
              </span>
              <span className="text-cyan-300 font-bold">
                {(project.treasuryBuybackBps / 100).toFixed(2)}% auto-buyback
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="glass-panel p-4 rounded-3xl border-2 border-white/15 min-h-[260px] shadow-2xl bg-[#030712] overflow-hidden">
              <LiveOrderBook
                symbol={project.symbol}
                chainId={project.chainId}
                nativeSymbol={chain.nativeSymbol}
                nativeUsd={nativeUsd}
              />
            </div>
            <div className="glass-panel p-4 rounded-3xl border-2 border-white/15 min-h-[260px] shadow-2xl bg-[#030712] overflow-hidden">
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
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/15 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300/90">
                    Your creator revenue
                  </span>
                  <span className="font-mono text-[10px] text-zinc-500">
                    {(Number(swap.pool.creatorFeeBps) / 100).toFixed(2)}% of every swap
                  </span>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    {/* Tooltip berisi angka mentah: penghasilan adalah angka yang
                        orang ingin baca tepat, bukan ditebak dari notasi ringkas. */}
                    <p
                      className="font-mono text-lg font-bold text-white"
                      title={`${plainDecimal(Number(ethers.formatEther(swap.pool.creatorOwed)))} ${chain.nativeSymbol}`}
                    >
                      {formatSmallNumber(Number(ethers.formatEther(swap.pool.creatorOwed)))} {chain.nativeSymbol}
                      {creatorOwedUsd > 0 && (
                        <span className="text-zinc-400 text-xs font-normal"> · {formatUsd(creatorOwedUsd)}</span>
                      )}
                    </p>
                    <p className="font-mono text-[10px] text-zinc-500">unclaimed</p>
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
                    className="rounded-xl bg-emerald-500 px-3 py-2 font-mono text-[11px] font-black text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
                  >
                    {claimingFees ? "Claiming…" : "Claim"}
                  </button>
                </div>
                {claimLine && <p className="font-mono text-[10px] text-emerald-200">{claimLine}</p>}
              </div>
            )}

          {/* Sama seperti /swap: strip wallet hanya muncul setelah tersambung,
              agar tidak ada dua ajakan "Connect wallet" bertumpuk. */}
          {isConnected && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#070b14] px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Trading wallet</span>
              <WalletMenu />
            </div>
          )}

          <div className="glass-panel p-5 rounded-3xl border-2 border-white/15 shadow-2xl bg-[#040814] space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <span className="font-mono text-xs font-bold text-white">Sovereign Curve Swap</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSlippage((v) => !v)}
                  className="p-1 rounded text-zinc-400 hover:text-white"
                  title="Slippage settings"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </button>
                <div className="flex rounded-lg bg-black/60 p-0.5 border border-white/10 font-mono text-[10px]">
                  {(["buy", "sell"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => swap.setMode(m)}
                      className={`px-3 py-1 rounded-md font-bold transition-all uppercase ${
                        swap.mode === m
                          ? m === "buy"
                            ? "bg-emerald-500 text-black"
                            : "bg-red-500 text-white"
                          : "text-zinc-400"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {showSlippage && (
              <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between font-mono text-[10px]">
                <span className="text-zinc-400">Max slippage</span>
                <div className="flex gap-1">
                  {SLIPPAGE_OPTIONS.map((bps) => (
                    <button
                      key={bps}
                      onClick={() => swap.setSlippageBps(bps)}
                      className={`px-2 py-0.5 rounded font-bold border ${
                        swap.slippageBps === bps
                          ? "bg-cyan-950 text-cyan-300 border-cyan-500/40"
                          : "bg-white/5 text-zinc-400 border-transparent"
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
              <div className="p-3 rounded-2xl bg-black/50 border border-white/10 space-y-1">
                <div className="flex justify-between text-[10px] text-zinc-400">
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
                        className="px-1.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-[9px] font-bold"
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
                    className="w-2/3 bg-transparent text-xl font-black text-white focus:outline-none"
                    placeholder="0.0"
                  />
                  {/* The pool only accepts the chain's native asset, so this is fixed
                      rather than a dropdown of assets it cannot route. */}
                  <span className="bg-[#0b0f19] border border-white/20 text-cyan-300 font-bold px-2.5 py-1 rounded-lg text-xs">
                    {swap.mode === "buy" ? chain.nativeSymbol : project.symbol}
                  </span>
                </div>
                <span className="text-[10px] text-zinc-500 block">≈ {formatUsd(inputUsd)}</span>
              </div>

              <div className="flex justify-center -my-1">
                <button
                  type="button"
                  onClick={() => swap.setMode(swap.mode === "buy" ? "sell" : "buy")}
                  className="p-1.5 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-white border border-purple-400/40"
                  title="Flip direction"
                >
                  <ArrowDownUp className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* You receive */}
              <div className="p-3 rounded-2xl bg-black/50 border border-white/10 space-y-1">
                <div className="flex justify-between text-[10px] text-zinc-400">
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
                  <div className="text-xl font-black text-cyan-300 truncate w-2/3">
                    {swap.outputAmount > 0 ? formatTokenAmount(swap.outputAmount) : "0"}
                  </div>
                  <span className="font-bold text-pink-300 bg-pink-950/60 px-2.5 py-1 rounded-lg text-xs">
                    {swap.mode === "buy" ? `$${project.symbol}` : chain.nativeSymbol}
                  </span>
                </div>
                {swap.quote && swap.quote.amountOut > 0n && (
                  <div className="pt-1 space-y-0.5 text-[10px] text-zinc-500">
                    <div className="flex justify-between">
                      <span>
                        Minimum received ({(swap.slippageBps / 100).toFixed(swap.slippageBps % 100 === 0 ? 0 : 1)}%
                        slippage)
                      </span>
                      <span className="text-zinc-300">
                        {formatTokenAmount(
                          swap.mode === "buy"
                            ? Number(ethers.formatUnits(swap.minReceived, swap.tokenDecimals))
                            : Number(ethers.formatEther(swap.minReceived))
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Price impact</span>
                      <span className={swap.quote.priceImpactBps > 500 ? "text-amber-400" : "text-zinc-300"}>
                        {(swap.quote.priceImpactBps / 100).toFixed(2)}%
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Three fee lines, because the fee genuinely splits three ways now.
                  Showing only depth and buyback would hide where the creator's
                  revenue comes from. */}
              <div className="p-2.5 rounded-xl bg-purple-950/30 border border-purple-500/20 text-[10px] space-y-1 text-slate-300">
                <div className="flex justify-between">
                  <span>Curve depth ({(project.lpFeeBps / 100).toFixed(2)}%) — stays in curve</span>
                  <span>{formatUsd(feeUsd.lp)}</span>
                </div>
                {swap.pool?.creatorFeeBps ? (
                  <div className="flex justify-between text-emerald-300">
                    <span>↳ Creator ({(Number(swap.pool.creatorFeeBps) / 100).toFixed(2)}%)</span>
                    <span>{formatUsd(feeUsd.creator)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-pink-300 font-bold">
                  <span>↳ Agent buyback ({(project.treasuryBuybackBps / 100).toFixed(2)}%)</span>
                  <span>{formatUsd(feeUsd.buyback)}</span>
                </div>
              </div>
            </div>

            {swap.errorLine && (
              <div className="p-2.5 rounded-xl bg-red-950/50 border border-red-500/40 text-[10px] font-mono text-red-200 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                <span>{swap.errorLine}</span>
              </div>
            )}

            {swap.txHash && !swap.errorLine && (
              <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-[10px] font-mono text-emerald-200 flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <div>{swap.statusLine}</div>
                  <a
                    href={explorerTxUrl(chain, swap.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-bold text-cyan-300 inline-flex items-center gap-1"
                  >
                    {swap.txHash.slice(0, 10)}…{swap.txHash.slice(-8)} <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>
            )}

            <button
              onClick={() => (isConnected ? swap.execute(address) : connectWallet())}
              disabled={isConnected ? swap.busy || !swap.tradable || swap.parsedAmount <= 0n : isConnecting}
              className={`w-full py-3.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed ${
                swap.mode === "buy"
                  ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-black"
                  : "bg-gradient-to-r from-red-600 to-pink-600 text-white"
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
              <p className="text-[9px] font-mono text-zinc-500 leading-relaxed">
                Selling moves ERC-20 tokens via <code className="text-cyan-400">approve</code> +{" "}
                <code className="text-cyan-400">transferFrom</code>. No native {chain.nativeSymbol} leaves your wallet
                beyond gas.
              </p>
            )}
          </div>

          {/* Agent chat */}
          <div className="glass-panel p-4 rounded-3xl border-2 border-white/15 h-[340px] shadow-2xl bg-[#050813] flex flex-col justify-between overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2 shrink-0">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-purple-400" />
                <span className="font-mono text-xs font-bold text-white">Chat with ${project.symbol} agent</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/30 font-bold">
                0G TEE
              </span>
            </div>

            <div ref={chatScrollRef} className="flex-1 overflow-y-auto space-y-2 p-1 font-sans text-xs">
              {chatMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-xl text-xs leading-relaxed ${
                    m.role === "user"
                      ? "bg-purple-900/30 border border-purple-500/30 text-white ml-4"
                      : "bg-[#03060d] border border-white/10 text-slate-200 mr-2"
                  }`}
                >
                  <span className="text-[9px] font-mono font-bold block mb-1 uppercase text-zinc-500">
                    {m.role === "user" ? "You" : `${project.name} (0G TEE)`}
                  </span>
                  <FormattedMarkdown text={m.content} />
                </div>
              ))}
              {chatLoading && (
                <div className="p-2 rounded-xl bg-black/40 text-cyan-300 font-mono text-[11px] flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Reasoning on 0G…
                </div>
              )}
            </div>

            <form onSubmit={sendChat} className="pt-2 border-t border-white/10 flex gap-1.5 shrink-0">
              <input
                type="text"
                placeholder={`Ask ${project.symbol} agent…`}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={chatLoading}
                className="flex-1 rounded-xl px-3 py-2 text-xs bg-black/60 border border-white/10 focus:border-purple-400 focus:outline-none text-white"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="p-2 rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 text-white disabled:opacity-50"
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

function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone: "white" | "cyan" | "pink";
  /** Angka mentah tanpa notasi ringkas, supaya notasi subscript bisa dibaca. */
  title?: string;
}) {
  const color = tone === "cyan" ? "text-cyan-300" : tone === "pink" ? "text-pink-400" : "text-white";
  return (
    <div className="p-3 rounded-2xl bg-[#040814] border border-white/10" title={title}>
      <span className="text-[10px] text-zinc-400 block">{label}</span>
      <span className={`text-sm font-black ${color}`}>{value}</span>
    </div>
  );
}
