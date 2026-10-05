/**
 * Data `/leaderboard` (P2.4), server saja. Satu hitungan untuk semua pasar registry, di-cache satu menit.
 *
 * SUMBER
 *
 * Swap dari `market-index.ts` (setiap `Swap` sejak blok launch, per pasar). Indeksnya diminta dengan
 * `waitMs: 1_500`, berbarengan untuk semua pasar: halaman ini tidak menunggu pemindaian panjang; pasar yang indeksnya belum utuh ditandai
 * `partial`, bukan ditebak. Creator dan penghasilannya dibaca dari kurva (`creator()`,
 * `creatorOwed()`, `totalCreatorFeesPaid()`), bukan dari field `creator` registry, yang untuk $SAI
 * berisi alamat token.
 *
 * DEFINISI YANG TAHAN WASH TRADING
 *
 * - Wallet sebuah swap = penerima untuk beli, trader untuk jual (sama dengan `tradeWallet`), jadi
 *   pembelian lewat relayer x402 dihitung untuk pembelinya.
 * - Wallet tim (`isOurAddress`) dan creator pasar itu sendiri tidak pernah dihitung sebagai pembeli.
 * - Trending diurutkan dari pembeli unik 24 jam, baru volume. Satu wallet yang beli seratus kali
 *   tetap satu.
 * - Kontes: pembeli unik BERSIH dalam 72 jam pertama = wallet di luar tim dan creator yang dalam
 *   jendela itu membeli lebih banyak token daripada yang ia jual. Launch oleh wallet tim tidak ikut.
 */
import { ethers } from "ethers";
import { listPublicProjects, type ProjectRecord } from "@/lib/registry";
import { ensureMarketIndex, indexable, swapsWithTimes } from "@/lib/market-index";
import { computeHolders } from "@/lib/holders";
import { chainFromId, readProvider } from "@/lib/chains";
import { isOurAddress } from "@/lib/agent-identities";
import { logoUrlFor } from "@/lib/logo-image";
import { nativePrices } from "@/lib/native-price";
import { STABLE_PRICES, assetPriceUsd, type AssetPrices } from "@/lib/pricing";
import { activeSlots } from "@/lib/promoted";
import { CONTEST_TERMS } from "@/config/growth-programs";
import { weekLabel, weekStart } from "@/lib/referral-tag";

export interface LeaderboardMarket {
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  symbol: string;
  name: string;
  slug: string;
  token: string;
  image: string;
  deployedAt: number;
  creator: string | null;
  creatorIsTeam: boolean;
  agentBound: boolean;
  /** Pembeli unik 24 jam di luar tim dan creator. */
  buyers24h: number;
  trades24h: number;
  volume24hNative: number;
  volume24hUsd: number;
  lastTradeAt: number | null;
  priceNative: number | null;
  priceUsd: number | null;
  /** Pemegang dengan saldo, di luar kurva dan alamat bakar (`computeHolders`). Null tanpa indeks. */
  holders: number | null;
  /** Fee creator sepanjang umur kurva (dibayar + belum diklaim), USD. */
  creatorEarnedUsd: number | null;
  /** Indeks pasar ini belum mencapai kepala chain; angkanya bisa kurang. */
  partial: boolean;
}

export interface LeaderboardCreator {
  address: string;
  isTeam: boolean;
  markets: number;
  revenueUsd: number;
  symbols: string[];
}

export interface ContestEntry {
  chainId: number;
  chainName: string;
  symbol: string;
  slug: string;
  token: string;
  image: string;
  deployedAt: number;
  creator: string | null;
  score: number;
  windowEndsAt: number;
  open: boolean;
  partial: boolean;
}

export interface Leaderboard {
  computedAt: number;
  trending: LeaderboardMarket[];
  newest: LeaderboardMarket[];
  agentBound: LeaderboardMarket[];
  creators: LeaderboardCreator[];
  contest: { week: string; weekEndsAt: number; entries: ContestEntry[]; previousWeek: string; previous: ContestEntry[] };
  promoted: Array<LeaderboardMarket & { slotEndsAt: number }>;
}

const CURVE_ABI = [
  "function creator() view returns (address)",
  "function creatorOwed() view returns (uint256)",
  "function totalCreatorFeesPaid() view returns (uint256)",
];

declare global {
  var __ADEXTO_LEADERBOARD__: { at: number; value: Promise<Leaderboard> } | undefined;
  var __ADEXTO_CURVE_CREATOR__: Map<string, string> | undefined;
  var __ADEXTO_CREATOR_REVENUE__: Map<string, { at: number; native: number }> | undefined;
  var __ADEXTO_AGENT_BOUND__: Map<string, { at: number; bound: boolean }> | undefined;
}

const TTL_MS = 60_000;
const REVENUE_TTL_MS = 5 * 60_000;
const DAY = 86_400;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

