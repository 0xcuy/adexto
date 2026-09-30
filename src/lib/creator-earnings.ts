/**
 * Penghasilan creator lintas pasar, DIBACA DARI KURVA, bukan dari registry kita.
 *
 * Kenapa tidak dari indexer: subgraph Base dan Arbitrum sedang tidak mengindeks apa pun (lihat
 * README "Honest status"), dan Envio hanya Monad. Angka uang yang ditampilkan ke creator harus
 * datang dari tempat uangnya berada. Tiga bacaan per kurva, semuanya ada di setiap generasi
 * (0.10.0 SovereignCurve, 0.11.0, 0.12.0 — diperiksa on-chain 2026-09-30):
 *
 *   creator()               siapa yang dibayar (immutable)
 *   creatorOwed()           yang bisa diklaim sekarang
 *   totalCreatorFeesPaid()  yang sudah diklaim sepanjang masa
 *
 * Seumur hidup = paid + owed. `VERSION()` hanya ada sejak 0.11.0; kurva 0.10.0 me-revert dan
 * generasinya diambil dari catatan peluncuran.
 *
 * DARI MANA DAFTAR PASARNYA: registry (pasar yang terdaftar, termasuk peluncuran baru dari
 * Studio) digabung dengan `onchain-launches.json` (setiap peluncuran yang ada di chain,
 * termasuk yang digantikan dan uji). Sebuah pasar hanya dihitung bila `creator()` di kurvanya
 * sendiri sama dengan alamat yang ditanya — kolom `creator` di registry TIDAK dipercaya,
 * karena entri kurasi mengisinya dengan alamat factory.
 */
import { ethers } from "ethers";
import launchRecord from "@/config/onchain-launches.json";
import { listProjects } from "@/lib/registry";
import { readProvider, resolveChain, type ChainInfo } from "@/lib/chains";
import { nativePrices } from "@/lib/native-price";

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

const CURVE_READ_ABI = [
  "function creator() view returns (address)",
  "function creatorOwed() view returns (uint256)",
  "function totalCreatorFeesPaid() view returns (uint256)",
  "function creatorFeeBps() view returns (uint256)",
  "function totalFeeBps() view returns (uint256)",
  "function VERSION() view returns (string)",
];

export type MarketStatus = "listed" | "live" | "superseded" | "test";

export type CreatorMarket = {
  key: string;
  symbol: string;
  name: string;
  slug: string | null;
  chainId: number;
  chainKey: string;
  chainName: string;
  nativeSymbol: string;
  explorer: string;
  curve: string;
  token: string;
  status: MarketStatus;
  version: string | null;
  creatorFeeBps: number | null;
  totalFeeBps: number | null;
  owedWei: string | null;
  paidWei: string | null;
  lifetimeWei: string | null;
  owed: number | null;
  paid: number | null;
  lifetime: number | null;
  usdPrice: number | null;
  priceLive: boolean;
  owedUsd: number | null;
  lifetimeUsd: number | null;
  error: string | null;
};

export type CreatorChain = {
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  claimableMarkets: number;
  owedWei: string;
  owed: number;
  multicall3: boolean;
};

export type CreatorEarnings = {
  address: string;
  readAt: string;
  markets: CreatorMarket[];
  chains: CreatorChain[];
  totals: { lifetimeUsd: number; owedUsd: number; markets: number; unpriced: number };
  checked: number;
  unreadable: number;
};

type Candidate = {
  chain: ChainInfo;
  curve: string;
  token: string;
  symbol: string;
  name: string;
  slug: string | null;
  status: MarketStatus;
  recordedVersion: string | null;
};

type Fixed = { creator: string; version: string | null; creatorFeeBps: number | null; totalFeeBps: number | null };

/**
 * Fakta yang immutable per kurva, disimpan selamanya di memori proses.
 *
 * `creator`, `VERSION`, dan kedua tarif tidak bisa berubah setelah deploy, jadi membacanya
 * ulang tiap permintaan hanya membebani RPC publik. Galat TIDAK disimpan: itu biasanya RPC yang
 * sedang tersendat, dan menyimpannya akan membuat pasar hilang dari halaman creator sampai
 * proses dimulai ulang.
 */
