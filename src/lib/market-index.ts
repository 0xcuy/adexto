import { ethers } from "ethers";
import { readJson, writeJson } from "@/lib/server-store";
import { logReadProvider, readProvider, resolveChainOrDefault, type ChainInfo } from "@/lib/chains";
import { ERC20_ABI } from "@/lib/dex";
import { SWAP_TOPICS, logSpanFor, swapIfaceForTopic } from "@/lib/onchain-trades";
import type { ProjectRecord } from "@/lib/registry";
import type { TradeEvent } from "@/lib/telemetry";

/**
 * Indeks per pasar: SELURUH event `Transfer` token dan `Swap` kurva sejak blok peluncuran,
 * disimpan di disk dan diperbarui bertahap dari blok terakhir yang sudah dipindai.
 *
 * KENAPA INI ADA
 *
 * `readOnChainSwaps` memindai MUNDUR dari kepala dengan anggaran 16 panggilan, lalu lupa
 * semuanya setelah 15 detik. Untuk chart itu cukup selama pasarnya muda, dan sekarang tidak
 * lagi: diukur 2026-09-30, $ADEXTO dan $ADT di 0G diluncurkan ~1.985.000 blok lalu sementara
 * jangkauan pemindaian 1.440.000 blok. $ADT karena itu melaporkan NOL perdagangan dan
 * `reachedLaunch: false` walau harganya sudah bergerak — riwayatnya ada di chain, hanya di luar
 * jendela. Tiga fitur yang dibangun di atas ini justru butuh riwayat UTUH:
 *
 *   - holder: saldo tiap alamat hanya bisa disusun dari SELURUH `Transfer` sejak mint. RPC
 *     publik 0G memangkas state lama ("missing trie node" 1.000 blok ke belakang), jadi saldo
 *     historis tidak bisa dibaca lewat `eth_call`; log adalah satu-satunya sumber.
 *   - posisi dan PnL: satu pembelian yang terlewat membuat harga masuk rata-rata salah, dan
 *     angka yang salah di sana lebih buruk daripada tidak ada angka.
 *   - statistik: "24 jam" tidak bermakna kalau jendelanya sendiri bisa lebih pendek.
 *
 * Ditanam di disk karena pemindaian awal mahal (Base: petak 500 blok sejak 2026-10-05, $BLOOP
 * ~840.000 blok dalam = ~1.700 panggilan, jadi lima kali jalan dengan `MAX_CALLS_PER_RUN`)
 * sedangkan pembaruan sesudahnya murah: satu panggilan untuk blok yang lahir sejak pembaruan
 * terakhir.
 *
 * YANG DIJAMIN
 *
 * `scannedTo` adalah blok terakhir yang SUDAH dipindai utuh, dan semua yang di bawahnya sampai
 * `launchBlock` sudah diterapkan. Petak dipindai berurutan naik dan diterapkan hanya kalau
 * semua petak sebelumnya berhasil, jadi tidak pernah ada lubang di tengah. Log dengan
 * konfirmasi kurang dari `CONFIRMATIONS` belum diambil, supaya reorg di ujung tidak bisa
 * menanam `Transfer` hantu ke saldo selamanya.
 */

export interface IndexedSwap {
  /** `${txHash}_${logIndex}`, bentuk yang sama dengan `readOnChainSwaps`. */
  id: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  /** Timestamp blok (detik). Null sampai terbaca; `swapsWithTimes` memperkirakannya. */
  time: number | null;
  isBuy: boolean;
  /** `msg.sender`, huruf kecil. Untuk pembelian lewat relai ini relainya. */
  trader: string;
  /** Penerima token (beli) atau penerima native (jual), huruf kecil. */
  recipient: string;
  /** Native yang masuk ke kurva (beli, bruto termasuk fee) atau keluar ke penjual (jual, neto). */
  amountNative: number;
  amountToken: number;
  /** Harga spot kurva sesudah swap, dari reserve di event itu sendiri. */
  priceNativeAfter: number | null;
}

