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
import { SOVEREIGN_HOOK_ABI, SOVEREIGN_CURVE_ABI, ERC20_ABI } from "@/lib/dex";
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

/**
 * Dua generasi pool memancarkan event bernama sama tapi bertanda tangan BEDA:
 * SovereignHook punya `lpFee, treasuryFee` sedangkan SovereignCurve memecahnya
 * menjadi `depthFee, creatorFee, treasuryFee`. Satu parameter tambahan berarti
 * topic0 yang sama sekali lain, jadi memfilter dengan ABI hook saja membuat pool
 * kurva tampak tidak pernah diperdagangkan: chart jadi garis datar dan feed
 * kosong, padahal swap benar-benar terjadi.
 *
 * Empat field yang dipakai di bawah (trader, isBuy, amountIn, amountOut) ada di
 * kedua tanda tangan pada posisi yang sama, jadi cukup memilih interface yang
 * cocok dengan topic0 tiap log.
 */
const SWAP_IFACES = [new ethers.Interface(SOVEREIGN_CURVE_ABI), new ethers.Interface(SOVEREIGN_HOOK_ABI)];
const SWAP_TOPICS = SWAP_IFACES.map((iface) => iface.getEvent("Swap")!.topicHash);
const ifaceForTopic = (topic0: string) => SWAP_IFACES[SWAP_TOPICS.indexOf(topic0)];

/**
 * @param limit How many of the most recent swaps to decode. Raised from 60 because
 *        the indicators need history to exist at all: RSI(14) needs 15 candles,
 *        MACD(12,26,9) needs 34 and SMA(50) needs 50, so a 60-trade window could
 *        leave the longer ones permanently warming up on a real market.
 */