async function curveCreator(p: ProjectRecord): Promise<string | null> {
  const cache = (globalThis.__ADEXTO_CURVE_CREATOR__ ??= new Map());
  const key = `${p.chainId}:${(p.poolAddress ?? "").toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const chain = chainFromId(p.chainId);
  if (!chain || !p.poolAddress) return null;
  const c = new ethers.Contract(p.poolAddress, CURVE_ABI, readProvider(chain));
  const v = await withTimeout(c.creator() as Promise<string>, 8_000);
  if (!v) return null;
  cache.set(key, v.toLowerCase());
  return v.toLowerCase();
}

/** Penghasilan creator sepanjang umur kurva (dibayar + belum diklaim), dalam native. */
async function creatorRevenueNative(p: ProjectRecord): Promise<number | null> {
  const cache = (globalThis.__ADEXTO_CREATOR_REVENUE__ ??= new Map());
  const key = `${p.chainId}:${(p.poolAddress ?? "").toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < REVENUE_TTL_MS) return hit.native;
  const chain = chainFromId(p.chainId);
  if (!chain || !p.poolAddress) return null;
  const c = new ethers.Contract(p.poolAddress, CURVE_ABI, readProvider(chain));
  const [owed, paid] = await Promise.all([
    withTimeout(c.creatorOwed() as Promise<bigint>, 8_000),
    withTimeout(c.totalCreatorFeesPaid() as Promise<bigint>, 8_000),
  ]);
  if (owed === null || paid === null) return hit?.native ?? null;
  const native = Number(ethers.formatEther(owed + paid));
  cache.set(key, { at: Date.now(), native });
  return native;
}

/**
 * Apakah token terikat ke identitas agen ERC-8004, dibaca dari token (`agentBound()`, immutable).
 * Field `agentIdentity` registry kosong untuk pasar lama walau tokennya terikat (mis. $SAI #10275 di
 * Monad), jadi chain yang menentukan. Token tanpa fungsi itu (revert) dianggap tidak terikat.
 */