export interface MarketIndex {
  version: 1;
  chainId: number;
  token: string;
  curve: string;
  decimals: number;
  launchBlock: number;
  /** Blok terakhir yang sudah dipindai utuh (inklusif). `launchBlock - 1` sebelum mulai. */
  scannedTo: number;
  /** Kepala chain saat pembaruan terakhir. */
  head: number;
  /** Saldo per alamat huruf kecil, dalam satuan terkecil, sebagai string desimal. */
  balances: Record<string, string>;
  /** Total yang dikirim ke alamat nol (dibakar lewat `_burn`). */
  burnedToZero: string;
  transfers: number;
  swaps: IndexedSwap[];
  updatedAt: number;
}

export interface IndexStatus {
  /** Pembaruan terakhir mencapai kepala yang aman: semua sejak peluncuran sudah dipindai. */
  complete: boolean;
  /** 0..1, porsi rentang peluncuran→kepala yang sudah dipindai. */
  progress: number;
  scannedTo: number;
  head: number;
  launchBlock: number;
  updating: boolean;
  error: string | null;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

/**
 * Konfirmasi sebelum log diambil. Kecil karena keempat chain ini final dalam hitungan detik;
 * cukup untuk tidak mengambil blok yang masih bisa diganti di ujung.
 */
// Robinhood Chain: 20 blocks of ~0.1 s, about two seconds behind the tip.
const CONFIRMATIONS: Record<number, number> = { 16661: 2, 8453: 3, 42161: 10, 143: 3, 4663: 20 };
const DEFAULT_CONFIRMATIONS = 5;

/**
 * Kedalaman konfirmasi indeks ini untuk sebuah chain. Diekspor supaya adapter agregator
 * (`src/app/api/dexscreener/`) memakai kedalaman yang sama, bukan salinan angka yang bisa
 * menyimpang.
 */
export function confirmationsFor(chainId: number): number {
  return CONFIRMATIONS[chainId] ?? DEFAULT_CONFIRMATIONS;
}

/**
 * Petak berbarengan per putaran. Base lebih rendah: `mainnet.base.org` menghitung panggilan
 * berdekatan terhadap batas burst-nya dan menjawab "over rate limit".
 */
const PARALLEL_BY_CHAIN: Record<number, number> = { 8453: 2 };
const DEFAULT_PARALLEL = 4;

/** Batas panggilan `getLogs` per satu kali jalan, supaya satu pasar tidak bisa memonopoli RPC. */
const MAX_CALLS_PER_RUN = 400;

const FILE_VERSION = 1 as const;

interface CacheSlot {
  index: MarketIndex | null;
  checkedAt: number;
  running: Promise<void> | null;
  error: string | null;
}

declare global {
  var __ADEXTO_MARKET_INDEX__: Map<string, CacheSlot> | undefined;
}

function slots(): Map<string, CacheSlot> {
  if (!globalThis.__ADEXTO_MARKET_INDEX__) globalThis.__ADEXTO_MARKET_INDEX__ = new Map();
  return globalThis.__ADEXTO_MARKET_INDEX__;
}

function fileFor(chainId: number, token: string): string {
  return `market-index-${chainId}-${token.toLowerCase()}.json`;
}

const lower = (a: string) => a.toLowerCase();
const topicAddress = (topic: string) => lower(ethers.getAddress(`0x${topic.slice(26)}`));

function freshIndex(project: ProjectRecord, decimals: number): MarketIndex {
  const launchBlock = Number(project.blockNumber);
  return {
    version: FILE_VERSION,
    chainId: project.chainId,
    token: lower(project.tokenAddress),
    curve: lower(project.poolAddress!),
    decimals,
    launchBlock,
    scannedTo: launchBlock - 1,
    head: launchBlock,
    balances: {},
    burnedToZero: "0",
    transfers: 0,
    swaps: [],
    updatedAt: 0,
  };
}

/** Pasar bisa diindeks bila tahu kurvanya dan blok kelahirannya. */
export function indexable(project: ProjectRecord | null | undefined): project is ProjectRecord {
  return Boolean(
    project &&
      project.poolAddress &&
      /^0x[a-fA-F0-9]{40}$/.test(project.poolAddress) &&
      /^0x[a-fA-F0-9]{40}$/.test(project.tokenAddress) &&
      project.blockNumber &&
      project.blockNumber > 0
  );
}

function loadFromDisk(project: ProjectRecord): MarketIndex | null {
  const raw = readJson<MarketIndex | null>(fileFor(project.chainId, project.tokenAddress), null);
  if (!raw || raw.version !== FILE_VERSION) return null;
  // Berkas milik pasar lain atau peluncuran lain (alamat sama tidak mungkin, tapi blok bisa
  // berubah kalau registry dikoreksi): mulai dari nol daripada mewarisi saldo yang salah.
  if (raw.token !== lower(project.tokenAddress) || raw.curve !== lower(project.poolAddress!)) return null;
  if (raw.launchBlock !== Number(project.blockNumber)) return null;
  return raw;
}

function applyTransfer(index: MarketIndex, from: string, to: string, value: bigint): void {
  if (value === 0n) return;
  index.transfers += 1;
  if (from !== ZERO_ADDRESS) {
    const next = BigInt(index.balances[from] ?? "0") - value;
    if (next === 0n) delete index.balances[from];
    else index.balances[from] = next.toString();
  }
  if (to === ZERO_ADDRESS) {
    index.burnedToZero = (BigInt(index.burnedToZero) + value).toString();
  } else {
    index.balances[to] = (BigInt(index.balances[to] ?? "0") + value).toString();
  }
}

function applyLogs(index: MarketIndex, logs: ethers.Log[]): void {
  const ordered = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  for (const log of ordered) {
    const address = lower(log.address);
    const topic0 = log.topics[0];
    if (address === index.token && topic0 === TRANSFER_TOPIC && log.topics.length >= 3) {
      const value = log.data && log.data !== "0x" ? BigInt(log.data) : 0n;
      applyTransfer(index, topicAddress(log.topics[1]), topicAddress(log.topics[2]), value);
      continue;
    }
    if (address !== index.curve) continue;
    const iface = swapIfaceForTopic(topic0);
    if (!iface) continue;
    const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed || parsed.name !== "Swap") continue;
    const isBuy = Boolean(parsed.args.isBuy);
    const amountIn = BigInt(parsed.args.amountIn);
    const amountOut = BigInt(parsed.args.amountOut);
    const nativeAfterRaw = parsed.args.nativeReserveAfter ?? parsed.args.reserveNativeAfter;
    const tokenAfterRaw = parsed.args.tokenReserveAfter ?? parsed.args.reserveTokenAfter;
    let priceNativeAfter: number | null = null;
    if (nativeAfterRaw !== undefined && tokenAfterRaw !== undefined) {
      const tokenAfter = Number(ethers.formatUnits(BigInt(tokenAfterRaw), index.decimals));
      if (tokenAfter > 0) priceNativeAfter = Number(ethers.formatEther(BigInt(nativeAfterRaw))) / tokenAfter;
    }
    const id = `${log.transactionHash}_${log.index}`;
    if (index.swaps.some((s) => s.id === id)) continue;
    index.swaps.push({
      id,
      txHash: log.transactionHash,
      logIndex: log.index,
      blockNumber: log.blockNumber,
      time: null,
      isBuy,
      trader: lower(String(parsed.args.trader)),
      recipient: lower(String(parsed.args.recipient ?? parsed.args.trader)),
      amountNative: Number(ethers.formatEther(isBuy ? amountIn : amountOut)),
      amountToken: Number(ethers.formatUnits(isBuy ? amountOut : amountIn, index.decimals)),
      priceNativeAfter,
    });
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 400 * i * i));
    }
  }
  throw last;
}

