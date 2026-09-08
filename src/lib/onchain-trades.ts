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

/**
 * Lebar rentang `getLogs` yang benar-benar diterima tiap RPC publik. DIUKUR, bukan
 * disalin dari dokumentasi.
 *
 * Angka ini menggantikan satu konstanta `LOOKBACK_BLOCKS = 45_000` yang dipakai untuk
 * SEMUA chain, dan konstanta itu rusak dalam dua arah sekaligus:
 *
 * 1. Sebagai jendela, 45.000 blok bukan satuan waktu. Terukur: 1,052 s/blok di 0G
 *    (13,2 jam), 2,000 di Base (25,0 jam), 0,251 di Arbitrum (3,1 jam), 0,302 di
 *    Monad (3,8 jam). Jadi "riwayat" yang ditampilkan berarti empat hal berbeda
 *    tergantung chain, dan di 0G perdagangan kemarin jatuh keluar dari feed.
 * 2. Sebagai permintaan, 45.000 blok DITOLAK di dua dari empat chain. Terukur: Base
 *    menolak di 20.000 dengan 413 Payload Too Large, Monad menolak di 200. Karena
 *    seluruh badan fungsi ini dibungkus `try` yang mengembalikan array kosong, dua
 *    chain itu tidak menampilkan "RPC menolak kueri" melainkan "belum ada
 *    perdagangan" — kegagalan yang tidak bisa dibedakan dari pasar yang benar-benar
 *    kosong.
 *
 * Nilai di bawah diberi margin dari yang terukur lolos: 0G dan Arbitrum lolos sampai
 * 2.000.000, Base lolos di 10.000, Monad di 100. Chain tanpa entri memakai 10.000,
 * yang terbukti diterima di keempat RPC yang diuji kecuali Monad.
 */
const LOG_SPAN_BY_CHAIN: Record<number, number> = {
  16661: 500_000, // 0G mainnet
  8453: 10_000, // Base
  42161: 500_000, // Arbitrum
  143: 100, // Monad
};
const DEFAULT_LOG_SPAN = 10_000;

/**
 * Anggaran panggilan `getLogs` per pembacaan.
 *
 * Penelusuran ke belakang harus punya batas, kalau tidak Monad — yang hanya menerima
 * 100 blok per panggilan, yaitu sekitar 30 detik riwayat — akan mencoba ribuan
 * panggilan untuk satu kali muat halaman.
 *
 * Konsekuensinya diterima dengan sadar dan DILAPORKAN, bukan disembunyikan: pada chain
 * berpetak sempit, riwayat yang terbaca memang pendek, dan `coverage.reachedLaunch`
 * menyatakannya supaya UI tidak menyiratkan pasarnya lahir di sana. Indexer adalah
 * jawaban sebenarnya untuk chain seperti itu; subgraph sudah hidup di Base dan Arbitrum
 * tetapi belum dibaca di sini, dan 0G tidak punya subgraph sama sekali.
 */
const MAX_LOG_CALLS = 16;
const CACHE_TTL_MS = 15_000;

/** Sejauh mana pembacaan benar-benar menjangkau. Tanpa ini, terpotong tidak terlihat. */
export interface SwapCoverage {
  /** Blok tertua yang BENAR-BENAR dipindai. */
  fromBlock: number | null;
  toBlock: number | null;
  /** Penelusuran mencapai blok peluncuran pasar, jadi riwayatnya utuh. */
  reachedLaunch: boolean;
  /** Berhenti karena anggaran atau batas jumlah, bukan karena riwayat habis. */
  truncated: boolean;
  blocksScanned: number;
  calls: number;
  /**
   * Pesan kalau RPC menolak. Dipisahkan dari "nol perdagangan" dengan sengaja: dua
   * keadaan itu terlihat sama di UI selama satu tahun dan itulah cacatnya.
   */
  error: string | null;
}

export interface SwapReadResult {
  trades: TradeEvent[];
  coverage: SwapCoverage;
}

interface CacheEntry {
  at: number;
  result: SwapReadResult;
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

const emptyCoverage = (error: string | null = null): SwapCoverage => ({
  fromBlock: null,
  toBlock: null,
  reachedLaunch: false,
  truncated: false,
  blocksScanned: 0,
  calls: 0,
  error,
});

/**
 * @param limit How many of the most recent swaps to decode. Raised from 60 because
 *        the indicators need history to exist at all: RSI(14) needs 15 candles,
 *        MACD(12,26,9) needs 34 and SMA(50) needs 50, so a 60-trade window could
 *        leave the longer ones permanently warming up on a real market.
 * @param launchBlock Blok tempat pasar ini LAHIR — `ProjectRecord.blockNumber`, yaitu
 *        blok receipt peluncuran. Token dan kurvanya dibuat dalam satu transaksi
 *        factory, jadi tidak ada `Swap` yang bisa ada sebelum blok itu. Dipakai sebagai
 *        DASAR penelusuran, dan itu yang membuat "riwayat utuh" bisa dinyatakan sebagai
 *        fakta, bukan harapan: begitu dasar tercapai, tidak ada lagi yang bisa terlewat.
 *        `null` untuk catatan lama yang tidak menyimpannya; penelusuran lalu jatuh ke
 *        anggaran panggilan dan `reachedLaunch` tetap `false` karena memang tidak
 *        terbukti.
 */
export async function readOnChainSwaps(
  chain: ChainInfo,
  poolAddress: string,
  symbol: string,
  limit = 400,
  launchBlock: number | null = null
): Promise<SwapReadResult> {
  if (!poolAddress || !/^0x[a-fA-F0-9]{40}$/.test(poolAddress)) {
    return { trades: [], coverage: emptyCoverage("Pool address is not a valid contract address.") };
  }

  const key = `${chain.chainId}:${poolAddress.toLowerCase()}:${launchBlock ?? "nolaunch"}`;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { trades: hit.result.trades.slice(0, limit), coverage: hit.result.coverage };
  }

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const pool = new ethers.Contract(poolAddress, SOVEREIGN_CURVE_ABI, provider);

