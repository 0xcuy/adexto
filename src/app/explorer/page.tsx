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
  teeAttestationRoot: string | null;
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
            teeAttestationRoot: p.teeAttestationRoot ?? null,
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-white/20 pb-6 mb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>ADEXTO MARKET INDEX</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white">Sovereign Projects</h1>
          <p className="text-xs sm:text-sm text-slate-200 mt-1 font-medium">
            {loading
              ? "Loading registry…"
              : `${projects.length} registered · ${tradableCount} with an executable bonding curve`}
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 w-full md:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search ticker, name or address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-[#0b0d14] border border-white/20 rounded-lg pl-9 pr-4 py-2 text-white font-mono text-xs focus:border-cyan-400 focus:outline-none w-full font-medium"
            />
          </div>
          <Link
            href="/studio"
            className="px-4 py-2 rounded-lg text-xs font-black bg-gradient-to-r from-cyan-500 to-purple-600 text-white shadow-md shadow-purple-600/30 flex items-center gap-1.5 shrink-0"
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
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "bg-white/[0.04] text-zinc-300 border border-white/10 hover:text-white"
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
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                : "bg-white/[0.02] text-zinc-400 border border-white/5 hover:text-white"
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
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                  : "bg-white/[0.02] text-zinc-400 border border-white/5 hover:text-white"
              }`}
            >
              {c.key.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="py-20 flex items-center justify-center gap-2 text-zinc-400 font-mono text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Reading registry…
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-zinc-400 font-mono text-sm">No markets match this filter.</div>
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
                className="glass-panel p-6 rounded-2xl border border-white/10 space-y-4 relative overflow-hidden"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-black border border-cyan-500/40 p-0.5 flex items-center justify-center shrink-0">
                      <img src={p.image} alt={p.name} className="w-full h-full object-cover rounded-[10px]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-white text-base truncate">{p.name}</h3>
                        <span className="text-xs font-mono text-zinc-300 font-bold">${p.symbol}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-300 font-mono mt-0.5 flex-wrap">
                        <span className="text-cyan-300 font-bold">{p.chain}</span>
                        {p.deployedChainCount > 1 && (
                          <span
                            className="text-purple-300 font-bold"
                            title={`Ticker ini juga punya market di ${p.alsoOn.map((s) => s.chainKey).join(", ")}`}
                          >
                            +{p.deployedChainCount - 1} chain
                          </span>
                        )}
                        <span>•</span>
                        {p.verified ? (
                          <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                            <ShieldCheck className="w-3 h-3" /> verified
                          </span>
                        ) : (
                          <span className="text-amber-400 flex items-center gap-1 font-semibold">
                            <AlertTriangle className="w-3 h-3" /> showcase
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-mono shrink-0">
                    <div className="text-base font-black text-white">{priceUsd > 0 ? formatUsd(priceUsd) : "—"}</div>
                    <span className="text-[10px] text-zinc-400">
                      {p.priceNative > 0
                        ? `${formatSmallNumber(p.priceNative)} ${chain.nativeSymbol}`
                        : "no price"}
                    </span>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-4 gap-2 p-3 rounded-xl bg-[#070a14] border border-white/10 text-center font-mono">
                  <Metric label="Market cap" value={mcapUsd > 0 ? formatUsd(mcapUsd, { compact: true }) : "—"} />
                  <Metric label="Supply" value={formatTokenAmount(p.supply)} />
                  <Metric
                    label="Fee split"
                    value={`${(p.lpFeeBps / 100).toFixed(2)}/${(p.treasuryBuybackBps / 100).toFixed(2)}%`}
                    tone="cyan"
                  />
                  <Metric
                    label="Pool"
                    value={p.tradable ? "live" : "none"}
                    tone={p.tradable ? "emerald" : "amber"}
                  />
                </div>

                {/* Agent info */}
                <div className="p-3 rounded-xl bg-[#050811] border border-white/5 space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between items-center text-zinc-400 gap-2">
                    <span className="shrink-0">Compute:</span>
                    <span className="text-purple-300 font-bold truncate">{p.agentModel}</span>
                  </div>
                  <div className="flex justify-between items-center text-zinc-400 gap-2">
                    <span className="shrink-0">Edge:</span>
                    <span className="text-orange-400 font-bold truncate">{p.edgeProvider}</span>
                  </div>
                  {p.teeAttestationRoot && (
                    <div className="flex justify-between items-center text-zinc-400 pt-1 border-t border-white/5 gap-2">
                      <span className="shrink-0">0G DA root:</span>
                      <span className="text-emerald-400 font-bold truncate">
                        {p.teeAttestationRoot.slice(0, 10)}…{p.teeAttestationRoot.slice(-6)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs font-mono gap-2 flex-wrap">
                  <a
                    href={explorerAddressUrl(chain, p.tokenAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-bold hover:underline"
                  >
                    <span>
                      {p.tokenAddress.slice(0, 6)}…{p.tokenAddress.slice(-4)}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <div className="flex items-center gap-3 font-bold">
                    <Link
                      href={`/token/${p.slug}?chain=${p.chainId}`}
                      className="text-cyan-300 hover:text-white flex items-center gap-1 hover:underline"
                    >
                      Terminal <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                    {p.tradable ? (
                      <Link
                        href={`/swap?token=${p.symbol}&chain=${p.chainId}`}
                        className="text-purple-300 hover:text-white flex items-center gap-1 hover:underline"
                      >
                        Swap <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    ) : (
                      <span
                        className="text-zinc-500 flex items-center gap-1 cursor-not-allowed"
                        title="No executable pool for this market yet"
                      >
                        Swap <Lock className="w-3 h-3" />
                      </span>
                    )}
                    <a
                      href="https://adexto-x402-edge.cucuvirtual.workers.dev"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-400 hover:text-orange-300 flex items-center gap-1 hover:underline"
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

function Metric({
  label,
  value,
  tone = "white",
}: {
  label: string;
  value: string;
  tone?: "white" | "cyan" | "emerald" | "amber";
}) {
  const color =
    tone === "cyan"
      ? "text-cyan-300"
      : tone === "emerald"
      ? "text-emerald-400"
      : tone === "amber"
      ? "text-amber-400"
      : "text-white";
  return (
    <div>
      <span className="text-[10px] text-zinc-400 block font-semibold">{label}</span>
      <span className={`text-xs font-bold truncate block ${color}`}>{value}</span>
    </div>
  );
}
