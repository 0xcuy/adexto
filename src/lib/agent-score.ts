/**
 * Agent Score: 0–100 untuk sebuah pasar, dihitung HANYA dari bukti on-chain.
 *
 * Bukan ulasan dan bukan pendapat. Setiap poin berasal dari sesuatu yang bisa dibaca siapa pun
 * di chain: swap dan saldo dari indeks pasar (`market-index.ts`, dibangun dari log kurva dan
 * token), event peluncuran di receipt factory, dan pengikatan ERC-8004 di kontrak token. Dompet
 * operasional ADEXTO (`OUR_ADDRESSES`) dikeluarkan dari setiap hitungan "luar", jadi uji coba
 * kami sendiri tidak pernah menaikkan skor.
 *
 * Bobot (total 100), dicetak juga di halaman /agents dan di setiap jawaban API:
 *   outside_traders   30  6 per dompet luar yang berdagang, maks 5 dompet
 *   outside_volume    20  linear sampai $200 volume dari dompet luar, harga native live
 *   outside_holders   15  3 per pemegang luar, maks 5
 *   launch            10  5 bila 100% suplai masuk kurva saat launch (event factory),
 *                         5 bila creator kini memegang <= 5% suplai
 *   identity          10  5 bila token terikat ke agen ERC-8004, 5 bila agen itu milik creator
 *   x402_deliveries   10  2 per pengantaran x402 ke dompet luar, maks 5
 *   age                5  1 per 6 hari sejak launch, maks 5
 *
 * Bukti launch bersih yang lebih lengkap akan datang dari `src/lib/launch-proof.ts` milik Plan 2;
 * sampai itu ada, faktor `launch` dibaca langsung dari event peluncuran (adapter di sini).
 */
import { ethers } from "ethers";
import { listProjects, type ProjectRecord } from "@/lib/registry";
import { ensureMarketIndex, indexable, swapsWithTimes, type IndexStatus, type MarketIndex } from "@/lib/market-index";
import { computeHolders } from "@/lib/holders";
import { nativePrices } from "@/lib/native-price";
import { readProvider, resolveChainOrDefault } from "@/lib/chains";
import { CURVE_FACTORY_ABI } from "@/lib/dex";
import { agentOwner, isOurAddress, OUR_ADDRESSES } from "@/lib/agent-identities";
import { STAKE_HUBS } from "@/config/stake-hubs";
import { MARKET_STAKES } from "@/config/market-stakes";

/**
 * Kontrak stake ikut dikeluarkan dari hitungan pemegang. Token yang di-stake berpindah ke kontrak
 * hub atau kontrak stake pasar, jadi tanpa ini kontrak itu sendiri terhitung sebagai "pemegang
 * luar" — diukur: $PARCEL mendapat satu pemegang luar yang ternyata hub Monad berisi stake kami.
 */
const STAKE_CONTRACTS = new Set(
  [...STAKE_HUBS.map((h) => h.address), ...MARKET_STAKES.map((s) => s.contract)].map((a) => a.toLowerCase())
);

export interface ScoreFactor {
  key: "outside_traders" | "outside_volume" | "outside_holders" | "launch" | "identity" | "x402_deliveries" | "age";
  label: string;
  points: number;
  max: number;
  /** Nilai mentah yang menghasilkan poinnya, dalam teks yang bisa dibaca. */
  value: string;
}

export interface AgentBinding {
  agentId: string;
  agentRegistry: string;
  owner: string | null;
  ownerIsCreator: boolean | null;
}

export interface AgentScore {
  symbol: string;
  name: string;
  chainId: number;
  chain: string;
  token: string;
  curve: string | null;
  creator: string;
  creatorIsAdexto: boolean;
  score: number;
  max: 100;
  factors: ScoreFactor[];
  agent: AgentBinding | null;
  evidence: {
    outsideTraders: number;
    outsideVolumeNative: number;
    outsideVolumeUsd: number | null;
    outsideHolders: number;
    x402Deliveries: number;
    x402DeliveriesOutside: number;
    swaps: number;
    creatorPct: number | null;
    allSupplyInCurveAtLaunch: boolean | null;
    ageDays: number;
  };
  /** False bila indeks pasar belum mencapai kepala chain, sehingga angka bisa masih naik. */
  complete: boolean;
  index: Pick<IndexStatus, "complete" | "progress" | "scannedTo" | "head"> | null;
  computedAt: string;
}

