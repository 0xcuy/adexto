"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import VerifiedDeploymentCard from "@/components/VerifiedDeploymentCard";
import { CHAIN_LIST, explorerAddressUrl, resolveChainOrDefault } from "@/lib/chains";
import { FALLBACK_PRICES, assetPriceUsd, formatSmallNumber, formatTokenAmount, formatUsd, type AssetPrices } from "@/lib/pricing";
import {
  Search, ExternalLink, ShieldCheck, ArrowUpRight, CheckCircle2,
  CloudLightning, Sparkles, AlertTriangle, Lock, RefreshCw,
} from "lucide-react";
import { EMPTY_BODY, EMPTY_TITLE } from "@/lib/launch-state";

/**
 * Live market index.
 *
 * Fixes: prices are numeric with an explicit native unit and converted through the
 * live feed instead of being string-stripped and shown as USD; the Swap button
 * carries the market (`/swap?token=SYMBOL`) instead of dropping the user on the
 * default market; explorer links are built from each project's chainId; and every
 * card states plainly whether the contract is verified and whether a tradable pool
 * exists.
 */

interface Project {
  id: string;
  /** `chainId:SYMBOL` — a ticker can have an independent market on several chains. */
  marketKey: string;
  deployedChainCount: number;
  alsoOn: Array<{ chainId: number; chainKey: string }>;
  name: string;
  symbol: string;
  slug: string;
  chain: string;
  chainId: number;
  chainKey: string;
  nativeSymbol: string;
  tokenAddress: string;
  poolAddress: string | null;
  priceNative: number;
  supply: number;
  lpFeeBps: number;
  treasuryBuybackBps: number;
  agentStatus: string;
  agentModel: string;
  edgeProvider: string;
  category: string;
  image: string;
  /**
   * Root penyimpanan 0G DA dari metadata launch: sebuah hash konten, BUKAN
   * laporan attestation hardware. Nama lamanya `teeAttestationRoot` itulah yang
   * membuat situs ini pernah mengklaim attestation yang tidak pernah diperiksa
   * siapa pun; kontraknya sudah dinamai ulang `metadataRoot`.
   */
  metadataRoot: string | null;
  verified: boolean;
  curated: boolean;
  poolLive: boolean;
  tradable: boolean;
}

