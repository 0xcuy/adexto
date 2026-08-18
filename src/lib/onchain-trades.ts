/**
 * Real trade history read straight from the SovereignHook `Swap` events.
 *
 * Before this, the chart and the trade feed were fed only by a hand-written
 * telemetry file. A brand new token therefore had zero data, which produced 31
 * identical candles (open = high = low = close) and an empty feed. When telemetry
 * did exist its timestamps were older than the newest candle, so
 * `series.update()` threw and the exception was swallowed — the "realtime" chart
 * silently never moved.
 */
import { ethers } from "ethers";
import type { ChainInfo } from "@/lib/chains";
import { SOVEREIGN_HOOK_ABI, ERC20_ABI } from "@/lib/dex";
import type { TradeEvent } from "@/lib/telemetry";

const LOOKBACK_BLOCKS = 45_000;
const CACHE_TTL_MS = 15_000;

interface CacheEntry {
  at: number;
  trades: TradeEvent[];
}

declare global {
  var __ADEXTO_SWAP_CACHE__: Map<string, CacheEntry> | undefined;
}

function cache(): Map<string, CacheEntry> {
  if (!globalThis.__ADEXTO_SWAP_CACHE__) globalThis.__ADEXTO_SWAP_CACHE__ = new Map();
  return globalThis.__ADEXTO_SWAP_CACHE__;
}

export async function readOnChainSwaps(
  chain: ChainInfo,
  poolAddress: string,
  symbol: string,
  limit = 60
): Promise<TradeEvent[]> {
  if (!poolAddress || !/^0x[a-fA-F0-9]{40}$/.test(poolAddress)) return [];

  const key = `${chain.chainId}:${poolAddress.toLowerCase()}`;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.trades.slice(0, limit);

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const pool = new ethers.Contract(poolAddress, SOVEREIGN_HOOK_ABI, provider);

    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - LOOKBACK_BLOCKS);
    const logs = await pool.queryFilter(pool.filters.Swap(), fromBlock, latest);

    let decimals = 18;
    try {
      const tokenAddress: string = await pool.targetToken();
      decimals = Number(await new ethers.Contract(tokenAddress, ERC20_ABI, provider).decimals());
    } catch {
      decimals = 18;
    }

    const recent = logs.slice(-limit).reverse();
    const blockTimes = new Map<number, number>();
    await Promise.all(
      [...new Set(recent.map((l) => l.blockNumber))].map(async (blockNumber) => {
        try {
          const block = await provider.getBlock(blockNumber);
          if (block) blockTimes.set(blockNumber, Number(block.timestamp));
        } catch {
          // ignore, fall back to null timestamp below
        }
      })
    );

    const trades: TradeEvent[] = [];
    for (const log of recent) {
      const parsed = pool.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "Swap") continue;

      const isBuy = Boolean(parsed.args.isBuy);
      const amountIn = BigInt(parsed.args.amountIn);
      const amountOut = BigInt(parsed.args.amountOut);

      const amountNative = Number(ethers.formatEther(isBuy ? amountIn : amountOut));
      const amountToken = Number(ethers.formatUnits(isBuy ? amountOut : amountIn, decimals));
      const seconds = blockTimes.get(log.blockNumber);

      trades.push({
        id: `${log.transactionHash}_${log.index}`,
        txHash: log.transactionHash,
        type: isBuy ? "BUY" : "SELL",
        symbol: symbol.toUpperCase(),
        amountToken,
        amountNative,
        nativeSymbol: chain.nativeSymbol,
        priceNative: amountToken > 0 ? amountNative / amountToken : 0,
        trader: String(parsed.args.trader),
        timestamp: new Date((seconds ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        blockNumber: log.blockNumber,
        source: "onchain",
        chainId: chain.chainId,
      });
    }

    cache().set(key, { at: Date.now(), trades });
    return trades;
  } catch {
    return [];
  }
}

/**
 * Aggregate trades into OHLC candles.
 * Always returns strictly increasing bucket times so lightweight-charts never
 * receives an out-of-order update.
 */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function buildCandles(
  trades: Array<{ timestamp: string; priceNative: number; amountNative: number }>,
  opts: { bucketSeconds?: number; buckets?: number; fallbackPrice: number }
): Candle[] {
  const bucketSeconds = opts.bucketSeconds ?? 300;
  const bucketCount = opts.buckets ?? 48;
  const nowBucket = Math.floor(Date.now() / 1000 / bucketSeconds) * bucketSeconds;
  const startBucket = nowBucket - (bucketCount - 1) * bucketSeconds;

  const byBucket = new Map<number, Array<{ price: number; volume: number }>>();
  for (const trade of trades) {
    const seconds = Math.floor(Date.parse(trade.timestamp) / 1000);
    if (!Number.isFinite(seconds) || trade.priceNative <= 0) continue;
    const bucket = Math.floor(seconds / bucketSeconds) * bucketSeconds;
    if (bucket < startBucket || bucket > nowBucket) continue;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push({ price: trade.priceNative, volume: trade.amountNative || 0 });
  }

  const candles: Candle[] = [];
  let last = opts.fallbackPrice > 0 ? opts.fallbackPrice : 0;

  // Seed from the oldest observed fill so the series does not open on a flat line.
  const oldest = [...byBucket.keys()].sort((a, b) => a - b)[0];
  if (oldest !== undefined) {
    const first = byBucket.get(oldest)!;
    last = first[0].price;
  }

  for (let bucket = startBucket; bucket <= nowBucket; bucket += bucketSeconds) {
    const fills = byBucket.get(bucket);
    if (!fills || fills.length === 0) {
      if (last <= 0) continue;
      candles.push({ time: bucket, open: last, high: last, low: last, close: last, volume: 0 });
      continue;
    }
    const prices = fills.map((f) => f.price);
    const open = last > 0 ? last : prices[0];
    const close = prices[prices.length - 1];
    candles.push({
      time: bucket,
      open,
      high: Math.max(open, ...prices),
      low: Math.min(open, ...prices),
      close,
      volume: fills.reduce((sum, f) => sum + f.volume, 0),
    });
    last = close;
  }

  return candles;
}
