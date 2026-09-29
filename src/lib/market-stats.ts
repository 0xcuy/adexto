/**
 * Statistik pasar untuk strip di atas chart: perubahan harga 5m/1h/6h/24h, volume 24 jam,
 * jumlah beli/jual, dan trader unik.
 *
 * Murni — tanpa jaringan dan tanpa disk — supaya bisa diuji dengan angka yang dihitung tangan.
 * Pemanggil memberi kurs lewat fungsi, bukan modul ini yang membacanya.
 *
 * DUA KEPUTUSAN YANG MEMBENTUK ANGKANYA
 *
 * 1. Harga pada saat T adalah harga spot kurva SESUDAH perdagangan terakhir sebelum T, bukan
 *    rata-rata dan bukan interpolasi. Pada kurva, harga hanya bergerak saat ada yang berdagang,
 *    jadi di antara dua perdagangan harganya memang datar. Sebelum perdagangan pertama, harganya
 *    harga pembukaan kurva — kurva benar-benar berdiri di sana sejak peluncuran.
 * 2. Perubahan USD memakai kurs yang DIREKAM pada saat T, bukan kurs sekarang. Kalau kursnya
 *    tidak terekam, perubahan USD null dan UI menampilkan perubahan native saja — bukan angka
 *    dolar dari kurs yang salah zaman.
 */

export type StatsWindow = "5m" | "1h" | "6h" | "24h";

export const STATS_WINDOWS: Array<{ key: StatsWindow; seconds: number }> = [
  { key: "5m", seconds: 300 },
  { key: "1h", seconds: 3_600 },
  { key: "6h", seconds: 21_600 },
  { key: "24h", seconds: 86_400 },
];

export interface WindowChange {
  /** Persen dalam aset native, atau null bila harga di awal jendela tidak diketahui. */
  native: number | null;
  /** Persen dalam dolar, atau null bila kurs di salah satu ujung tidak terekam. */
  usd: number | null;
}

export interface MarketStats {
  asOf: number;
  /**
   * Riwayat yang dipakai TERBUKTI menutup 24 jam penuh. Kalau false, volume dan hitungan di
   * bawah adalah batas bawah, dan UI wajib mengatakannya.
   */
  complete: boolean;
  priceNative: number;
  change: Record<StatsWindow, WindowChange>;
  volume24h: { native: number; usd: number | null };
  buys24h: number;
  sells24h: number;
  traders24h: number;
}

export interface StatsTrade {
  type: string;
  timestamp: string;
  amountNative: number;
  priceNative: number;
  priceNativeAfter?: number | null;
  trader: string;
  recipient?: string | null;
  blockNumber?: number | null;
}

/** Alamat yang benar-benar memegang hasilnya: penerima token untuk beli, penjual untuk jual. */
export function tradeWallet(t: Pick<StatsTrade, "type" | "trader" | "recipient">): string {
  const who = t.type === "BUY" ? t.recipient || t.trader : t.trader;
  return (who || "").toLowerCase();
}

const pct = (now: number, then: number): number | null => (then > 0 && now > 0 ? (now / then - 1) * 100 : null);

export function computeMarketStats(input: {
  trades: StatsTrade[];
  /** Harga pembukaan kurva (registry). */
  openingPrice: number;
  /** Detik peluncuran, bila diketahui. Kurs untuk "sebelum peluncuran" dibaca pada detik ini. */
  launchedAt: number | null;
  nowSeconds: number;
  fxNow: number | null;
  fxAt: (seconds: number) => number | null;
  /** Sumber riwayatnya sendiri sudah membuktikan riwayat utuh sejak peluncuran. */
  historyComplete: boolean;
}): MarketStats {
  const ordered = input.trades
    .map((t) => ({ t, s: Math.floor(Date.parse(t.timestamp) / 1000) }))
    .filter(({ t, s }) => Number.isFinite(s) && (t.type === "BUY" || t.type === "SELL"))
    .sort((a, b) => a.s - b.s || (a.t.blockNumber ?? 0) - (b.t.blockNumber ?? 0));
  /**
   * "Sekarang" tidak boleh lebih awal dari perdagangan terbaru. Waktu perdagangan adalah
   * timestamp blok, dan sequencer L2 bisa berjalan sedetik-dua di depan jam server; tanpa ini
   * perdagangan yang baru saja terjadi dihitung di harga tetapi tidak di jendela, atau sebaliknya.
   */
  const newest = ordered.length > 0 ? ordered[ordered.length - 1].s : null;
  const nowSeconds = newest !== null ? Math.max(input.nowSeconds, newest) : input.nowSeconds;

  const spot = (t: StatsTrade) => {
    const p = t.priceNativeAfter ?? t.priceNative;
    return Number.isFinite(p) && p > 0 ? p : 0;
  };

  /** Harga spot sesudah perdagangan terakhir yang terjadi paling lambat pada `at`. */
  const priceAt = (at: number): number => {
    let price = input.openingPrice > 0 ? input.openingPrice : 0;
    for (const { t, s } of ordered) {
      if (s > at) break;
      const p = spot(t);
      if (p > 0) price = p;
    }
    return price;
  };

  const priceNow = priceAt(nowSeconds);
  const change = {} as Record<StatsWindow, WindowChange>;
  for (const w of STATS_WINDOWS) {
    const at = nowSeconds - w.seconds;
    const then = priceAt(at);
    // Kurs dibaca pada saat harga itu BERLAKU: kalau pasarnya lahir sesudah awal jendela,
    // harga pembukaannya baru ada sejak peluncuran.
    const fxThen = input.fxAt(input.launchedAt && input.launchedAt > at ? input.launchedAt : at);
    change[w.key] = {
      native: pct(priceNow, then),
      usd: input.fxNow && fxThen ? pct(priceNow * input.fxNow, then * fxThen) : null,
    };
  }

  const dayStart = nowSeconds - 86_400;
  let volumeNative = 0;
  let volumeUsd = 0;
  let usdKnown = true;
  let buys = 0;
  let sells = 0;
  const wallets = new Set<string>();
  for (const { t, s } of ordered) {
    if (s <= dayStart) continue;
    volumeNative += t.amountNative || 0;
    const fx = input.fxAt(s) ?? input.fxNow;
    if (fx) volumeUsd += (t.amountNative || 0) * fx;
    else usdKnown = false;
    if (t.type === "BUY") buys++;
    else sells++;
    const w = tradeWallet(t);
    if (w) wallets.add(w);
  }

  // Riwayat berjalan mundur dari yang terbaru tanpa lubang, jadi begitu perdagangan tertua
  // yang terbaca sudah lebih tua dari 24 jam, jendelanya pasti tertutup penuh.
  const oldest = ordered.length > 0 ? ordered[0].s : null;
  const complete = input.historyComplete || (oldest !== null && oldest <= dayStart);

  return {
    asOf: nowSeconds,
    complete,
    priceNative: priceNow,
    change,
    volume24h: { native: volumeNative, usd: usdKnown ? volumeUsd : null },
    buys24h: buys,
    sells24h: sells,
    traders24h: wallets.size,
  };
}