    const latest = await provider.getBlockNumber();
    const span = LOG_SPAN_BY_CHAIN[chain.chainId] ?? DEFAULT_LOG_SPAN;

    /**
     * Dasar penelusuran. Blok peluncuran kalau diketahui, kalau tidak sejauh anggaran.
     *
     * Dengan blok peluncuran, penelusuran berhenti karena riwayatnya HABIS. Tanpa itu,
     * ia berhenti karena anggarannya habis — keadaan yang sama sekali berbeda, dan
     * `reachedLaunch` di bawah membedakan keduanya.
     */
    const floor = Math.max(0, launchBlock && launchBlock > 0 ? launchBlock : latest - span * MAX_LOG_CALLS);

    /**
     * Berjalan MUNDUR dari kepala, bukan satu kueri lebar.
     *
     * Mundur karena yang paling dibutuhkan adalah perdagangan terbaru: kalau anggaran
     * habis, yang hilang adalah bagian tertua, bukan yang paling penting. Satu kueri
     * lebar tidak mungkin lagi begitu petaknya 100 blok di Monad.
     */
    const collected: ethers.Log[] = [];
    let to = latest;
    let calls = 0;
    let reachedLaunch = false;
    let oldestScanned = latest;

    while (to >= floor && calls < MAX_LOG_CALLS) {
      const from = Math.max(floor, to - span + 1);
      // topic0 sebagai daftar = OR, jadi satu panggilan menangkap swap kurva maupun hook.
      const batch = await provider.getLogs({
        address: poolAddress,
        fromBlock: from,
        toBlock: to,
        topics: [SWAP_TOPICS],
      });
      collected.unshift(...batch);
      calls += 1;
      oldestScanned = from;
      if (from <= floor) {
        // Hanya boleh disebut mencapai peluncuran kalau dasarnya MEMANG blok peluncuran.
        reachedLaunch = Boolean(launchBlock && launchBlock > 0);
        break;
      }
      // Cukup ketika sudah memenuhi `limit`: sisanya akan dipangkas juga di bawah, jadi
      // memindainya hanya membebani RPC tanpa menambah satu pun baris yang tampil.
      if (collected.length >= limit) break;
      to = from - 1;
    }

    const logs = collected;
    const truncated = !reachedLaunch;

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

    const result: SwapReadResult = {
      trades,
      coverage: {
        fromBlock: oldestScanned,
        toBlock: latest,
        reachedLaunch,
        truncated,
        blocksScanned: Math.max(0, latest - oldestScanned + 1),
        calls,
        error: null,
      },
    };
    cache().set(key, { at: Date.now(), result });
    return { trades: result.trades.slice(0, limit), coverage: result.coverage };
  } catch (error: any) {
    /**
     * Kegagalan RPC DILAPORKAN, tidak lagi menjadi array kosong.
     *
     * Dulu blok ini `catch { return [] }`, dan itu membuat dua keadaan yang sangat
     * berbeda terlihat persis sama di UI: "pasar ini belum pernah diperdagangkan" dan
     * "RPC menolak kueri kita". Yang kedua benar-benar terjadi di Base dan Monad pada
     * setiap pembacaan, karena kode meminta 45.000 blok sementara Base menolak di
     * 20.000 dan Monad di 200 — jadi kedua chain itu melaporkan pasar kosong selama
     * ini, dan tidak ada yang bisa membedakannya dari kebenaran.
     */
    const message = String(error?.shortMessage ?? error?.message ?? error);
    return { trades: [], coverage: emptyCoverage(message.slice(0, 200)) };
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
  /**
   * Batas atas ekor adalah JAM DINDING, bukan `nowBucket`.
   *
   * `nowBucket` jatuh ke bucket perdagangan terakhir begitu tidak ada satu pun
   * perdagangan di dalam jendela jam dinding. Memakainya sebagai batas ekor membuat
   * `min()` selalu memilih `lastFilled`, jadi ekornya NOL — dan seluruh perhitungan
   * `maxTrailing` di atas mati tanpa jejak persis pada keadaan yang paling
   * membutuhkannya, yaitu pasar yang sedang sepi.
   *
   * Akibatnya bentuk chart berubah sendiri tanpa ada yang trading. Terukur pada seri
   * $ADEXTO ini: satu jam setelah fill terakhir, 20 candle menjadi 10 — dan karena 10
   * ada di bawah `MIN_BARS_TO_FIT`, chart beralih dari `fitContent()` ke jendela
   * dipatok, sehingga barnya mengerut ke 42% kiri pane. Tidak ada perdagangan baru,
   * tidak ada kode yang berjalan; hanya jam yang maju.
   *
   * `Math.max(wallBucket, lastFilled)` menjaga kasus data yang MENDAHULUI jam server —
   * sequencer L2 yang berjalan sedikit cepat, dan devchain yang timestamp-nya jauh di
   * depan. Tanpa itu batas ekor bisa jatuh sebelum fill terakhir dan candle terbaru
   * hilang dari loop di bawah.
   */
  const tailCeiling = Math.max(wallBucket, lastFilled);
  const endBucket = Math.min(tailCeiling, lastFilled + maxTrailing * bucketSeconds);

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
