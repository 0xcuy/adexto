/**
 * Lapisan DEXTools di atas inti adapter yang sama dengan DEX Screener.
 *
 * SPESIFIKASI
 *
 * "DEX/Blockchain integration API" (OpenAPI 3.0.3, v0.0.1) dari
 * https://github.com/dextools-io/integration-sdk/blob/main/http-adapter/http-adapter-specification.yml,
 * dibaca 2 Okt 2026. Bentuknya hampir sama dengan DEX Screener, dengan selisih yang ditangani
 * di sini:
 *
 *   - endpoint tambahan `/block?number=|timestamp=`, `/asset/holders`, `/exchange?id=<factory>`;
 *   - `pair` wajib `factoryAddress` dan ketiga field `createdAt*`;
 *   - event `creation` untuk pair baru (dari log `TrinityProjectDeployed` factory);
 *   - galat berbentuk `{ code, message }`;
 *   - pola angka `^\d+(?:\.\d+)$` menuntut bagian pecahan, jadi bilangan bulat ditulis `"1.0"`.
 *
 * KENAPA EVENT DEXTOOLS TANPA `reserves`
 *
 * Skema DEXTools tidak punya field harga, jadi harga harus diturunkan dari jumlah atau dari
 * reserve. Kurva ADEXTO menghargai terhadap reserve native VIRTUAL, sehingga rasio reserve
 * RIIL bukan harga — untuk $PARCEL selisihnya sekitar 20.000 kali. Daripada membiarkan
 * DEXTools menurunkan harga yang salah dari reserve, `reserves` dihilangkan dan `priceNative`
 * (harga spot sesudah event, sama dengan adapter DEX Screener) ditambahkan sebagai field
 * ekstensi. Teks pengajuan menjelaskan ini dan menawarkan reserve riil kalau mereka menghitung
 * harga dari jumlah.
 */
import { ethers } from "ethers";
import { ensureMarketIndex, type MarketIndex } from "@/lib/market-index";
import type { ProjectRecord } from "@/lib/registry";
import {
  AdapterError,
  assetInfo,
  blockTime,
  cachedRange,
  creation,
  firstBlockAtOrAfter,
  latestBlock,
  marketFor,
  normalizeAddress,
  rangeEntries,
  registryRecord,
  toEvent,
  type AdapterBlock,
  type Runtime,
  type StoredMarket,
} from "./adapter";

export const DEXTOOLS_SPEC = "DEXTools DEX/Blockchain integration API 0.0.1";
export const EXCHANGE_NAME = "ADEXTO";
export const EXCHANGE_LOGO = "https://adexto.xyz/share/adexto-mark.png";

/** `"1000000000"` → `"1000000000.0"`; pola angka DEXTools menuntut bagian pecahan. */
function dtNumber(value: string): string {
  return value.includes(".") ? value : `${value}.0`;
}

export interface DextoolsEvent {
  block: AdapterBlock;
  txnId: string;
  txnIndex: number;
  eventIndex: number;
  maker: string;
  pairId: string;
  eventType: "creation" | "swap";
  asset0In?: string;
  asset1In?: string;
  asset0Out?: string;
  asset1Out?: string;
  /** Ekstensi: harga spot sesudah event, native per token. */
  priceNative?: string;
}

export async function dextoolsEvents(rt: Runtime, fromBlock: number, toBlock: number): Promise<DextoolsEvent[]> {
  return cachedRange(rt, `dextools:${fromBlock}:${toBlock}`, async () =>
    (await rangeEntries(rt, fromBlock, toBlock, true)).map((e): DextoolsEvent => {
      const base = {
        block: { blockNumber: e.log.blockNumber, blockTimestamp: e.blockTimestamp },
        txnId: e.log.transactionHash,
        txnIndex: e.log.transactionIndex,
        eventIndex: e.log.index,
        pairId: e.market.pairId,
      };
      // Peluncuran: pengirimnya creator, yang juga dicatat factory sebagai `creator`.
      if (e.creation) return { ...base, maker: e.market.creator, eventType: "creation" };
      const swap = toEvent(e.market, e.log, e.blockTimestamp);
      const out: DextoolsEvent = { ...base, maker: swap.maker, eventType: "swap", priceNative: swap.priceNative };
      for (const key of ["asset0In", "asset1In", "asset0Out", "asset1Out"] as const) {
        if (swap[key] !== undefined) out[key] = dtNumber(swap[key]!);
      }
      return out;
    })
  );
}

export async function dextoolsPair(rt: Runtime, id: string | null) {
  const address = normalizeAddress(id);
  const m = await marketFor(rt, address, "pair");
  if (!m) throw new AdapterError(404, `No ADEXTO market with curve ${address} on ${rt.cfg.chain.name}.`);
  const created = await creation(rt, m);
  if (!created) throw new AdapterError(503, "The creation block of this pair is not resolved yet. Retry shortly.", 30);
  return {
    id: m.pairId,
    asset0Id: m.tokenId,
    asset1Id: rt.cfg.wrappedNative,
    createdAtBlockNumber: created.blockNumber,
    createdAtBlockTimestamp: created.blockTimestamp,
    createdAtTxnId: created.txnId,
    feeBps: m.feeBps,
    factoryAddress: m.factory,
  };
}

