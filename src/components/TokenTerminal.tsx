"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import {
  ShieldCheck, RefreshCw, ExternalLink, Bot, Send, Copy, Check,
  CloudLightning, Cpu, AlertTriangle, Lock, Settings2, CheckCircle2, Network,
  Globe, Github, BookOpen,
} from "lucide-react";

import { useWallet } from "@/context/WalletContext";
import { FeeLines, SlippageRow, TradeAmounts } from "@/components/swap-parts";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { FormattedMarkdown } from "@/components/FormattedMarkdown";
import RealtimeCandleChart from "@/components/RealtimeCandleChart";
import LiveOrderBook from "@/components/LiveOrderBook";
import LiveTradeFeed from "@/components/LiveTradeFeed";
import MarketStatsStrip from "@/components/MarketStatsStrip";
import MyPositionPanel from "@/components/MyPositionPanel";
import HoldersPanel from "@/components/HoldersPanel";
import WatchStar from "@/components/WatchStar";
import ChainChip from "@/components/ui/ChainChip";
import MarketOwnerActions from "@/components/MarketOwnerActions";
import AgentIdentityBadge from "@/components/AgentIdentityBadge";
import MarketStakePanel from "@/components/MarketStakePanel";
import CleanLaunchPanel from "@/components/CleanLaunchPanel";
import { STAKE_ANCHOR } from "@/lib/launch-kit";
import { stakeForMarket } from "@/config/market-stakes";
import { refreshMarketTelemetry, useMarketTelemetry } from "@/lib/use-market-telemetry";
import Link from "next/link";
import { explorerAddressUrl, explorerTxUrl, resolveChainOrDefault } from "@/lib/chains";
import { claimCreatorFees, describeTxError } from "@/lib/dex";
import { STABLE_PRICES, assetPriceUsd, formatSmallNumber, formatTokenAmount, formatUsd, plainDecimal, type AssetPrices } from "@/lib/pricing";
import { useSovereignSwap } from "@/lib/use-sovereign-swap";
import { streamChat, type ChatReasoningProgress } from "@/lib/chat-stream";
import { marketChatModel } from "@/lib/agent-model";

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
  /** Detik epoch transaksi peluncuran; awal rentang "All" di chart. */
  deployedAt: number;
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
  /** Pitch satu baris milik creator, atau null kalau tidak diisi. Teks biasa. */
  description: string | null;
  /** Tautan publik yang dipasang creator. `x` adalah handle, bukan URL. */
  links: { website: string | null; github: string | null; x: string | null; docs: string | null };
  /** Alamat yang meluncurkan pasar ini. Menentukan apakah tombol sunting ditawarkan. */
  creator: string;
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