/** Timestamp untuk swap yang belum punya. Yang gagal dibiarkan null dan dicoba pada pembaruan berikutnya. */
async function fillTimes(index: MarketIndex, provider: ethers.JsonRpcProvider): Promise<void> {
  const missing = [...new Set(index.swaps.filter((s) => s.time === null).map((s) => s.blockNumber))];
  const times = new Map<number, number>();
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(
      missing.slice(i, i + 8).map(async (blockNumber) => {
        try {
          const block = await withRetry(() => provider.getBlock(blockNumber), 2);
          if (block) times.set(blockNumber, Number(block.timestamp));
        } catch {
          // dicoba lagi nanti
        }
      })
    );
  }
  for (const s of index.swaps) if (s.time === null && times.has(s.blockNumber)) s.time = times.get(s.blockNumber)!;
}

async function runUpdate(project: ProjectRecord, slot: CacheSlot): Promise<void> {
  const chain: ChainInfo = resolveChainOrDefault(project.chainId);
  const logRpc = logReadProvider(chain);
  const file = fileFor(project.chainId, project.tokenAddress);

  let index = slot.index ?? loadFromDisk(project);
  if (!index) {
    let decimals = 18;
    try {
      const token = new ethers.Contract(project.tokenAddress, ERC20_ABI, readProvider(chain));
      decimals = Number(await withRetry(() => token.decimals(), 2));
    } catch {
      decimals = 18;
    }
    index = freshIndex(project, decimals);
  }
  slot.index = index;

  const head = await withRetry(() => logRpc.getBlockNumber());
  const safeHead = Math.max(index.launchBlock - 1, head - confirmationsFor(chain.chainId));
  const span = logSpanFor(chain.chainId);
  const parallel = PARALLEL_BY_CHAIN[chain.chainId] ?? DEFAULT_PARALLEL;
  index.head = head;

  let calls = 0;
  while (index.scannedTo < safeHead && calls < MAX_CALLS_PER_RUN) {
    const windows: Array<{ from: number; to: number }> = [];
    let cursor = index.scannedTo + 1;
    while (windows.length < parallel && cursor <= safeHead) {
      const to = Math.min(safeHead, cursor + span - 1);
      windows.push({ from: cursor, to });
      cursor = to + 1;
    }
    const results = await Promise.allSettled(
      windows.map((w) =>
        withRetry(() =>
          logRpc.getLogs({
            address: [index!.token, index!.curve],
            fromBlock: w.from,
            toBlock: w.to,
            topics: [[TRANSFER_TOPIC, ...SWAP_TOPICS]],
          })
        )
      )
    );
    calls += windows.length;
    // Diterapkan berurutan dan BERHENTI di petak gagal pertama: petak sesudahnya tidak boleh
    // diterapkan di atas lubang.
    let failed: string | null = null;
    for (let i = 0; i < windows.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        failed = String((r.reason as any)?.shortMessage ?? (r.reason as any)?.message ?? r.reason).slice(0, 200);
        break;
      }
      applyLogs(index, r.value);
      index.scannedTo = windows[i].to;
    }
    index.updatedAt = Date.now();
    writeJson(file, index, { compact: true });
    if (failed) throw new Error(failed);
  }

  await fillTimes(index, logRpc);
  index.updatedAt = Date.now();
  writeJson(file, index, { compact: true });
}