export function dextoolsExchange(rt: Runtime, id: string | null) {
  const address = normalizeAddress(id);
  const factory = rt.cfg.factories.find((f) => f.address.toLowerCase() === address.toLowerCase());
  if (!factory) throw new AdapterError(404, `No ADEXTO factory at ${address} on ${rt.cfg.chain.name}.`);
  return { factoryAddress: ethers.getAddress(factory.address), name: EXCHANGE_NAME, logoURL: EXCHANGE_LOGO };
}

function intParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  if (!/^\d{1,12}$/.test(raw.trim())) throw new AdapterError(400, `Query parameter \`${name}\` must be a non-negative integer.`);
  return Number(raw.trim());
}

/**
 * Blok menurut nomor, atau blok termuda dengan timestamp <= yang diminta. Hanya sampai
 * `/latest-block`: blok sesudahnya belum final dan tidak dilayani di mana pun di adapter ini.
 */
export async function dextoolsBlock(rt: Runtime, url: URL): Promise<AdapterBlock> {
  const number = intParam(url, "number");
  const timestamp = intParam(url, "timestamp");
  if (number === null && timestamp === null) {
    throw new AdapterError(400, "Pass either `number` or `timestamp`.");
  }
  const latest = await latestBlock(rt);
  if (number !== null) {
    if (number > latest.blockNumber) throw new AdapterError(404, `Block ${number} is not final yet. Ask /latest-block.`);
    return { blockNumber: number, blockTimestamp: await blockTime(rt, number) };
  }
  if (timestamp! >= latest.blockTimestamp) return latest;
  // Blok pertama yang timestamp-nya melewati `timestamp`; yang diminta adalah tepat sebelumnya.
  const after = await firstBlockAtOrAfter(rt, timestamp! + 1, 1, latest.blockNumber);
  const candidate = (after ?? latest.blockNumber + 1) - 1;
  const blockTimestamp = await blockTime(rt, candidate);
  if (blockTimestamp > timestamp!) throw new AdapterError(404, `No block at or before timestamp ${timestamp}.`);
  return { blockNumber: candidate, blockTimestamp };
}

/**
 * Indeks saldo pasar dari `market-index.ts`, lengkap atau null. Pasar di registry memakai
 * catatannya sendiri (berkas indeks yang sama dengan aplikasi); pasar factory di luar registry
 * memakai blok peluncuran yang dibaca dari log factory.
 */
async function balanceIndex(rt: Runtime, m: StoredMarket, waitMs: number): Promise<MarketIndex | null> {
  let project = registryRecord(rt, m.pairId);
  if (!project) {
    const created = await creation(rt, m);
    if (!created) return null;
    project = {
      chainId: rt.cfg.chain.chainId,
      tokenAddress: m.tokenId,
      poolAddress: m.pairId,
      blockNumber: created.blockNumber,
      symbol: m.symbol,
    } as unknown as ProjectRecord;
  }
  const { index, status } = await ensureMarketIndex(project, { waitMs });
  return index && status.complete ? index : null;
}

function holderRows(index: MarketIndex): Array<{ address: string; wei: bigint }> {
  return Object.entries(index.balances)
    .map(([address, raw]) => ({ address, wei: BigInt(raw) }))
    .filter((r) => r.wei > 0n)
    .sort((a, b) => (b.wei > a.wei ? 1 : b.wei < a.wei ? -1 : a.address.localeCompare(b.address)));
}

export async function dextoolsAsset(rt: Runtime, id: string | null) {
  const asset = await assetInfo(rt, id);
  const out: Record<string, unknown> = { id: asset.id, name: asset.name, symbol: asset.symbol };
  if (asset.totalSupply) out.totalSupply = dtNumber(asset.totalSupply);
  const isQuote = asset.id.toLowerCase() === rt.cfg.wrappedNative.toLowerCase();
  const m = isQuote ? null : await marketFor(rt, asset.id, "token");
  if (m) {
    // Hanya kalau indeksnya utuh: angka pemegang dari indeks setengah jadi akan salah.
    const index = await balanceIndex(rt, m, 1_500);
    if (index) out.holdersCount = holderRows(index).length;
  }
  return out;
}

export async function dextoolsHolders(rt: Runtime, url: URL) {
  const address = normalizeAddress(url.searchParams.get("id"));
  const page = intParam(url, "page") ?? 0;
  const pageSize = intParam(url, "pageSize") ?? 10;
  if (pageSize < 10 || pageSize > 50) throw new AdapterError(400, "`pageSize` must be between 10 and 50.");
  const m = await marketFor(rt, address, "token");
  if (!m) throw new AdapterError(404, `No ADEXTO market token ${address} on ${rt.cfg.chain.name}.`);
  const index = await balanceIndex(rt, m, 8_000);
  if (!index) throw new AdapterError(503, "The holder index of this token is still being built. Retry shortly.", 30);
  const rows = holderRows(index);
  const scale = 10n ** BigInt(index.decimals);
  return {
    id: m.tokenId,
    totalHoldersCount: rows.length,
    // `quantity` bertipe integer di skema DEXTools: token utuh, dibulatkan ke bawah.
    holders: rows.slice(page * pageSize, page * pageSize + pageSize).map((r) => ({
      address: ethers.getAddress(r.address),
      quantity: Number(r.wei / scale),
    })),
  };
}
