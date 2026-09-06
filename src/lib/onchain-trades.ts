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
import { SOVEREIGN_HOOK_ABI, SOVEREIGN_CURVE_ABI, ADEXTO_CURVE_ABI, ERC20_ABI } from "@/lib/dex";
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
 * TIGA generasi pool memancarkan event bernama sama tapi bertanda tangan BEDA:
 * SovereignHook punya `lpFee, treasuryFee`; SovereignCurve memecahnya menjadi
 * `depthFee, creatorFee, treasuryFee`; AdextoCurve 0.11.0 menambah `protocolFee`
 * lagi. Satu parameter tambahan berarti topic0 yang sama sekali lain, jadi
 * memfilter dengan ABI generasi lama saja membuat pool generasi baru tampak tidak
 * pernah diperdagangkan: chart jadi garis datar dan feed kosong, padahal swap
 * benar-benar terjadi.
 *
 * Itu bug yang sudah pernah terjadi waktu kurva menggantikan hook. Karena itu
 * daftar ini DITAMBAH, bukan diganti: enam pasar 0.10.0 dan pasar hook lama tetap
 * harus bisa didekode selamanya, sebab bytecode-nya sudah di chain dan tidak bisa
 * diubah.
 *
 * Empat field yang dipakai di bawah (trader, isBuy, amountIn, amountOut) ada di
 * ketiga tanda tangan pada posisi yang sama. Yang BERGESER posisinya adalah kedua
 * reserve — indeks 7 di hook, 8 di kurva 0.10.0, 9 di 0.11.0 — jadi pembacaannya
 * di bawah lewat nama field, bukan indeks.
 */
const SWAP_IFACES = [
  new ethers.Interface(ADEXTO_CURVE_ABI),
  new ethers.Interface(SOVEREIGN_CURVE_ABI),
  new ethers.Interface(SOVEREIGN_HOOK_ABI),
];
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
       * The pool generations name these fields differently AND place them at
       * different positions — the hook emits `reserveNativeAfter` at index 7, the
       * 0.10.0 curve emits `nativeReserveAfter` at index 8, and 0.11.0 pushes the
       * same pair to index 9 to make room for `protocolFee`. Reading by NAME rather
       * than by index is what keeps this working across all three; a positional read
       * would silently start plotting a fee as a reserve.
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
  /**
   * Jendela TIDAK BOLEH menghanyutkan seluruh datanya.
   *
   * `nowBucket` mengambil yang lebih baru antara jam dinding dan perdagangan terakhir,
   * lalu jendelanya dihitung `bucketCount` bucket ke belakang. Pada bucket besar itu
   * tidak pernah jadi masalah, tapi pada bucket sub-menit jendelanya menjadi pendek
   * dalam satuan WAKTU: 1.800 bucket × 1 detik hanya menjangkau 30 menit.
   *
   * Terbukti di produksi, bukan di teori: pasar $NOVA991 yang berdagang ~30 menit lalu
   * mengembalikan 14 bar pada 15 detik tetapi NOL bar pada 5 dan 1 detik. Semua
   * perdagangannya jatuh sedikit di luar tepi jendela, dan chart-nya kosong tanpa satu
   * pun pesan yang menjelaskan.
   *
   * Jadi kalau jendela berbasis jam dinding tidak memuat satu perdagangan pun, ujungnya
   * dipindah ke perdagangan TERAKHIR. Chart lalu memperlihatkan riwayat terakhir yang
   * memang ada alih-alih kosong. Ini tidak membohongi sumbu waktu: labelnya tetap waktu
   * asli tiap bar, yang berubah hanya bagian mana dari riwayat yang ditampilkan.
   */
  const wallStart = wallBucket - (bucketCount - 1) * bucketSeconds;
  const adaDiJendelaJam = ordered.some(({ seconds }) => {
    const b = Math.floor(seconds / bucketSeconds) * bucketSeconds;
    return b >= wallStart && b <= wallBucket;
  });
  const nowBucket = adaDiJendelaJam ? Math.max(wallBucket, newestBucket) : newestBucket;
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

  /**
   * Ekor bucket kosong DIBATASI, supaya bar datar tidak menenggelamkan datanya.
   *
   * Bucket kosong sesudah perdagangan terakhir diisi datar sampai `nowBucket`, dan
   * `nowBucket` mengikuti jam yang terus berjalan — jadi ekornya bertambah selamanya
   * selama tidak ada yang trading. Terukur pada $NOVA991: 13 candle menjadi 29 dalam 40
   * menit tanpa satu pun perdagangan baru, dan ketiga candle nyata terhimpit menjadi
   * sesobek di tepi kiri. Dari layar itu terlihat seperti chart bergerak sendiri,
   * padahal harga tiap fill sama sekali tidak berubah.
   *
   * Pada bucket sub-menit efeknya jauh lebih parah: satu bucket per detik berarti 87 bar
   * kosong untuk 5 bar berisi.
   *
   * Ekornya karena itu dibatasi selebar rentang yang benar-benar diperdagangkan — jadi
   * paling banyak separuh chart berisi "belum ada aktivitas lagi", dan sisanya data.
   * Minimum 2 bar supaya bar terkini tetap ada dan jeda terbaru tetap terlihat.
   *
   * Yang TIDAK dibatasi: bucket kosong DI ANTARA dua perdagangan. Jeda di tengah adalah
   * fakta tentang waktu, dan memangkasnya akan memampatkan sumbu waktu sehingga jarak
   * antar-fill jadi bohong.
   */
  const lastFilled = filledBuckets[filledBuckets.length - 1];
  const tradedBars = (lastFilled - filledBuckets[0]) / bucketSeconds + 1;
  const maxTrailing = Math.max(2, Math.ceil(tradedBars));
  const endBucket = Math.min(nowBucket, lastFilled + maxTrailing * bucketSeconds);

  for (let bucket = filledBuckets[0]; bucket <= endBucket; bucket += bucketSeconds) {
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