function statusOf(slot: CacheSlot, project: ProjectRecord): IndexStatus {
  const index = slot.index;
  const launchBlock = Number(project.blockNumber);
  if (!index) {
    return { complete: false, progress: 0, scannedTo: launchBlock - 1, head: launchBlock, launchBlock, updating: Boolean(slot.running), error: slot.error };
  }
  const confirmations = confirmationsFor(index.chainId);
  const total = Math.max(1, index.head - index.launchBlock + 1);
  const done = Math.max(0, index.scannedTo - index.launchBlock + 1);
  return {
    // Selisih kecil di atas jumlah konfirmasi masih dianggap utuh: kepala bergerak selama
    // pembaruan berjalan.
    complete: index.head - index.scannedTo <= confirmations + 2,
    progress: Math.min(1, done / total),
    scannedTo: index.scannedTo,
    head: index.head,
    launchBlock: index.launchBlock,
    updating: Boolean(slot.running),
    error: slot.error,
  };
}

/**
 * Pastikan indeks sebuah pasar cukup baru, lalu kembalikan keadaannya.
 *
 * Paling banyak satu pembaruan berjalan per pasar per proses; pemanggil lain menunggu
 * pembaruan yang sama. `waitMs` membatasi berapa lama pemanggil mau menunggu: pemindaian
 * awal Base bisa berjalan puluhan detik, dan permintaan HTTP tidak boleh tertahan selama
 * itu. Pembaruannya tetap berjalan sesudah pemanggil berhenti menunggu, dan pemanggil
 * berikutnya melihat kemajuannya.
 */