export default function ExplorerPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [prices, setPrices] = useState<AssetPrices>(FALLBACK_PRICES);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [chainFilter, setChainFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/graphql", { method: "POST" });
        const json = await res.json();
        if (cancelled) return;
        setProjects(
          (json?.data?.projects ?? []).map((p: any) => ({
            id: p.id,
            marketKey: String(p.marketKey ?? `${p.chainId}:${String(p.symbol).toUpperCase()}`),
            deployedChainCount: Number(p.deployedChainCount) || 1,
            alsoOn: Array.isArray(p.alsoOn)
              ? p.alsoOn.map((s: any) => ({ chainId: Number(s.chainId), chainKey: String(s.chainKey) }))
              : [],
            name: p.name,
            symbol: String(p.symbol).toUpperCase(),
            slug: String(p.slug ?? p.symbol).toLowerCase(),
            chain: p.chain,
            chainId: Number(p.chainId),
            chainKey: String(p.chainKey ?? ""),
            nativeSymbol: p.nativeSymbol,
            tokenAddress: p.tokenAddress,
            poolAddress: p.poolAddress ?? null,
            priceNative: Number(p.priceNative) || 0,
            supply: Number(p.supply) || 0,
            lpFeeBps: Number(p.lpFeeBps) || 20,
            treasuryBuybackBps: Number(p.treasuryBuybackBps) || 10,
            agentStatus: p.agentStatus,
            agentModel: p.agentModel,
            edgeProvider: p.edgeProvider,
            category: p.category ?? "defi",
            image: p.image ?? "/logo.svg",
            // `metadataRoot` lebih dulu; /api/graphql masih mengembalikan alias
            // lamanya untuk klien yang belum diperbarui.
            metadataRoot: p.metadataRoot ?? p.teeAttestationRoot ?? null,
            verified: Boolean(p.verified),
            curated: Boolean(p.curated),
            poolLive: Boolean(p.poolLive),
            tradable: Boolean(p.tradable),
          }))
        );
      } catch (error) {
        console.warn("[adexto] explorer fetch failed:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
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

  const filtered = useMemo(
    () =>
      projects.filter((p) => {
        const matchesCategory = category === "all" || p.category.toLowerCase() === category;
        const matchesChain = chainFilter === "all" || p.chainId === Number(chainFilter);
        const needle = search.trim().toLowerCase();
        const matchesSearch =
          !needle ||
          p.name.toLowerCase().includes(needle) ||
          p.symbol.toLowerCase().includes(needle) ||
          p.tokenAddress.toLowerCase().includes(needle);
        return matchesCategory && matchesChain && matchesSearch;
      }),
    [projects, category, chainFilter, search]
  );

  const tradableCount = projects.filter((p) => p.tradable).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-line pb-6 mb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-soft text-accent border border-accent/30 text-xs font-mono font-bold mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-ok" />
            <span>ADEXTO MARKET INDEX</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink">Sovereign Projects</h1>
          <p className="text-xs sm:text-sm text-ink mt-1 font-medium">
            {loading
              ? "Loading registry…"
              : `${projects.length} registered · ${tradableCount} with an executable bonding curve`}
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 w-full md:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-ink-soft absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search ticker, name or address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-white border border-line rounded-lg pl-9 pr-4 py-2 text-ink font-mono text-xs focus:border-accent/30 focus:outline-none w-full font-medium"
            />
          </div>
          <Link
            href="/studio"
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-accent hover:bg-accent-strong text-white shadow-md shadow-accent/10 flex items-center gap-1.5 shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" /> Launch
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 font-mono text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          {["all", "defi", "trading", "security"].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                category === cat
                  ? "bg-accent-soft text-accent border border-accent/30"
                  : "bg-cream-3/[0.04] text-ink-soft border border-line hover:text-ink"
              }`}
            >
              {cat.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setChainFilter("all")}
            className={`px-3 py-1 rounded-lg font-bold transition-all ${
              chainFilter === "all"
                ? "bg-accent-soft text-accent border border-accent/30"
                : "bg-cream-3/[0.02] text-ink-soft border border-line hover:text-ink"
            }`}
          >
            ALL
          </button>
          {CHAIN_LIST.map((c) => (
            <button
              key={c.chainId}
              onClick={() => setChainFilter(String(c.chainId))}
              className={`px-3 py-1 rounded-lg font-bold transition-all ${
                chainFilter === String(c.chainId)
                  ? "bg-accent-soft text-accent border border-accent/30"
                  : "bg-cream-3/[0.02] text-ink-soft border border-line hover:text-ink"
              }`}
            >
              {c.key.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="py-20 flex items-center justify-center gap-2 text-ink-soft font-mono text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Reading registry…
        </div>
      ) : projects.length === 0 ? (
        /* An empty registry and an over-narrow filter are different situations and
           used to print the same sentence, which told a first-time visitor that
           their filter was at fault when in fact nothing has launched yet. */
        <div className="mx-auto max-w-md py-20 text-center">
          <Lock className="mx-auto mb-3 h-5 w-5 text-ink-faint" />
          <p className="text-sm font-semibold text-ink">{EMPTY_TITLE}</p>
          {/* The reason changed and the text had to change with it. This used to
              read "the curve factory has not been broadcast", which was true and
              then quietly became false the moment it was. Launching is live now;
              the index is empty simply because nobody has used it yet. */}
          <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{EMPTY_BODY}</p>
          <Link
            href="/docs"
            className="mt-4 inline-block text-xs font-semibold text-accent underline-offset-4 hover:underline"
          >
            See which contracts are deployed
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-sm text-ink-soft">No markets match this filter.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map((p) => {
            const chain = resolveChainOrDefault(p.chainId);
            const nativeUsd = assetPriceUsd(chain.nativeSymbol, prices);
            const priceUsd = p.priceNative * nativeUsd;
            const mcapUsd = p.supply * priceUsd;

            return (
              <div
                key={p.marketKey}
                className="glass-panel p-6 rounded-2xl border border-line space-y-4 relative overflow-hidden"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-cream-2 border border-accent/30 p-0.5 flex items-center justify-center shrink-0">
                      <img src={p.image} alt={p.name} className="w-full h-full object-cover rounded-[10px]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-ink text-base truncate">{p.name}</h3>
                        <span className="text-xs font-mono text-ink-soft font-bold">${p.symbol}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-ink-soft font-mono mt-0.5 flex-wrap">
                        <span className="text-accent font-bold">{p.chain}</span>
                        {p.deployedChainCount > 1 && (
                          <span
                            className="text-accent font-bold"
                            title={`Ticker ini juga punya market di ${p.alsoOn.map((s) => s.chainKey).join(", ")}`}
                          >
                            +{p.deployedChainCount - 1} chain
                          </span>
                        )}
                        <span>•</span>
                        {p.verified ? (
                          <span className="text-ok flex items-center gap-1 font-semibold">
                            <ShieldCheck className="w-3 h-3" /> verified
                          </span>
                        ) : (
                          <span className="text-warn flex items-center gap-1 font-semibold">
                            <AlertTriangle className="w-3 h-3" /> showcase
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-mono shrink-0">
                    <div className="text-base font-semibold text-ink">{priceUsd > 0 ? formatUsd(priceUsd) : "—"}</div>
                    <span className="text-[10px] text-ink-soft">
                      {p.priceNative > 0
                        ? `${formatSmallNumber(p.priceNative)} ${chain.nativeSymbol}`
                        : "no price"}
                    </span>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-4 gap-2 p-3 rounded-xl bg-white border border-line text-center font-mono">
                  <Metric label="Market cap" value={mcapUsd > 0 ? formatUsd(mcapUsd, { compact: true }) : "—"} />
                  <Metric label="Supply" value={formatTokenAmount(p.supply)} />
                  <Metric
                    label="Fee split"
                    value={`${(p.lpFeeBps / 100).toFixed(2)}/${(p.treasuryBuybackBps / 100).toFixed(2)}%`}
                    tone="accent"
                  />
                  <Metric
                    label="Curve"
                    value={p.tradable ? "live" : "none"}
                    tone={p.tradable ? "ok" : "warn"}
                  />
                </div>

                {/* Agent info */}
                <div className="p-3 rounded-xl bg-white border border-line space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between items-center text-ink-soft gap-2">
                    <span className="shrink-0">Compute:</span>
                    <span className="text-accent font-bold truncate">{p.agentModel}</span>
                  </div>
                  <div className="flex justify-between items-center text-ink-soft gap-2">
                    <span className="shrink-0">Edge:</span>
                    {/* Nama penyedia, bukan keadaan. Amber dipesan untuk peringatan. */}
                    <span className="text-accent font-bold truncate">{p.edgeProvider}</span>
                  </div>
                  {p.metadataRoot && (
                    <div className="flex justify-between items-center text-ink-soft pt-1 border-t border-line gap-2">
                      <span className="shrink-0">0G DA root:</span>
                      <span className="text-ok font-bold truncate">
                        {p.metadataRoot.slice(0, 10)}…{p.metadataRoot.slice(-6)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-line text-xs font-mono gap-2 flex-wrap">
                  <a
                    href={explorerAddressUrl(chain, p.tokenAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:text-accent flex items-center gap-1 font-bold hover:underline"
                  >
                    <span>
                      {p.tokenAddress.slice(0, 6)}…{p.tokenAddress.slice(-4)}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <div className="flex items-center gap-3 font-bold">
                    <Link
                      href={`/token/${p.slug}?chain=${p.chainId}`}
                      className="text-accent hover:text-ink flex items-center gap-1 hover:underline"
                    >
                      Terminal <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                    {p.tradable ? (
                      <Link
                        href={`/swap?token=${p.symbol}&chain=${p.chainId}`}
                        className="text-accent hover:text-ink flex items-center gap-1 hover:underline"
                      >
                        Swap <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    ) : (
                      <span
                        className="text-ink-faint flex items-center gap-1 cursor-not-allowed"
                        title="No executable curve for this market yet"
                      >
                        Swap <Lock className="w-3 h-3" />
                      </span>
                    )}
                    <a
                      href="https://adexto-x402-edge.cucuvirtual.workers.dev"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:text-ink flex items-center gap-1 hover:underline"
                    >
                      x402 <CloudLightning className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="-mx-4 sm:-mx-6 lg:-mx-8 mt-12">
        <VerifiedDeploymentCard />
      </div>
    </div>
  );
}

/**
 * `tone` diberi nama menurut ARTI, bukan menurut warna.
 *
 * Dulu: "cyan" | "emerald" | "amber" | "white" — nama dari tema gelap berenam
 * aksen. Nama seperti itu memaksa pemanggil memutuskan warna di tempat, dan
 * begitu paletnya bergeser (cyan → ungu, amber → cokelat) namanya berbohong.
 * "ok" dan "warn" juga menegaskan bahwa keduanya menandakan KEADAAN, sehingga
 * tidak dipakai sebagai hiasan.
 */
function Metric({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "accent" | "ok" | "warn";
}) {
  const color =
    tone === "accent" ? "text-accent" : tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div>
      <span className="text-[10px] text-ink-soft block font-semibold">{label}</span>
      <span className={`text-xs font-bold truncate block ${color}`}>{value}</span>
    </div>
  );
}