export const SCORE_METHOD =
  "Agent Score is 0-100 from on-chain evidence only. ADEXTO's own wallets are excluded from every outside count. " +
  "outside_traders 30 (6 per outside wallet, up to 5); outside_volume 20 (linear to $200 from outside wallets); " +
  "outside_holders 15 (3 per outside holder, up to 5); launch 10 (5 if 100% of supply went into the curve at " +
  "launch, 5 if the creator now holds at most 5%); identity 10 (5 if the token is bound to an ERC-8004 agent, 5 " +
  "if the creator owns that agent); x402_deliveries 10 (2 per x402 delivery to an outside wallet, up to 5); " +
  "age 5 (1 per 6 days since launch, up to 5). It measures adoption and launch facts, not quality, and is not " +
  "investment advice.";

const ZERO = ethers.ZeroAddress.toLowerCase();
const RELAYER = OUR_ADDRESSES.relayer.toLowerCase();

// ── pembacaan chain, dengan cache ───────────────────────────────────────────

declare global {
  var __ADEXTO_AGENT_SCORE_CACHE__: Map<string, { at: number; value: unknown }> | undefined;
}

function cache(): Map<string, { at: number; value: unknown }> {
  if (!globalThis.__ADEXTO_AGENT_SCORE_CACHE__) globalThis.__ADEXTO_AGENT_SCORE_CACHE__ = new Map();
  return globalThis.__ADEXTO_AGENT_SCORE_CACHE__;
}

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, keepOnNull = true): Promise<T> {
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  // Bacaan yang gagal (null) tidak menimpa bacaan baik sebelumnya.
  if (value === null && keepOnNull && hit) return hit.value as T;
  cache().set(key, { at: Date.now(), value });
  return value;
}

/** Pengikatan ERC-8004 dari kontrak token sendiri. `agentBound` dibaca dulu: agen 0 itu nyata. */
export async function readBinding(p: ProjectRecord): Promise<AgentBinding | null | undefined> {
  return cached(`binding:${p.chainId}:${p.tokenAddress.toLowerCase()}`, 10 * 60_000, async () => {
    try {
      const token = new ethers.Contract(
        p.tokenAddress,
        [
          "function agentBound() view returns (bool)",
          "function agentId() view returns (uint256)",
          "function agentRegistry() view returns (address)",
        ],
        readProvider(resolveChainOrDefault(p.chainId))
      );
      if (!(await token.agentBound())) return undefined; // terbaca: tidak terikat
      const [id, registry] = await Promise.all([token.agentId(), token.agentRegistry()]);
      const agentId = (id as bigint).toString();
      const owner = await agentOwner(p.chainId, agentId);
      return {
        agentId,
        agentRegistry: `eip155:${p.chainId}:${String(registry).toLowerCase()}`,
        owner,
        ownerIsCreator: owner ? owner.toLowerCase() === p.creator.toLowerCase() : null,
      };
    } catch {
      return null; // tidak terbaca
    }
  });
}

/** Apakah 100% suplai masuk kurva saat launch, dibaca dari event `TrinityProjectDeployed`. */
async function readSeeding(p: ProjectRecord): Promise<boolean | null> {
  if (!p.txHash) return null;
  return cached(`seeding:${p.chainId}:${p.tokenAddress.toLowerCase()}`, 365 * 24 * 3600_000, async () => {
    try {
      const receipt = await readProvider(resolveChainOrDefault(p.chainId)).getTransactionReceipt(p.txHash as string);
      if (!receipt) return null;
      const iface = new ethers.Interface(CURVE_FACTORY_ABI);
      for (const log of receipt.logs) {
        try {
          const ev = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (ev?.name === "TrinityProjectDeployed" && String(ev.args.token).toLowerCase() === p.tokenAddress.toLowerCase()) {
            return (ev.args.curveTokens as bigint) === (ev.args.initialSupply as bigint) * 10n ** 18n;
          }
        } catch {
          // bukan event factory
        }
      }
      return null;
    } catch {
      return null;
    }
  });
}