/* SLIPPAGE_OPTIONS pindah ke swap-parts.tsx bersama baris slippage yang memakainya.
   Dua salinan angka yang sama, di dua halaman yang menawarkan pilihan yang sama,
   hanya menunggu untuk berbeda. */

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

  // Feed, strip statistik, dan filter membaca satu pengambilan yang sama.
  const telemetry = useMarketTelemetry(project.symbol, project.chainId);
  useEffect(() => {
    // Perdagangan pengguna baru terkonfirmasi: ambil ulang sekarang, jangan tunggu polling.
    if (swap.txHash) void refreshMarketTelemetry(project.symbol, project.chainId);
  }, [swap.txHash, project.symbol, project.chainId]);

  const [prices, setPrices] = useState<AssetPrices>(STABLE_PRICES);
  const [showSlippage, setShowSlippage] = useState(false);
  const [copied, setCopied] = useState(false);
  const [claimingFees, setClaimingFees] = useState(false);
  // Tab terminal. `accountTab` null = pilihan otomatis: posisi bila dompet tersambung, bukti launch bila tidak.
  const [mobileTab, setMobileTab] = useState<"trade" | "market" | "you">("trade");
  const [activityTab, setActivityTab] = useState<"book" | "holders" | "agent">("book");
  const [accountTab, setAccountTab] = useState<"position" | "stake" | "proof" | null>(null);
  const accountTabShown = accountTab ?? (isConnected ? "position" : "proof");
  // Tautan masuk: `?proof=1` (Share proof) membuka bukti launch, `#stake` (launch kit) membuka stake.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("proof") === "1") {
      setAccountTab("proof");
      setMobileTab("you");
    } else if (window.location.hash === `#${STAKE_ANCHOR}`) {
      setAccountTab("stake");
      setMobileTab("you");
      setTimeout(() => document.getElementById(STAKE_ANCHOR)?.scrollIntoView({ block: "start" }), 300);
    }
  }, []);
  const [claimLine, setClaimLine] = useState<string | null>(null);
  // State terpisah dari klaim creator. Keduanya bisa tampil bersamaan bagi creator
  // di pasar 0.11.0; satu state bersama akan membuat dua tombol berputar sekaligus
  // dan menaruh pesan hasil di panel yang salah.


  const onCorrectChain = isOnChain(project.chainId);
  // Its own AdextoAgentStake where it has one, otherwise the chain's stake hub: every market stakes.
  const marketStake = stakeForMarket(project);
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
        if (!cancelled && data?.prices) setPrices({ ...STABLE_PRICES, ...data.prices });
      } catch {
        // fallback table already in place
      }
    };
    load();
    /**
     * 15 detik, bukan 30.
     *
     * Harga token dalam USD adalah harga native x kurs native/USD, jadi pasar tanpa fill
     * baru TETAP bergerak dalam USD selama 0G bergerak. Dengan jeda 30 detik gerakan itu
     * datang setengah lebih jarang daripada yang ada, sehingga pasar yang sepi terbaca
     * seperti pasar yang beku. Ini hanya kecepatan baca; tidak ada angka yang dikarang.
     */
    const timer = setInterval(load, 15000);
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
    if (!swap.quote) return { lp: 0, creator: 0, buyback: 0, protocol: 0 };
    const native = (v: bigint) => Number(ethers.formatEther(v));
    return {
      lp: native(swap.quote.lpFee) * nativeUsd,
      creator: native(swap.quote.creatorFee) * nativeUsd,
      buyback: native(swap.quote.treasuryFee) * nativeUsd,
      protocol: native(swap.quote.protocolFee) * nativeUsd,
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
  /** Progres fase berpikir model; lihat catatan di src/lib/chat-stream.ts. */
  const [thinking, setThinking] = useState<ChatReasoningProgress | null>(null);
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
    setThinking(null);

    try {
      // Pembaca aliran dipakai bersama dengan studio co-pilot; alasan formatnya SSE
      // ada di src/lib/chat-stream.ts.
      let started = false;
      await streamChat(
        {
          messages: next,
          // The model named on this page, not a fixed one; see src/lib/agent-model.ts.
          model: marketChatModel(project.agentModel).id,
          chain: chain.name,
          // Panel ini menawarkan "ask me about pool depth or swap telemetry", jadi
          // state pool NYATA harus ikut dikirim. Sebelumnya prompt hanya memuat
          // alamat dan fee, sehingga agent menjawab "once you provide reserves…" —
          // janji yang tidak pernah dipenuhi aplikasi.
          systemPrompt:
            `You are ${project.name} ($${project.symbol}), the agent bound to this token on ${chain.name} (chainId ${chain.chainId}). ` +
            `Mandate stated by the creator: ${project.agentPersona}. ` +
            // A mandate is the creator's words, and some promise bots that do not exist. The
            // agent answers from this panel only, so it must never claim to act beyond it.
            `You act only by answering in this chat: never claim to trade, make markets, rebalance, hedge or run anything on a schedule. ` +
            `Token ${project.tokenAddress}. ` +
            `Curve ${project.poolAddress ?? "not deployed"}. Fees ${(project.lpFeeBps / 100).toFixed(2)}% depth retained by the curve / ${(project.treasuryBuybackBps / 100).toFixed(2)}% buyback-and-burn share (spent when anyone calls executeBuyback)` +
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
        },
        {
          onReasoning: (progress) => setThinking(progress),
          onContent: (full) => {
            // Begitu jawaban masuk, indikator berpikir dilepas: menampilkan keduanya
            // sekaligus membuat cuplikan reasoning terbaca sebagai bagian jawaban.
            setThinking(null);
            /**
             * `started` dibalik DI LUAR updater, bukan di dalamnya.
             *
             * React memanggil updater dua kali pada StrictMode pengembangan, jadi
             * penanda yang diletakkan di dalam updater akan menambahkan gelembung
             * asisten dua kali. Di luar, ia hanya berubah sekali per aliran.
             */
            if (!started) {
              started = true;
              setChatMessages((prev) => [...prev, { role: "assistant", content: full }]);
            } else {
              setChatMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: full };
                return copy;
              });
            }
          },
        }
      );
    } catch (error: any) {
      /**
       * Pesan aslinya diteruskan.
       *
       * Sebelumnya SEMUA kegagalan berbunyi "router is unreachable", termasuk kasus
       * OG_ROUTER_API_KEY yang belum diset — yang menjawab 503 dengan penjelasan
       * jelas. Menyebutnya masalah jangkauan mengirim orang mencari gangguan
       * jaringan padahal jawabannya ada di env.
       */
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `The 0G Compute router could not answer: ${error?.message || "unknown error"}`,
        },
      ]);
    } finally {
      setThinking(null);
      setChatLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 px-3 py-6 sm:px-6">
      {/* Header */}
      <div className="glass-panel flex flex-col justify-between gap-4 rounded-card border border-line p-4 shadow-[var(--shadow-panel)] sm:p-5 lg:flex-row lg:items-center lg:gap-5">
        {/* Di bawah lg kepala ini grid dua kolom: logo + baris judul di atas, lalu baris meta, pitch dan
            tautan selebar kartu (pembungkus teksnya `contents`). Sebelumnya semua teks duduk di kolom 206 px
            di samping logo (320 px), jadi pil dan tautan pecah per kata dan kepalanya setinggi 518 px.
            Di lg ke atas susunannya tetap logo + kolom teks. */}
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 lg:flex lg:gap-4">
          <div className="flex h-[48px] w-[48px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-accent/30 bg-cream-2 p-1 lg:h-14 lg:w-14">
            <img src={project.image} alt={project.name} className="w-full h-full object-cover rounded-xl" />
          </div>

          <div className="contents lg:block lg:min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
              <h1 className="min-w-0 break-words font-display text-[20px] font-medium leading-tight tracking-tight text-ink sm:text-[28px]">
                {project.name}
              </h1>
              <span className="whitespace-nowrap rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-[12px]/snug font-semibold text-accent">
                ${project.symbol}
              </span>
              <WatchStar chainId={project.chainId} symbol={project.symbol} size="lg" />
              {project.verified ? (
                /* Di bawah 640 px hanya ikonnya, teksnya tetap dibaca pembaca layar (sama seperti baris
                   explorer): kolom judul di 320 px hanya 208 px dan slot lencana agent butuh 188 px. */
                <span
                  className="inline-flex h-[24px] items-center gap-1 whitespace-nowrap rounded-md border border-ok/30 bg-ok/10 px-1.5 text-[12px] font-semibold text-ok sm:px-2"
                  title="Contract verified on-chain"
                >
                  <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                  <span className="max-sm:sr-only">Contract verified on-chain</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md border border-warn/30 bg-warn/10 px-2 py-0.5 text-[12px] font-semibold text-warn">
                  <AlertTriangle className="w-3 h-3" /> Showcase entry — not factory-minted
                </span>
              )}
              {/* Lencana ERC-8004 dibaca dari kontrak token sesudah halaman tampil (dua panggilan RPC
                  berurutan, ±1 s). Dulu ia muncul di tengah baris meta dan menambah satu baris, jadi chart
                  dan seluruh isi di bawahnya turun 25–30 px: CLS 0,31 di 768 px dan 0,15 di 1280 px.
                  Sekarang ukurannya dipesan sejak lukisan pertama di ujung baris judul, sehingga lencana
                  mengisi tempat yang sudah ada. Untuk token tanpa agent, slot ini hanya ruang kosong di
                  ujung baris. Entri showcase (bukan dari factory) tidak pernah terikat, jadi tanpa slot.
                  Lebar 188 px sejak huruf lencana 12 px (U2.5): "ERC-8004 agent #10275" terukur 177,5 px di ponsel
                  dan 174 px di desktop, jadi slot 172 px lama melebar saat lencana tiba. 188 px muat id 6 digit. */}
              <span
                className={
                  project.verified ? "inline-flex min-h-[32px] min-w-[188px] items-center lg:min-h-[22px]" : "contents"
                }
              >
                <AgentIdentityBadge chain={chain} tokenAddress={project.tokenAddress} />
              </span>
            </div>

            {/* Baris meta. Di bawah lg satu baris yang bisa digeser, tidak membungkus, dengan target
                32 px; di lg ke atas membungkus seperti dulu. Nama chain lewat ChainChip (logo + nama pendek),
                bukan label panjang "Arbitrum One (42161)" yang dulu memakan satu baris sendiri di ponsel. */}
            <div className="col-span-2 -mx-4 flex min-w-0 items-center gap-1.5 overflow-x-auto px-4 text-[12px]/snug text-ink-soft [scrollbar-width:none] max-lg:[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] sm:-mx-5 sm:px-5 lg:mx-0 lg:mt-1 lg:flex-wrap lg:gap-x-3 lg:gap-y-1 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
              <ChainChip chain={chain} className="max-lg:h-[32px] max-lg:px-2.5" />
              {deployments.length > 1 && (
                <span className="inline-flex h-[32px] shrink-0 items-center whitespace-nowrap rounded-lg border border-accent/30 bg-accent-soft px-2.5 font-bold text-accent lg:h-auto lg:rounded lg:px-2 lg:py-0.5">
                  {deployments.length} chains
                </span>
              )}
              <button
                onClick={copyAddress}
                title="Copy the token address"
                className="inline-flex h-[32px] shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 hover:text-ink lg:h-auto lg:border-0 lg:bg-transparent lg:px-0"
              >
                {/* Mono dibuang dari WADAH baris meta ini, tetapi alamatnya sendiri
                    tetap mono — itu string mesin, dan justru bagian yang orang
                    bandingkan karakter demi karakter dengan explorer. */}
                <span className="font-mono">
                  {project.tokenAddress.slice(0, 6)}…{project.tokenAddress.slice(-4)}
                </span>
                {copied ? <Check className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3" />}
              </button>
              <a
                href={explorerAddressUrl(chain, project.tokenAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-[32px] shrink-0 items-center gap-1 whitespace-nowrap px-1.5 text-accent hover:underline lg:h-auto lg:px-0"
              >
                Explorer <ExternalLink className="w-3 h-3" />
              </a>
              {project.poolAddress && (
                <a
                  href={explorerAddressUrl(chain, project.poolAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-[32px] shrink-0 items-center gap-1 whitespace-nowrap px-1.5 text-accent hover:underline lg:h-auto lg:px-0"
                >
                  Pool <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <a
                href={`https://x402.adexto.xyz/v1/x402/${project.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-[32px] shrink-0 items-center gap-1 whitespace-nowrap px-1.5 font-bold text-accent hover:underline lg:h-auto lg:px-0"
              >
                x402 API <CloudLightning className="w-3 h-3" />
              </a>
            </div>

            {/* Pitch creator. Dirender sebagai TEKS, bukan markdown dan bukan HTML:
                ia berasal dari formulir peluncuran, jadi satu-satunya bentuk yang aman
                di halaman publik adalah teks biasa. */}
            {project.description && (
              <p className="col-span-2 max-w-2xl text-[13px] leading-relaxed text-ink-soft lg:mt-2">{project.description}</p>
            )}

            {/* Tautan milik proyek dan tombol share/sunting dalam SATU baris (dulu dua baris).
                `rel="noopener noreferrer nofollow ugc"` bukan hiasan: tujuannya ditulis
                orang lain, jadi halaman ini tidak meneruskan reputasi dan tidak memberi
                akses `window.opener` ke tab tujuan. Registry sudah menolak skema selain
                http(s), jadi href di sini tidak bisa menjadi `javascript:`. */}
            <div className="col-span-2 flex flex-wrap items-center gap-1.5 lg:mt-2.5">
              {([
                // Tanpa ikon: labelnya sudah memuat "@", dan ikon AtSign di sebelahnya
                // membuat chip terbaca "@ @handle".
                project.links.x ? { key: "x", label: `@${project.links.x}`, href: `https://x.com/${project.links.x}`, Icon: null } : null,
                project.links.website ? { key: "website", label: "Website", href: project.links.website, Icon: Globe } : null,
                project.links.github ? { key: "github", label: "GitHub", href: project.links.github, Icon: Github } : null,
                project.links.docs ? { key: "docs", label: "Docs", href: project.links.docs, Icon: BookOpen } : null,
              ].filter(Boolean) as Array<{ key: string; label: string; href: string; Icon: typeof Globe | null }>).map(
                ({ key, label, href, Icon }) => (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    className="inline-flex h-[36px] items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 text-[12px] font-medium text-ink-soft transition-colors hover:border-accent/40 hover:text-accent lg:h-[27px] lg:px-2.5"
                  >
                    {Icon ? <Icon className="h-3 w-3" /> : null}
                    {label}
                  </a>
                )
              )}
              {/* Bagikan untuk semua orang; sunting hanya untuk dompet yang meluncurkan. */}
              <MarketOwnerActions
                symbol={project.symbol}
                chainId={project.chainId}
                creator={project.creator}
                description={project.description}
                links={project.links}
                image={project.image}
              />
            </div>
          </div>
        </div>

        {/* Market cap didahulukan, harga per token dibelakangkan.
            Dengan supply 1 miliar, harga per token selalu mikroskopis
            (0.0₅15 dan seterusnya) — itu angka yang paling sulit dibaca sekaligus
            paling jarang dipakai orang untuk memutuskan. Market cap dan nilai USD
            adalah yang benar-benar dibandingkan orang, jadi itu yang di depan.
            Angka mentahnya tetap bisa dilihat lewat tooltip. */}
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[560px]">
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
            title={`${project.supply.toLocaleString("en-US")} ${project.symbol} minted on ${chain.name}. Each chain this ticker launched on has its own separate supply of this size — it is not one supply split across chains.`}
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

      {/* Ponsel: tiga tab, satu layar per tugas. Trade = chart + formulir swap; Market = buku, holder,
          chat agen; You = posisi, stake, bukti launch. Di desktop semua bagian tampil dan tab ini hilang. */}
      <div className="sticky top-16 z-30 -mx-1 bg-cream/90 px-1 py-1.5 backdrop-blur lg:hidden">
        <SegTabs
          label="Market sections"
          value={mobileTab}
          onChange={setMobileTab}
          items={[
            ["trade", "Trade"],
            ["market", "Market"],
            ["you", "You"],
          ]}
        />
      </div>

      {/* Statistik dan daftar chain: di ponsel bagian tab Market, supaya tab Trade langsung berisi chart dan swap. */}
      <div className={`${mobileTab === "market" ? "block" : "hidden lg:block"} space-y-3`}>
        {/* Statistik perdagangan, dari himpunan yang sama dengan feed di bawah. */}
        <MarketStatsStrip
          stats={telemetry.stats}
          loaded={telemetry.loaded}
          nativeSymbol={chain.nativeSymbol}
          nativeUsd={nativeUsd}
        />

        {/* Chain switcher. Selalu tampil, dan selalu menampilkan SEMUA chain yang
            didukung — bukan hanya chain tempat token ini ada. Dulu panel ini
            disembunyikan bila token hanya ada di satu chain, sehingga di terminal
            tidak ada cara berpindah chain dan tidak terlihat bahwa chain lain
            memang belum punya market untuk token ini. */}
        <div className="glass-panel rounded-2xl border border-line overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-cream-3/[0.03] px-3 py-2">
            <div className="flex items-center gap-2">
              <Network className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                ${project.symbol} markets
              </span>
              <span className="rounded-md border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[12px] font-semibold text-accent">
                {deployments.length} {deployments.length === 1 ? "chain" : "chains"}
              </span>
            </div>
            <span className="text-[12px] text-ink-faint">
              Independent pool and price per chain · no bridging
            </span>
          </div>

          {/* HANYA chain tempat pasar ini benar-benar ada.
              Versi sebelumnya menggambar keempat chain yang didukung dan menandai yang
              kosong "not launched" — niatnya memperlihatkan bahwa chain lain ada. Yang
              terjadi di layar: tiga dari empat kotak berisi kalimat tentang pasar yang
              TIDAK ADA, jadi panel yang seharusnya memudahkan perbandingan justru
              sebagian besar diisi ketiadaan.
              Chain yang belum dipakai tetap bisa ditemukan di /studio (tempat keputusan
              itu sebenarnya diambil) dan di /explorer, jadi tidak ada informasi yang
              hilang — ia hanya berhenti memakan tempat di halaman perdagangan. */}
          <div
            className={`grid gap-px bg-cream-3 ${
              deployments.length === 1 ? "grid-cols-1" : deployments.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"
            }`}
          >
            {deployments.map((d) => {
              const c = resolveChainOrDefault(d.chainId);

              return (
                <Link
                  key={c.chainId}
                  href={`/token/${project.slug}?chain=${c.chainId}`}
                  aria-current={d.isCurrent ? "true" : undefined}
                  className={`group bg-surface px-3 py-2.5 transition-colors ${
                    d.isCurrent ? "bg-accent-soft ring-1 ring-inset ring-accent/40" : "hover:bg-cream-3"
                  }`}
                >
                  {/* Membungkus utuh: di sel 123 px (320 px, dua kolom) "Robinhood" + "POOL LIVE" berhuruf 12 px
                      tidak muat satu baris, jadi status turun ke bawah nama chain alih-alih pecah dua baris. */}
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                    <span
                      className={`text-[12px]/snug font-semibold ${d.isCurrent ? "text-accent" : "text-ink"}`}
                    >
                      {c.key}
                    </span>
                    {d.isCurrent ? (
                      <span className="flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold uppercase tracking-wider text-accent">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> viewing
                      </span>
                    ) : d.tradable ? (
                      <span className="whitespace-nowrap text-[12px] uppercase tracking-wider text-ok">pool live</span>
                    ) : (
                      <span className="whitespace-nowrap text-[12px] uppercase tracking-wider text-warn">no pool</span>
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
                        className="mt-0.5 truncate text-[12px] text-ink-soft"
                        data-numeric
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
      </div>

      {/* Chain guard */}
      {isConnected && !onCorrectChain && (
        <div className="p-3 rounded-2xl bg-warn/10 border border-warn/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-[12px]/snug leading-relaxed text-warn">
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
            className="inline-flex h-[40px] shrink-0 items-center rounded-lg bg-warn px-3.5 text-[12px]/snug font-semibold text-white transition-colors hover:bg-warn/90 lg:h-auto lg:px-3 lg:py-1.5"
          >
            Switch to {chain.name}
          </button>
        </div>
      )}

      {/* Pool not tradable */}
      {swap.poolChecked && !swap.tradable && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-warn/30 bg-cream-3 p-3.5 text-[12px]/snug leading-relaxed text-warn">
          <Lock className="w-4 h-4 text-warn mt-0.5 shrink-0" />
          <span>{swap.poolStatusMessage}</span>
        </div>
      )}

      {/* Desktop: grid DUA BARIS, bukan dua kolom flex independen. Baris pertama memaksa chart dan
          kartu swap punya tepi atas/bawah yang sama; baris kedua memulai kedua kelompok tab di garis
          yang sama. Wrapper `contents` mempertahankan urutan ponsel Trade → Market → You. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="contents">
          <div className={`${mobileTab === "trade" ? "" : "hidden lg:block"} lg:col-span-8 lg:col-start-1 lg:row-start-1`}>
            {/**
             * `min-h` dan bukan `h`: kotak osilator (RSI/MACD) dirender di dalam komponen
             * chart hanya ketika salah satunya menyala. Dengan tinggi yang dipatok, kotak itu
             * akan meluber keluar kartu dan terpotong.
             */}
            <div className="glass-panel p-4 rounded-card border border-line min-h-[480px] shadow-[var(--shadow-panel)] bg-surface flex flex-col justify-between sm:min-h-[620px]">
              <RealtimeCandleChart
                symbol={project.symbol}
                chainId={project.chainId}
                fallbackPriceNative={project.priceNative}
                launchedAt={project.deployedAt}
                nativeSymbol={chain.nativeSymbol}
                nativeUsd={nativeUsd}
                poolLive={swap.tradable}
                // Dipakai toggle MCAP untuk mengubah sumbu menjadi harga x suplai.
                supply={project.supply}
                /**
                 * `swap.txHash` berubah tepat sekali per trade yang berhasil, dan
                 * `useSovereignSwap` menetapkannya SETELAH receipt diparse — jadi ini sinyal
                 * pasca-konfirmasi, bukan pasca-pengiriman. Chart memakainya untuk mengambil
                 * data ulang saat itu juga alih-alih menunggu polling 15 detiknya.
                 */
                refreshKey={swap.txHash}
                me={isConnected ? address : null}
                creator={project.creator}
              />
              <div className="mt-2 flex shrink-0 items-center justify-between rounded-xl border border-line bg-surface p-2.5 text-[12px] text-ink-soft">
                <span className="flex items-center gap-1.5 text-ink">
                  <Cpu className="w-3.5 h-3.5 text-accent" /> {marketChatModel(project.agentModel).label}
                </span>
                {/* "buyback & burn", not "auto-buyback": the share accrues on every swap, but the
                    burn runs only when someone calls executeBuyback. */}
                <span
                  className="text-accent font-bold"
                  title="This share of every swap accrues in the curve and is spent on a buy-and-burn when anyone calls executeBuyback."
                >
                  {(project.treasuryBuybackBps / 100).toFixed(2)}% buyback &amp; burn
                </span>
              </div>
            </div>

          </div>

          <div className={`${mobileTab === "market" ? "flex" : "hidden lg:flex"} flex-col gap-2 lg:col-span-8 lg:col-start-1 lg:row-start-2`}>
            <SegTabs
              label="Market activity"
              value={activityTab}
              onChange={setActivityTab}
              fit="content"
              items={[
                ["book", "Depth & trades"],
                ["holders", "Holders"],
                ["agent", `Ask $${project.symbol} agent`, "Ask agent"],
              ]}
            />
            {activityTab === "book" && (
              <>
              {/* Tinggi TETAP di desktop. Dulu kotak ini `flex-1` dan mengikuti tinggi kolom kanan, jadi ladder
                  ikut memanjang dan memendek setiap panel kanan muncul atau dibuka (terukur 604 px tanpa dompet,
                  864 px dengan dompet). Sekarang ladder menunjukkan level terdekat sebanyak yang muat. */}
              {/* Dua kolom mulai md, bukan sm (U2.5): di 640–767 px tiap kolom hanya ±259 px, terlalu sempit untuk
                  lima kolom feed berhuruf 12 px. Di sana order book dan feed bertumpuk selebar kartu. */}
              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:h-[440px]" data-testid="terminal-lower-left">
                <div className="glass-panel flex min-h-[260px] flex-col overflow-hidden rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-panel)] lg:h-full lg:min-h-0">
                  <LiveOrderBook
                    symbol={project.symbol}
                    chainId={project.chainId}
                    nativeSymbol={chain.nativeSymbol}
                    nativeUsd={nativeUsd}
                  />
                </div>
                {/* `max-sm:px-3`: 7 px lebih untuk tabel feed di ponsel (huruf 12 px, U2.5). */}
                <div className="glass-panel flex min-h-[260px] flex-col overflow-hidden rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-panel)] max-sm:px-3 lg:h-full lg:min-h-0">
                  <LiveTradeFeed
                    symbol={project.symbol}
                    chainId={project.chainId}
                    nativeUsd={nativeUsd}
                    me={isConnected ? address : null}
                    creator={project.creator}
                    supply={project.supply}
                  />
                </div>
              </div>
              </>
            )}
            {activityTab === "holders" && (
              <HoldersPanel symbol={project.symbol} chainId={project.chainId} me={isConnected ? address : null} />
            )}
            {activityTab === "agent" && (
              <>
                {/* Agent chat: tab ketiga kotak aktivitas, setinggi kotak buku supaya berganti tab tidak menggeser halaman. */}
                <div
                  className="glass-panel flex h-[440px] flex-col justify-between overflow-hidden rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-panel)]"
                  data-testid="terminal-chat"
                >
                  <div className="flex items-center justify-between border-b border-line pb-2 mb-2 shrink-0">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-accent" />
                      <span className="text-[13px]/snug font-semibold text-ink">Chat with ${project.symbol} agent</span>
                    </div>
                    <span className="rounded-md border border-ok/30 bg-ok/10 px-2 py-0.5 text-[12px] font-semibold text-ok">
                      0G TEE
                    </span>
                  </div>

                  {/* `basis-0` di desktop: isi percakapan TIDAK boleh ikut menentukan tinggi kolom —
                      kotaknya mengikuti kolom, dan pesannya bergulir di dalamnya. */}
                  <div
                    ref={chatScrollRef}
                    className="min-h-0 flex-1 space-y-2 overflow-y-auto p-1 font-sans text-[12px]/snug lg:grow lg:basis-0"
                  >
                    {chatMessages.map((m, idx) => (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl text-[12px]/snug leading-relaxed ${
                          m.role === "user"
                            ? "bg-accent-soft border border-accent/30 text-ink ml-4"
                            : "bg-surface border border-line text-ink mr-2"
                        }`}
                      >
                        <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                          {m.role === "user" ? "You" : `${project.name} (0G TEE)`}
                        </span>
                        <FormattedMarkdown text={m.content} />
                      </div>
                    ))}
                    {/* Indikator berpikir yang BERGERAK. Hitungan karakternya datang dari
                        kanal reasoning model lewat SSE, jadi angkanya naik selama model
                        bekerja alih-alih spinner yang diam puluhan detik. Cuplikannya pucat
                        dan miring, dan labelnya menyebut "reasoning" apa adanya. */}
                    {chatLoading && (
                      <div className="flex flex-col gap-1 rounded-xl bg-cream-2 p-2 text-[12px]">
                        <span className="flex items-center gap-1.5 text-accent">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Reasoning on 0G
                          {thinking && thinking.chars > 0 ? ` · ${thinking.chars} chars` : "…"}
                        </span>
                        {thinking?.preview && (
                          <span className="text-[12px] italic leading-snug text-ink-faint line-clamp-2">
                            {thinking.preview}
                          </span>
                        )}
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
                      aria-label={`Ask the $${project.symbol} agent`}
                      /* 16 px di bawah lg: Safari iOS memperbesar halaman saat kolom berhuruf < 16 px
                         disentuh. Tinggi 44 px di sana, ukuran lama di desktop. */
                      className="h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-cream-2 px-3 text-[16px] text-ink focus:border-accent/30 focus:outline-none lg:h-auto lg:py-2 lg:text-[12px]/snug"
                    />
                    <button
                      type="submit"
                      disabled={chatLoading || !chatInput.trim()}
                      aria-label="Send"
                      className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl bg-accent text-white disabled:opacity-50 lg:h-auto lg:w-auto lg:p-2"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="contents">
          <div className={`${mobileTab === "trade" ? "flex" : "hidden lg:flex"} flex-col lg:col-span-4 lg:col-start-9 lg:row-start-1`}>

            <div className="glass-panel flex h-full w-full flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-[var(--shadow-panel)]">
              {/* Penghasilan creator terintegrasi di atas swap: satu kartu dan satu tepi lurus,
                  bukan kotak hijau lain yang membuat kolom kanan tampak bertumpuk.
                  Hanya tampil bagi alamat creator yang terkunci di kurva, karena hanya
                  dia yang bisa menerimanya. Klaim memakai pola tarik, bukan dorong:
                  kalau fee didorong tiap swap, wallet creator berupa kontrak yang revert
                  akan membekukan seluruh perdagangan token ini. */}
              {isConnected &&
                swap.pool?.isCurve &&
                swap.pool.creator &&
                address &&
                swap.pool.creator.toLowerCase() === address.toLowerCase() && (
                  <div className="-mx-5 -mt-5 space-y-2 border-b border-ok/30 bg-ok/10 px-5 py-3" data-testid="creator-revenue-strip">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold uppercase tracking-wider text-ok/90">
                        Your creator revenue
                      </span>
                      <span className="text-[12px] text-ink-faint">
                        {(Number(swap.pool.creatorFeeBps) / 100).toFixed(2)}% of every swap
                      </span>
                    </div>
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        {/* Tooltip berisi angka mentah: penghasilan adalah angka yang
                            orang ingin baca tepat, bukan ditebak dari notasi ringkas. */}
                        <p
                          className="text-[16px] font-semibold text-ink" data-numeric
                          title={`${plainDecimal(Number(ethers.formatEther(swap.pool.creatorOwed)))} ${chain.nativeSymbol}`}
                        >
                          {formatSmallNumber(Number(ethers.formatEther(swap.pool.creatorOwed)))} {chain.nativeSymbol}
                          {creatorOwedUsd > 0 && (
                            <span className="text-ink-soft text-[12px]/snug font-normal"> · {formatUsd(creatorOwedUsd)}</span>
                          )}
                        </p>
                        <p className="text-[12px] text-ink-faint">unclaimed</p>
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
                        className="inline-flex h-[40px] items-center rounded-xl bg-ok px-4 text-[12px]/snug font-semibold text-white transition-colors hover:bg-ok/90 disabled:opacity-40 lg:h-[34px]"
                      >
                        {claimingFees ? "Claiming…" : "Claim"}
                      </button>
                    </div>
                    {claimLine && <p className="text-[12px] text-ok">{claimLine}</p>}
                  </div>
                )}

              <div className="flex items-center justify-between border-b border-line pb-2.5">
                <span className="text-[13px]/snug font-semibold text-ink">Sovereign Curve Swap</span>
                <div className="flex items-center gap-2">
                  {/* Area sentuh 36 px di ponsel (ikonnya tetap 14 px), 28 px di desktop. */}
                  <button
                    type="button"
                    onClick={() => setShowSlippage((v) => !v)}
                    aria-expanded={showSlippage}
                    aria-label="Slippage settings"
                    className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-lg text-ink-soft hover:text-ink lg:h-[28px] lg:w-[28px]"
                    title="Slippage settings"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex rounded-xl border border-line bg-cream-2 p-1 text-[12px]/snug">
                    {(["buy", "sell"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => swap.setMode(m)}
                        aria-pressed={swap.mode === m}
                        className={`inline-flex h-[34px] items-center rounded-lg px-4 font-semibold capitalize transition-colors lg:h-[28px] lg:px-3.5 ${
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
                </div>
              </div>

              {showSlippage && <SlippageRow value={swap.slippageBps} onChange={swap.setSlippageBps} />}

              {/* Panel jumlah, tombol tukar arah, rincian kuotasi, dan baris biaya
                  datang dari swap-parts.tsx — satu definisi yang dipakai halaman ini
                  dan /swap. Sebelumnya keduanya menulis panel yang sama dua kali, dan
                  selisihnya (input 20px di sini vs 24px di sana, saldo di dalam label
                  vs di baris bawah, lencana simbol berlatar putih vs cream) tidak
                  pernah diputuskan siapa pun — semuanya sisa dari menulis dua kali. */}
              <TradeAmounts
                swap={swap}
                tokenSymbol={project.symbol}
                tokenLogo={project.image || null}
                inputUsd={inputUsd}
                isConnected={isConnected}
              />

              <FeeLines
                lpFeeBps={project.lpFeeBps}
                treasuryBuybackBps={project.treasuryBuybackBps}
                creatorFeeBps={swap.pool?.creatorFeeBps ? Number(swap.pool.creatorFeeBps) : null}
                protocolFeeBps={swap.pool?.protocolFeeBps ? Number(swap.pool.protocolFeeBps) : null}
                feeUsd={feeUsd}
              />

              {swap.errorLine && (
                <div className="flex items-start gap-2.5 rounded-2xl border border-danger/30 bg-danger/10 p-3.5 text-[12px]/snug leading-relaxed text-danger">
                  <AlertTriangle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
                  <span>{swap.errorLine}</span>
                </div>
              )}

              {swap.txHash && !swap.errorLine && (
                <div className="flex items-start gap-2.5 rounded-2xl border border-ok/30 bg-ok/10 p-3.5 text-[12px]/snug leading-relaxed text-ok">
                  <CheckCircle2 className="w-3.5 h-3.5 text-ok mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <div>{swap.statusLine}</div>
                    <a
                      href={explorerTxUrl(chain, swap.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[32px] items-center gap-1 font-semibold text-accent underline lg:min-h-0"
                    >
                      <span className="font-mono">
                        {swap.txHash.slice(0, 10)}…{swap.txHash.slice(-8)}
                      </span>
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              )}

              <button
                onClick={() => (isConnected ? swap.execute(address) : connectWallet())}
                disabled={isConnected ? swap.busy || !swap.tradable || swap.parsedAmount <= 0n || Boolean(swap.limit) : isConnecting}
                /* Beli/jual adalah ARAH, jadi di sini hijau dan merah memang tepat.
                   Sebelumnya keduanya gradien dua warna yang berakhir di ungu, jadi
                   tombol beli dan tombol jual berbagi separuh warna yang sama — pada
                   satu-satunya kontrol di halaman yang salah tekannya mahal. Sekarang
                   satu warna pekat per arah, teks putih supaya kontrasnya lolos. */
                className={`mt-auto flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[16px] font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-cream-3 disabled:text-ink-soft ${
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
                ) : swap.limit ? (
                  // Sebelum ganti chain: tidak ada gunanya pindah jaringan untuk trade yang tidak terjangkau.
                  swap.limit.label
                ) : !onCorrectChain ? (
                  `Switch to ${chain.name} first`
                ) : swap.mode === "buy" ? (
                  `Buy $${project.symbol}`
                ) : (
                  `Approve & sell $${project.symbol}`
                )}
              </button>

              {swap.mode === "sell" && swap.tradable && (
                <p className="text-[12px] leading-relaxed text-ink-faint">
                  Selling moves ERC-20 tokens via <code className="text-accent">approve</code> +{" "}
                  <code className="text-accent">transferFrom</code>. No native {chain.nativeSymbol} leaves your wallet
                  beyond gas.
                </p>
              )}
            </div>

          </div>

          <div className={`${mobileTab === "you" ? "flex" : "hidden lg:flex"} flex-col gap-2 lg:col-span-4 lg:col-start-9 lg:row-start-2`}>
            <SegTabs
              label="Your account"
              value={accountTabShown}
              onChange={setAccountTab}
              fit="content"
              items={[
                ["position", "Position"],
                ["stake", "Stake"],
                ["proof", "Launch facts"],
              ]}
            />
            {accountTabShown === "position" && (
              <>
                {isConnected && address ? (
                  <MyPositionPanel
                    symbol={project.symbol}
                    chainId={project.chainId}
                    wallet={address}
                    refreshKey={swap.txHash}
                    collapsible={false}
                  />
                ) : (
                  <div className="glass-panel rounded-card border border-line p-4 text-center text-[12px]/snug text-ink-soft">
                    Connect a wallet to see your balance, entry price and PnL in ${project.symbol}.
                  </div>
                )}
              </>
            )}
            {/* TIDAK ADA panel fee protokol di sini, dan itu keputusan.

                Panel yang pernah ada di titik ini menampilkan `protocolOwed` beserta tombol
                untuk mengirimkannya ke treasury. Dua hal salah dengannya. Pertama, itu
                pekerjaan protokol, bukan pekerjaan trader — menaruhnya di terminal
                perdagangan meminta orang lain membereskan urusan kami. Kedua, dan lebih
                buruk, menekannya MERUGI: terukur di kurva $ADEXTO, 0,0000288 0G mengendap
                melawan 0,0003 0G gas, sepuluh kali lipat. Panelnya menulis "you pay the gas"
                tanpa menyebut bahwa gasnya jauh lebih besar dari yang dipindahkan.

                Fee-nya tetap terkumpul otomatis di setiap perdagangan — `protocolOwed +=
                protocolFee` di `buy` dan `sell`, dan `_assertSolvent()` memasukkannya sebagai
                suku, jadi uangnya terbukti dipegang kurva dan tidak ada jalan keluar selain
                `claimProtocolFees`. Yang tidak otomatis hanya pemindahannya keluar. */}

            {accountTabShown === "stake" &&
              (marketStake ? (
                <div id={STAKE_ANCHOR} className="scroll-mt-24">
                  <MarketStakePanel chain={chain} stake={marketStake} symbol={project.symbol} />
                </div>
              ) : (
                <div className="glass-panel rounded-card border border-line p-4 text-center text-[12px]/snug text-ink-soft">
                  This market has no stake contract.
                </div>
              ))}
            {accountTabShown === "proof" && (
              <CleanLaunchPanel
                chainId={project.chainId}
                chainName={chain.name}
                token={project.tokenAddress}
                slug={project.slug}
                symbol={project.symbol}
                collapsible={false}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tab bersegmen untuk terminal: satu baris tombol, `aria-pressed` pada yang aktif. Tinggi dalam px (rem situs
 * 14 px): 44 px di ponsel, karena tab utama Trade/Market/You adalah kontrol yang paling sering diketuk di sana;
 * 34 px di desktop.
 *
 * `fit="content"`: di bawah lg lebar tiap tombol mengikuti labelnya. Dengan lebar sama, "Depth & trades" dan
 * "Ask $PARCEL agent" terpotong di 320–393 px sementara "Holders" menyisakan ruang. Label ketiga di `items`
 * (opsional) adalah label pendek untuk < 640 px; label lengkapnya tampil mulai 640 px. Jangan dipakai untuk
 * label yang dicari skrip (Trade/Market/You, Position/Stake/Launch facts): isi teks tombolnya jadi dua label.
 */
function SegTabs<T extends string>({
  label,
  value,
  onChange,
  items,
  fit = "equal",
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  items: Array<[T, string, string?]>;
  fit?: "equal" | "content";
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-2xl border border-line bg-surface p-1">
      {items.map(([v, text, short]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          // `block truncate`, dan labelnya teks LANGSUNG di tombol, bukan di <span>: skrip memakai
          // `button:text-is("Market")` / `button:text-is("Stake")`, dan Playwright mencocokkan elemen
          // TERKECIL yang memuat teks itu, jadi span di dalamnya membuat tombolnya tidak cocok lagi.
          // Tombol berdisplay block tetap memusatkan isinya secara vertikal.
          className={`block h-[44px] min-w-0 truncate rounded-xl text-center text-[13px] font-semibold transition-colors lg:h-[34px] lg:flex-1 lg:px-3 lg:text-[12px]/snug ${
            fit === "content" ? "flex-auto px-2.5" : "flex-1 px-3"
          } ${value === v ? "bg-accent-soft text-accent" : "text-ink-soft hover:text-ink"}`}
        >
          {short ? (
            <>
              <span className="block truncate sm:hidden">{short}</span>
              <span className="hidden truncate sm:block">{text}</span>
            </>
          ) : (
            text
          )}
        </button>
      ))}
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
    <div className="rounded-panel border border-line bg-surface px-3 py-2.5 text-left" title={title}>
      {/* Label seperti `ui/Stat` (12 px, huruf biasa). Huruf kapital berjarak dari masa 10 px membuat "SUPPLY (PARCEL) ·
          MONAD" tiga baris di kartu 113–121 px begitu ukurannya 12 px (ERROR shortwrap, m320 dan d1024). */}
      <span className="block text-[12px] leading-snug text-ink-faint">{label}</span>
      <span className={`mt-0.5 block font-display text-[16px] font-medium tracking-tight ${color}`} data-numeric>
        {value}
      </span>
    </div>
  );
}