async function readAgentBound(p: ProjectRecord): Promise<boolean> {
  if (p.agentIdentity) return true;
  const cache = (globalThis.__ADEXTO_AGENT_BOUND__ ??= new Map());
  const key = `${p.chainId}:${p.tokenAddress.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.bound;
  const chain = chainFromId(p.chainId);
  if (!chain) return false;
  const t = new ethers.Contract(p.tokenAddress, ["function agentBound() view returns (bool)"], readProvider(chain));
  let bound: boolean | null;
  try {
    bound = await withTimeout(t.agentBound() as Promise<boolean>, 8_000);
  } catch {
    bound = false;
  }
  // null = revert (tidak punya fungsinya) atau timeout; keduanya disimpan sebagai "tidak terikat"
  // untuk sepuluh menit, lalu dibaca lagi.
  cache.set(key, { at: Date.now(), bound: Boolean(bound) });
  return Boolean(bound);
}

const walletOf = (s: { isBuy: boolean; trader: string; recipient: string }) => (s.isBuy ? s.recipient || s.trader : s.trader).toLowerCase();

async function compute(): Promise<Leaderboard> {
  const now = Math.floor(Date.now() / 1000);
  let prices: AssetPrices = STABLE_PRICES;
  try {
    prices = { ...STABLE_PRICES, ...(await nativePrices()).prices };
  } catch {
    // kurs bawaan
  }
  const projects = listPublicProjects().filter(indexable);

  const rows = await Promise.all(
    projects.map(async (p) => {
      const chain = chainFromId(p.chainId);
      const [{ index, status }, creator, revenue, bound] = await Promise.all([
        ensureMarketIndex(p, { maxAgeMs: 60_000, waitMs: 1_500 }),
        curveCreator(p),
        creatorRevenueNative(p),
        readAgentBound(p),
      ]);
      const swaps = index ? swapsWithTimes(index) : [];
      const excluded = (w: string) => isOurAddress(w) || (creator !== null && w === creator);
      const day = swaps.filter((s) => s.time >= now - DAY && !excluded(walletOf(s)));
      const buyers = new Set(day.filter((s) => s.isBuy).map(walletOf));
      const last = swaps.length ? swaps[swaps.length - 1] : null;
      const nativeUsd = assetPriceUsd(chain?.nativeSymbol ?? "", prices);
      const priceNative = last?.priceNativeAfter ?? (p.priceNative > 0 ? p.priceNative : null);
      const volume = day.reduce((s, x) => s + x.amountNative, 0);
      const market: LeaderboardMarket = {
        chainId: p.chainId,
        chainName: chain?.name ?? p.chainLabel,
        nativeSymbol: chain?.nativeSymbol ?? "",
        symbol: p.symbol,
        name: p.name,
        slug: p.slug,
        token: p.tokenAddress,
        image: logoUrlFor(p),
        deployedAt: p.deployedAt,
        creator,
        creatorIsTeam: creator !== null && isOurAddress(creator),
        agentBound: bound,
        buyers24h: buyers.size,
        trades24h: day.length,
        volume24hNative: volume,
        volume24hUsd: volume * nativeUsd,
        lastTradeAt: last?.time ?? null,
        priceNative,
        priceUsd: priceNative !== null && nativeUsd > 0 ? priceNative * nativeUsd : null,
        holders: index ? computeHolders(index, { symbol: p.symbol, creator: creator ?? "", status }).holders : null,
        creatorEarnedUsd: revenue !== null ? revenue * nativeUsd : null,
        partial: !status.complete,
      };
      // Skor kontes: pembeli bersih dalam jendela 72 jam sejak launch.
      const windowEnds = p.deployedAt + CONTEST_TERMS.scoringWindowHours * 3600;
      const net = new Map<string, number>();
      for (const s of swaps) {
        if (s.time < p.deployedAt || s.time >= windowEnds) continue;
        const w = walletOf(s);
        if (excluded(w)) continue;
        net.set(w, (net.get(w) ?? 0) + (s.isBuy ? s.amountToken : -s.amountToken));
      }
      const score = [...net.values()].filter((v) => v > 0).length;
      return { p, market, revenue, nativeUsd, score, windowEnds, partial: !status.complete };
    })
  );

  const markets = rows.map((r) => r.market);
  const trending = markets
    .slice()
    .sort((a, b) => b.buyers24h - a.buyers24h || b.volume24hUsd - a.volume24hUsd || (b.lastTradeAt ?? 0) - (a.lastTradeAt ?? 0));
  const newest = markets.slice().sort((a, b) => b.deployedAt - a.deployedAt).slice(0, 10);
  const agentBound = markets.filter((m) => m.agentBound).sort((a, b) => b.buyers24h - a.buyers24h || b.deployedAt - a.deployedAt);

  const byCreator = new Map<string, LeaderboardCreator>();
  for (const r of rows) {
    const c = r.market.creator;
    if (!c) continue;
    const e = byCreator.get(c) ?? { address: c, isTeam: isOurAddress(c), markets: 0, revenueUsd: 0, symbols: [] };
    e.markets += 1;
    e.revenueUsd += (r.revenue ?? 0) * r.nativeUsd;
    if (!e.symbols.includes(r.market.symbol)) e.symbols.push(r.market.symbol);
    byCreator.set(c, e);
  }
  const creators = [...byCreator.values()].sort((a, b) => b.revenueUsd - a.revenueUsd);

  const thisWeek = weekStart(now);
  const lastWeek = thisWeek - 7 * DAY;
  const entry = (r: (typeof rows)[number]): ContestEntry => ({
    chainId: r.market.chainId,
    chainName: r.market.chainName,
    symbol: r.market.symbol,
    slug: r.market.slug,
    token: r.market.token,
    image: r.market.image,
    deployedAt: r.market.deployedAt,
    creator: r.market.creator,
    score: r.score,
    windowEndsAt: r.windowEnds,
    open: now < r.windowEnds,
    partial: r.partial,
  });
  const eligible = rows.filter((r) => r.market.creator !== null && !r.market.creatorIsTeam);
  const inWeek = (start: number) =>
    eligible
      .filter((r) => r.market.deployedAt >= start && r.market.deployedAt < start + 7 * DAY)
      .map(entry)
      .sort((a, b) => b.score - a.score || a.deployedAt - b.deployedAt);

  const slots = activeSlots(now);
  const promoted = slots
    .map((s) => {
      const m = markets.find((x) => x.chainId === s.chainId && x.token.toLowerCase() === s.token);
      return m ? { ...m, slotEndsAt: s.endsAt } : null;
    })
    .filter((x): x is LeaderboardMarket & { slotEndsAt: number } => x !== null);

  return {
    computedAt: now,
    trending,
    newest,
    agentBound,
    creators,
    contest: { week: weekLabel(thisWeek), weekEndsAt: thisWeek + 7 * DAY, entries: inWeek(thisWeek), previousWeek: weekLabel(lastWeek), previous: inWeek(lastWeek) },
    promoted,
  };
}

export function getLeaderboard(): Promise<Leaderboard> {
  const hit = globalThis.__ADEXTO_LEADERBOARD__;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = compute();
  globalThis.__ADEXTO_LEADERBOARD__ = { at: Date.now(), value };
  value.catch(() => {
    if (globalThis.__ADEXTO_LEADERBOARD__?.value === value) globalThis.__ADEXTO_LEADERBOARD__ = undefined;
  });
  return value;
}