const g = globalThis as unknown as { __ADEXTO_CURVE_FIXED__?: Map<string, Fixed>; __ADEXTO_MC3__?: Map<number, boolean> };
const FIXED: Map<string, Fixed> = (g.__ADEXTO_CURVE_FIXED__ ??= new Map());
const MC3: Map<number, boolean> = (g.__ADEXTO_MC3__ ??= new Map());

const READ_TIMEOUT_MS = 8_000;

function withTimeout<T>(p: Promise<T>, ms = READ_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Menjalankan `fn` untuk setiap item dengan paling banyak `limit` sekaligus. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function candidates(): Candidate[] {
  const map = new Map<string, Candidate>();
  const keyOf = (chainId: number, curve: string) => `${chainId}:${curve.toLowerCase()}`;

  for (const l of launchRecord.launches as Array<{
    symbol: string;
    status: string;
    chainId: number;
    factoryVersion?: string;
    token: string;
    curve: string;
  }>) {
    const chain = resolveChain(l.chainId);
    if (!chain || !ethers.isAddress(l.curve)) continue;
    const status: MarketStatus = l.status === "superseded" ? "superseded" : l.status === "test" ? "test" : "live";
    map.set(keyOf(chain.chainId, l.curve), {
      chain,
      curve: ethers.getAddress(l.curve),
      token: l.token,
      symbol: l.symbol,
      name: l.symbol,
      slug: null,
      status,
      recordedVersion: l.factoryVersion ?? null,
    });
  }

  // Registry menang untuk nama dan slug (itulah yang terdaftar), catatan peluncuran menang
  // untuk generasi (registry tidak menyimpannya).
  for (const p of listProjects()) {
    if (!p.poolAddress || !ethers.isAddress(p.poolAddress)) continue;
    const chain = resolveChain(p.chainId);
    if (!chain) continue;
    const k = keyOf(chain.chainId, p.poolAddress);
    const prev = map.get(k);
    map.set(k, {
      chain,
      curve: ethers.getAddress(p.poolAddress),
      token: p.tokenAddress,
      symbol: p.symbol,
      name: p.name,
      slug: p.slug,
      status: "listed",
      recordedVersion: prev?.recordedVersion ?? null,
    });
  }
  return [...map.values()];
}

async function readFixed(c: Candidate): Promise<Fixed | null> {
  const k = `${c.chain.chainId}:${c.curve.toLowerCase()}`;
  const hit = FIXED.get(k);
  if (hit) return hit;
  try {
    const curve = new ethers.Contract(c.curve, CURVE_READ_ABI, readProvider(c.chain));
    const creator = String(await withTimeout(curve.creator()));
    // Tiga bacaan berikut boleh gagal sendiri-sendiri: kurva 0.10.0 tidak punya VERSION()
    // maupun totalFeeBps(), dan itu bukan galat baca.
    const [version, creatorFeeBps, totalFeeBps] = await Promise.all([
      withTimeout(curve.VERSION()).then(String).catch(() => null),
      withTimeout(curve.creatorFeeBps()).then(Number).catch(() => null),
      withTimeout(curve.totalFeeBps()).then(Number).catch(() => null),
    ]);
    const fixed: Fixed = { creator: ethers.getAddress(creator), version, creatorFeeBps, totalFeeBps };
    FIXED.set(k, fixed);
    return fixed;
  } catch {
    return null;
  }
}

async function hasMulticall3(chain: ChainInfo): Promise<boolean> {
  const hit = MC3.get(chain.chainId);
  if (hit !== undefined) return hit;
  try {
    const code = await withTimeout(readProvider(chain).getCode(MULTICALL3));
    const ok = code !== "0x";
    MC3.set(chain.chainId, ok);
    return ok;
  } catch {
    return false;
  }
}

export async function readCreatorEarnings(addressRaw: string): Promise<CreatorEarnings> {
  const address = ethers.getAddress(addressRaw);
  const list = candidates();

  // Per chain paling banyak 4 bacaan sekaligus: RPC publik (terutama Base) menghitung
  // semburan, dan jawaban rate-limit-nya terbaca seperti revert.
  const byChain = new Map<number, Candidate[]>();
  for (const c of list) byChain.set(c.chain.chainId, [...(byChain.get(c.chain.chainId) ?? []), c]);
  const fixedPairs = (
    await Promise.all([...byChain.values()].map((cs) => mapLimit(cs, 4, async (c) => [c, await readFixed(c)] as const)))
  ).flat();

  const unreadable = fixedPairs.filter(([, f]) => f === null).length;
  const mine = fixedPairs.filter(([, f]) => f && f.creator === address) as Array<readonly [Candidate, Fixed]>;

  const { prices, live } = await nativePrices().catch(() => ({ prices: {} as Record<string, number>, live: {} as Record<string, boolean> }));

  const markets: CreatorMarket[] = await Promise.all(
    mine.map(async ([c, f]) => {
      const price = prices[c.chain.nativeSymbol];
      const usdPrice = typeof price === "number" && price > 0 ? price : null;
      const base = {
        key: `${c.chain.chainId}:${c.curve.toLowerCase()}`,
        symbol: c.symbol,
        name: c.name,
        slug: c.slug,
        chainId: c.chain.chainId,
        chainKey: c.chain.key,
        chainName: c.chain.name,
        nativeSymbol: c.chain.nativeSymbol,
        explorer: c.chain.blockExplorer,
        curve: c.curve,
        token: c.token,
        status: c.status,
        version: f.version ?? c.recordedVersion,
        creatorFeeBps: f.creatorFeeBps,
        totalFeeBps: f.totalFeeBps,
        usdPrice,
        priceLive: Boolean(live[c.chain.nativeSymbol]),
      };
      try {
        const curve = new ethers.Contract(c.curve, CURVE_READ_ABI, readProvider(c.chain));
        const [owedWei, paidWei] = (await Promise.all([
          withTimeout(curve.creatorOwed()),
          withTimeout(curve.totalCreatorFeesPaid()),
        ])) as [bigint, bigint];
        const lifetimeWei = owedWei + paidWei;
        const owed = Number(ethers.formatEther(owedWei));
        const paid = Number(ethers.formatEther(paidWei));
        const lifetime = Number(ethers.formatEther(lifetimeWei));
        return {
          ...base,
          owedWei: owedWei.toString(),
          paidWei: paidWei.toString(),
          lifetimeWei: lifetimeWei.toString(),
          owed,
          paid,
          lifetime,
          owedUsd: usdPrice === null ? null : owed * usdPrice,
          lifetimeUsd: usdPrice === null ? null : lifetime * usdPrice,
          error: null,
        };
      } catch (e) {
        return {
          ...base,
          owedWei: null,
          paidWei: null,
          lifetimeWei: null,
          owed: null,
          paid: null,
          lifetime: null,
          owedUsd: null,
          lifetimeUsd: null,
          error: e instanceof Error ? e.message.slice(0, 160) : "read failed",
        };
      }
    })
  );

  // Terbesar dulu menurut USD seumur hidup; yang tidak berharga USD di belakang, lalu simbol.
  markets.sort((a, b) => (b.lifetimeUsd ?? -1) - (a.lifetimeUsd ?? -1) || a.symbol.localeCompare(b.symbol));

  const chainIds = [...new Set(markets.map((m) => m.chainId))];
  const chains: CreatorChain[] = await Promise.all(
    chainIds.map(async (id) => {
      const ms = markets.filter((m) => m.chainId === id);
      const owedWei = ms.reduce((s, m) => s + BigInt(m.owedWei ?? "0"), 0n);
      const chain = resolveChain(id) as ChainInfo;
      const claimable = ms.filter((m) => m.owedWei && BigInt(m.owedWei) > 0n).length;
      return {
        chainId: id,
        chainName: chain.name,
        nativeSymbol: chain.nativeSymbol,
        claimableMarkets: claimable,
        owedWei: owedWei.toString(),
        owed: Number(ethers.formatEther(owedWei)),
        // Hanya relevan bila ada dua atau lebih yang bisa diklaim; satu kurva diklaim langsung.
        multicall3: claimable >= 2 ? await hasMulticall3(chain) : false,
      };
    })
  );

  const priced = markets.filter((m) => m.lifetimeUsd !== null);
  return {
    address,
    readAt: new Date().toISOString(),
    markets,
    chains,
    totals: {
      lifetimeUsd: priced.reduce((s, m) => s + (m.lifetimeUsd ?? 0), 0),
      owedUsd: priced.reduce((s, m) => s + (m.owedUsd ?? 0), 0),
      markets: markets.length,
      unpriced: markets.length - priced.length,
    },
    checked: list.length,
    unreadable,
  };
}