// ── skor ────────────────────────────────────────────────────────────────────

function walletOf(s: { isBuy: boolean; trader: string; recipient: string }): string {
  return (s.isBuy ? s.recipient || s.trader : s.trader).toLowerCase();
}

export async function computeAgentScore(p: ProjectRecord): Promise<AgentScore> {
  return cached(`score:${p.chainId}:${p.tokenAddress.toLowerCase()}`, 60_000, () => computeUncached(p), false);
}

async function computeUncached(p: ProjectRecord): Promise<AgentScore> {
  const chain = resolveChainOrDefault(p.chainId);
  let index: MarketIndex | null = null;
  let status: IndexStatus | null = null;
  if (indexable(p)) {
    try {
      const r = await ensureMarketIndex(p, { maxAgeMs: 60_000, waitMs: 2_500 });
      index = r.index;
      status = r.status;
    } catch {
      index = null;
    }
  }
  const [binding, seeding, prices] = await Promise.all([
    readBinding(p),
    readSeeding(p),
    nativePrices().catch(() => null),
  ]);

  const swaps = index ? swapsWithTimes(index) : [];
  const outsideWallets = new Set<string>();
  let outsideVolumeNative = 0;
  let x402Deliveries = 0;
  let x402DeliveriesOutside = 0;
  for (const s of swaps) {
    const wallet = walletOf(s);
    const relayed = s.isBuy && s.trader.toLowerCase() === RELAYER;
    if (relayed) x402Deliveries++;
    if (!wallet || wallet === ZERO || isOurAddress(wallet)) continue;
    outsideWallets.add(wallet);
    outsideVolumeNative += s.amountNative;
    if (relayed) x402DeliveriesOutside++;
  }
  const price = prices?.prices?.[chain.nativeSymbol];
  const outsideVolumeUsd = typeof price === "number" && price > 0 ? outsideVolumeNative * price : null;

  let outsideHolders = 0;
  let creatorPct: number | null = null;
  if (index && status) {
    const holders = computeHolders(index, { symbol: p.symbol, creator: p.creator, status, topN: 100_000 });
    outsideHolders = holders.top.filter((h) => !isOurAddress(h.address) && !STAKE_CONTRACTS.has(h.address.toLowerCase())).length;
    creatorPct = holders.creatorPct;
  }

  const ageDays = p.deployedAt > 0 ? Math.max(0, (Date.now() / 1000 - p.deployedAt) / 86_400) : 0;

  const factors: ScoreFactor[] = [
    {
      key: "outside_traders",
      label: "Outside traders",
      max: 30,
      points: Math.min(5, outsideWallets.size) * 6,
      value: `${outsideWallets.size} wallet${outsideWallets.size === 1 ? "" : "s"}`,
    },
    {
      key: "outside_volume",
      label: "Outside volume",
      max: 20,
      points: outsideVolumeUsd === null ? 0 : Math.round(Math.min(1, outsideVolumeUsd / 200) * 20),
      value:
        outsideVolumeUsd === null
          ? `${outsideVolumeNative.toPrecision(3)} ${chain.nativeSymbol} (no live price)`
          : `$${outsideVolumeUsd.toFixed(2)}`,
    },
    {
      key: "outside_holders",
      label: "Outside holders",
      max: 15,
      points: Math.min(5, outsideHolders) * 3,
      value: `${outsideHolders} holder${outsideHolders === 1 ? "" : "s"}`,
    },
    {
      key: "launch",
      label: "Launch",
      max: 10,
      points: (seeding === true ? 5 : 0) + (creatorPct !== null && creatorPct <= 5 ? 5 : 0),
      value:
        `${seeding === true ? "all supply in the curve at launch" : seeding === false ? "not all supply in the curve at launch" : "launch event not read"}; ` +
        `creator holds ${creatorPct === null ? "unknown" : `${creatorPct.toFixed(2)}%`}`,
    },
    {
      key: "identity",
      label: "ERC-8004 identity",
      max: 10,
      points: (binding ? 5 : 0) + (binding?.ownerIsCreator ? 5 : 0),
      value: binding
        ? `agent ${binding.agentId}${binding.ownerIsCreator ? ", owned by the creator" : binding.ownerIsCreator === false ? ", not owned by the creator" : ""}`
        : binding === undefined
          ? "not bound"
          : "binding not read",
    },
    {
      key: "x402_deliveries",
      label: "x402 deliveries",
      max: 10,
      points: Math.min(5, x402DeliveriesOutside) * 2,
      value: `${x402DeliveriesOutside} to outside wallets (${x402Deliveries} in total)`,
    },
    {
      key: "age",
      label: "Age",
      max: 5,
      points: Math.min(5, Math.floor(ageDays / 6)),
      value: `${ageDays.toFixed(1)} days`,
    },
  ];

  return {
    symbol: p.symbol,
    name: p.name,
    chainId: p.chainId,
    chain: chain.name,
    token: p.tokenAddress,
    curve: p.poolAddress,
    creator: p.creator,
    creatorIsAdexto: isOurAddress(p.creator),
    score: factors.reduce((s, f) => s + f.points, 0),
    max: 100,
    factors,
    agent: binding ?? null,
    evidence: {
      outsideTraders: outsideWallets.size,
      outsideVolumeNative,
      outsideVolumeUsd,
      outsideHolders,
      x402Deliveries,
      x402DeliveriesOutside,
      swaps: swaps.length,
      creatorPct,
      allSupplyInCurveAtLaunch: seeding,
      ageDays,
    },
    complete: Boolean(status?.complete),
    index: status ? { complete: status.complete, progress: status.progress, scannedTo: status.scannedTo, head: status.head } : null,
    computedAt: new Date().toISOString(),
  };
}