export async function readOnChainSwaps(
  chain: ChainInfo,
  poolAddress: string,
  symbol: string,
  limit = 400
): Promise<TradeEvent[]> {
  if (!poolAddress || !/^0x[a-fA-F0-9]{40}$/.test(poolAddress)) return [];

  const key = `${chain.chainId}:${poolAddress.toLowerCase()}`;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.trades.slice(0, limit);

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const pool = new ethers.Contract(poolAddress, SOVEREIGN_CURVE_ABI, provider);

    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - LOOKBACK_BLOCKS);
    // topic0 sebagai daftar = OR, jadi satu panggilan menangkap swap kurva maupun hook.
    const logs = await provider.getLogs({
      address: poolAddress,
      fromBlock,
      toBlock: latest,
      topics: [SWAP_TOPICS],
    });

    let decimals = 18;
    try {
      const tokenAddress: string = await pool.targetToken();
      decimals = Number(await new ethers.Contract(tokenAddress, ERC20_ABI, provider).decimals());
    } catch {
      decimals = 18;
    }

    const recent = logs.slice(-limit).reverse();

    /**
     * Block timestamps, fetched with a concurrency cap.
     *
     * One `getBlock` per unique block is unavoidable — the log carries no timestamp
     * — but firing all of them at once is what breaks first when the trade limit is
     * raised to give the indicators enough history. Public RPCs rate-limit or drop
     * a few hundred simultaneous calls, and a dropped block time silently becomes
     * `Date.now()` below, which would place an old trade in the newest bucket and
     * distort every indicator computed from it. Batches of 20 keep it well inside
     * what public endpoints tolerate.
     */
    const blockTimes = new Map<number, number>();
    const uniqueBlocks = [...new Set(recent.map((l) => l.blockNumber))];
    const BLOCK_BATCH = 20;
    for (let i = 0; i < uniqueBlocks.length; i += BLOCK_BATCH) {
      await Promise.all(
        uniqueBlocks.slice(i, i + BLOCK_BATCH).map(async (blockNumber) => {
          try {
            const block = await provider.getBlock(blockNumber);
            if (block) blockTimes.set(blockNumber, Number(block.timestamp));
          } catch {
            // ignore, fall back below
          }
        })
      );
    }

    const trades: TradeEvent[] = [];
    for (const log of recent) {
      const iface = ifaceForTopic(log.topics[0]);
      if (!iface) continue;
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "Swap") continue;

      const isBuy = Boolean(parsed.args.isBuy);
      const amountIn = BigInt(parsed.args.amountIn);
      const amountOut = BigInt(parsed.args.amountOut);

      const amountNative = Number(ethers.formatEther(isBuy ? amountIn : amountOut));
      const amountToken = Number(ethers.formatUnits(isBuy ? amountOut : amountIn, decimals));
      const seconds = blockTimes.get(log.blockNumber);

      /**
       * The curve's true spot price after this trade, from the event's own
       * post-trade reserves: spot = nativeReserveAfter / tokenReserveAfter, the
       * same expression as `spotPriceNativePerToken()`.
       *
       * This exists because `amountNative / amountToken` is an EXECUTION price
       * that includes fees asymmetrically, so plotting it makes a buy-only curve
       * look like it moves when the market price only ever rose.
       *
       * The two pool generations name these fields differently AND place them at
       * different positions — the hook emits `reserveNativeAfter` at index 7, the
       * curve emits `nativeReserveAfter` at index 8 — so both names are read.
       */
      const nativeAfterRaw = parsed.args.nativeReserveAfter ?? parsed.args.reserveNativeAfter;
      const tokenAfterRaw = parsed.args.tokenReserveAfter ?? parsed.args.reserveTokenAfter;
      let priceNativeAfter: number | null = null;
      if (nativeAfterRaw !== undefined && tokenAfterRaw !== undefined) {
        const nativeAfter = Number(ethers.formatEther(BigInt(nativeAfterRaw)));
        const tokenAfter = Number(ethers.formatUnits(BigInt(tokenAfterRaw), decimals));
        if (tokenAfter > 0) priceNativeAfter = nativeAfter / tokenAfter;
      }

      trades.push({
        id: `${log.transactionHash}_${log.index}`,
        txHash: log.transactionHash,
        type: isBuy ? "BUY" : "SELL",
        symbol: symbol.toUpperCase(),
        amountToken,
        amountNative,
        nativeSymbol: chain.nativeSymbol,
        priceNative: amountToken > 0 ? amountNative / amountToken : 0,
        priceNativeAfter,
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

/**
 * Aggregate trades into OHLC candles.
 *
 * WHY THIS SORTS, AND WHY IT PLOTS THE POST-TRADE SPOT PRICE
 *
 * Two bugs used to combine here to make a brand new token appear to dump on a
 * curve where dumping is arithmetically impossible.
 *
 * First, order. `readOnChainSwaps` returns NEWEST-FIRST (it reverses the logs so
 * the trade feed reads top-down), and `listTrades` sorts descending too. This
 * function consumed that array as if it were chronological, so within a bucket
 * `prices[0]` was the newest fill and `prices[length - 1]` was the oldest. It then
 * set `open` from the newest and `close` from the oldest — on a rising curve that
 * is open=high, close=low, i.e. a red candle for every bucket, and a series that
 * marches downward no matter how much buying happened. Order is now established
 * here by timestamp rather than trusted from the caller, so it cannot be broken
 * again by a caller changing its own sort.
 *
 * Second, which price. A fill's `priceNative` is an EXECUTION price and is
 * fee-inclusive asymmetrically: a buy's input is gross of fees so its print sits
 * above the curve, a sell's output is net so its print sits below. Mixing both
 * into one series manufactures movement that the market price never made. Where
 * the `Swap` event gave us post-trade reserves we plot `priceNativeAfter`, the
 * curve's actual spot price at that block, which rises on every buy and falls only
 * on a sell — and which equals the spot price the trade panel shows, so the chart
 * and the panel stop disagreeing.
 *
 * Pre-history is no longer invented. Buckets before the first real fill used to be
 * emitted as flat candles at the seed price, which drew a long horizontal line at
 * a price that had never traded and then dropped into the first real bucket. The
 * series now starts at the first fill. The one price legitimately available before
 * any trade is the curve's opening spot (`virtualNative / supply`), and that is
 * used only as the first candle's `open`, because the curve really did stand there.
 */
export function buildCandles(
  trades: Array<{
    timestamp: string;
    priceNative: number;
    priceNativeAfter?: number | null;
    amountNative: number;
    blockNumber?: number | null;
  }>,
  opts: { bucketSeconds?: number; buckets?: number; fallbackPrice: number }
): Candle[] {
  const bucketSeconds = opts.bucketSeconds ?? 300;
  const bucketCount = opts.buckets ?? 48;

  // Chronological, oldest first. Block number breaks ties inside a shared
  // timestamp: several swaps can land in one block, and on fast chains many blocks
  // share a second.
  const ordered = trades
    .map((trade) => ({ trade, seconds: Math.floor(Date.parse(trade.timestamp) / 1000) }))
    .filter(({ trade, seconds }) => {
      const price = trade.priceNativeAfter ?? trade.priceNative;
      return Number.isFinite(seconds) && Number.isFinite(price) && price > 0;
    })
    .sort((a, b) => a.seconds - b.seconds || (a.trade.blockNumber ?? 0) - (b.trade.blockNumber ?? 0));

  /**
   * The upper bound follows the DATA, not just this server's clock.
   *
   * Trade times come from block timestamps while `Date.now()` is the server's
   * clock, and the two are not the same clock. Using the wall clock alone silently
   * discarded any trade dated ahead of it — which happens for real on an L2 whose
   * sequencer timestamp runs a little fast, and happens dramatically on a devchain
   * where time is advanced deliberately. The newest fill would just vanish from the
   * chart with no error anywhere. Taking the later of the two means a genuine trade
   * is never dropped for disagreeing with our clock.
   */
  const wallBucket = Math.floor(Date.now() / 1000 / bucketSeconds) * bucketSeconds;
  const newestSeconds = ordered.length > 0 ? ordered[ordered.length - 1].seconds : 0;
  const newestBucket = Math.floor(newestSeconds / bucketSeconds) * bucketSeconds;
  const nowBucket = Math.max(wallBucket, newestBucket);
  const startBucket = nowBucket - (bucketCount - 1) * bucketSeconds;

  const byBucket = new Map<number, Array<{ price: number; volume: number }>>();
  for (const { trade, seconds } of ordered) {
    const bucket = Math.floor(seconds / bucketSeconds) * bucketSeconds;
    if (bucket < startBucket || bucket > nowBucket) continue;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push({
      price: (trade.priceNativeAfter ?? trade.priceNative) as number,
      volume: trade.amountNative || 0,
    });
  }

  const filledBuckets = [...byBucket.keys()].sort((a, b) => a - b);
  if (filledBuckets.length === 0) return [];

  const candles: Candle[] = [];
  // The curve's opening price is a real level, so the first candle may open there.
  // Anything else would open the first candle on its own close and hide the very
  // first move.
  let last = opts.fallbackPrice > 0 ? opts.fallbackPrice : 0;

  for (let bucket = filledBuckets[0]; bucket <= nowBucket; bucket += bucketSeconds) {
    const fills = byBucket.get(bucket);
    if (!fills || fills.length === 0) {
      // A gap after trading has begun is genuine: the price did not move because
      // nobody traded. Flat is the truth here.
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