export async function ensureMarketIndex(
  project: ProjectRecord,
  opts: { maxAgeMs?: number; waitMs?: number } = {}
): Promise<{ index: MarketIndex | null; status: IndexStatus }> {
  const maxAgeMs = opts.maxAgeMs ?? 15_000;
  const waitMs = opts.waitMs ?? 4_000;
  const key = fileFor(project.chainId, project.tokenAddress);
  let slot = slots().get(key);
  if (!slot) {
    slot = { index: loadFromDisk(project), checkedAt: 0, running: null, error: null };
    slots().set(key, slot);
  }
  const current = slot;

  if (!current.running && Date.now() - current.checkedAt >= maxAgeMs) {
    current.checkedAt = Date.now();
    current.running = runUpdate(project, current)
      .then(() => {
        current.error = null;
      })
      .catch((error: any) => {
        current.error = String(error?.shortMessage ?? error?.message ?? error).slice(0, 200);
      })
      .finally(() => {
        current.running = null;
        current.checkedAt = Date.now();
      });
  }

  if (current.running && waitMs > 0) {
    await Promise.race([current.running, new Promise((r) => setTimeout(r, waitMs))]);
  }
  return { index: current.index, status: statusOf(current, project) };
}

/**
 * Swap dengan waktu yang selalu terisi: yang belum terbaca diperkirakan dari swap tetangga
 * yang waktunya diketahui (nomor blok naik searah waktu). Tanpa satu pun jangkar, swap itu
 * dilewati — waktu yang dikarang dari jam sekarang akan menaruh perdagangan lama di bar terkini.
 */
export function swapsWithTimes(index: MarketIndex): Array<IndexedSwap & { time: number }> {
  const anchors = index.swaps.filter((s) => s.time !== null).map((s) => [s.blockNumber, s.time!] as const);
  anchors.sort((a, b) => a[0] - b[0]);
  const out: Array<IndexedSwap & { time: number }> = [];
  for (const s of index.swaps) {
    if (s.time !== null) {
      out.push(s as IndexedSwap & { time: number });
      continue;
    }
    if (anchors.length === 0) continue;
    let lo = anchors[0];
    let hi = anchors[anchors.length - 1];
    for (const a of anchors) {
      if (a[0] <= s.blockNumber) lo = a;
      if (a[0] >= s.blockNumber) {
        hi = a;
        break;
      }
    }
    const time = lo[0] === hi[0] ? lo[1] : Math.round(lo[1] + ((s.blockNumber - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]));
    out.push({ ...s, time });
  }
  return out.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

/** Swap terindeks dalam bentuk `TradeEvent`, supaya bisa digabung dengan sumber lain. */
export function indexedTrades(index: MarketIndex, symbol: string, nativeSymbol: string): TradeEvent[] {
  return swapsWithTimes(index).map((s) => ({
    id: s.id,
    txHash: s.txHash,
    type: s.isBuy ? "BUY" : "SELL",
    symbol: symbol.toUpperCase(),
    amountToken: s.amountToken,
    amountNative: s.amountNative,
    nativeSymbol,
    priceNative: s.amountToken > 0 ? s.amountNative / s.amountToken : 0,
    priceNativeAfter: s.priceNativeAfter,
    trader: s.trader,
    recipient: s.recipient,
    timestamp: new Date(s.time * 1000).toISOString(),
    blockNumber: s.blockNumber,
    chainId: index.chainId,
    source: "onchain" as const,
  }));
}