/** Pasar dari registry dengan chain + token, untuk API skor. */
export function findMarket(chainId: number, token: string): ProjectRecord | null {
  const t = token.toLowerCase();
  return listProjects().find((p) => p.chainId === Number(chainId) && p.tokenAddress.toLowerCase() === t) ?? null;
}

export interface ActivityRow {
  symbol: string;
  chainId: number;
  chain: string;
  time: number;
  side: "buy" | "sell";
  via: "x402" | "direct";
  wallet: string;
  walletIsAdexto: boolean;
  amountToken: number;
  amountNative: number;
  nativeSymbol: string;
  txHash: string;
  explorerTx: string;
}

/** Swap terbaru di pasar-pasar yang diberikan, dari indeks yang sudah ada (tanpa menunggu pemindaian). */
export async function recentActivity(markets: ProjectRecord[], limit = 20): Promise<ActivityRow[]> {
  const rows: ActivityRow[] = [];
  for (const p of markets) {
    if (!indexable(p)) continue;
    let index: MarketIndex | null = null;
    try {
      index = (await ensureMarketIndex(p, { maxAgeMs: 60_000, waitMs: 0 })).index;
    } catch {
      index = null;
    }
    if (!index) continue;
    const chain = resolveChainOrDefault(p.chainId);
    for (const s of swapsWithTimes(index).slice(-limit)) {
      const wallet = walletOf(s);
      rows.push({
        symbol: p.symbol,
        chainId: p.chainId,
        chain: chain.name,
        time: s.time,
        side: s.isBuy ? "buy" : "sell",
        via: s.isBuy && s.trader.toLowerCase() === RELAYER ? "x402" : "direct",
        wallet,
        walletIsAdexto: isOurAddress(wallet),
        amountToken: s.amountToken,
        amountNative: s.amountNative,
        nativeSymbol: chain.nativeSymbol,
        txHash: s.txHash,
        explorerTx: `${chain.blockExplorer}/tx/${s.txHash}`,
      });
    }
  }
  return rows.sort((a, b) => b.time - a.time).slice(0, limit);
}
