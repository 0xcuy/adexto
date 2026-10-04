import type { FxPoint } from "@/lib/fx-history";

/**
 * Ubah candle bersatuan native menjadi candle bersatuan USD memakai kurs yang DIREKAM.
 *
 * DUA HAL YANG DILAKUKANNYA, DAN KENAPA
 *
 * 1. Setiap bucket dinilai dengan kurs yang berlaku PADA bucket itu, bukan kurs sekarang.
 *    Mengalikan seluruh seri dengan kurs sekarang menghasilkan grafik yang bentuknya persis
 *    sama dengan seri native — hanya labelnya berganti dolar — sambil menyatakan harga dolar
 *    masa lalu yang tidak pernah terjadi.
 *
 * 2. Setelah perdagangan terakhir, seri DILANJUTKAN memakai harga native terakhir dikali
 *    kurs tiap bucket. Ini yang membuat pasar tanpa perdagangan baru tetap bergerak dalam
 *    dolar, dan itu bukan hiasan: nilai token dalam dolar memang berubah saat 0G berubah,
 *    walau tidak ada yang berdagang. Yang digambar di sana adalah pengamatan kurs yang
 *    nyata, bukan perdagangan yang dikarang — volumenya nol, dan badan candle-nya tipis
 *    karena hanya kurs yang bergerak.
 *
 * BATAS YANG DINYATAKAN, BUKAN DITAMBAL
 *
 * Bucket yang lebih tua daripada sampel kurs pertama tidak punya kurs tersimpan. Bucket itu
 * DIBUANG dan jumlahnya dilaporkan lewat `droppedBefore`, supaya pemanggil bisa mengatakan
 * "riwayat dolar dimulai di sini" alih-alih diam-diam memakai kurs yang salah zaman.
 */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface UsdResult {
  candles: Candle[];
  /** Bucket yang dibuang karena mendahului sampel kurs pertama. */
  droppedBefore: number;
  /** Bucket yang nilainya hanya bergerak karena kurs, bukan karena perdagangan. */
  fxOnly: number;
}

/** Cari kurs tersimpan untuk sebuah detik: sampel terdekat SEBELUM waktu itu. */
function rateAt(points: FxPoint[], atSeconds: number): number | null {
  if (points.length === 0 || points[0][0] > atSeconds) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (points[mid][0] <= atSeconds) lo = mid;
    else hi = mid - 1;
  }
  return points[lo][1];
}

export function toUsdCandles(
  candles: Candle[],
  fxPoints: FxPoint[],
  intervalSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  maxBars = 600,
  /**
   * Harga native yang DIKETAHUI untuk pasar ini, dari registry.
   *
   * Ini yang membuat aturannya berlaku GLOBAL, bukan hanya untuk pasar yang sudah pernah
   * ditradingkan. Pasar tanpa satu pun fill tetap punya harga — kurva memberinya harga
   * sejak transaksi peluncuran — jadi nilainya dalam dolar tetap bergerak begitu kursnya
   * bergerak. Versi sebelumnya menuntut minimal satu candle, sehingga pasar seperti itu
   * menampilkan pane kosong dan terbaca seolah tidak ada harganya sama sekali.
   */
  fallbackNative = 0,
  /**
   * Detik epoch transaksi peluncuran. Tidak ada bar yang boleh mendahuluinya.
   *
   * Tanpa ini, pasar yang belum pernah ditradingkan dibenihi pada sampel kurs PERTAMA yang
   * direkam, dan rekaman itu dimulai jauh sebelum sebagian besar pasar lahir (2026-08-30).
   * Token yang baru diluncurkan hari ini jadi tampil dengan sebulan chart dari masa ketika
   * token itu belum ada. Nol berarti tidak diketahui, dan perilaku lamanya dipertahankan.
   */
  launchedAtSeconds = 0,
  /**
   * Awal jendela chart (detik epoch). Seri dimulai di sini, BUKAN di fill pertama di dalamnya.
   *
   * Tanpa ini, seri dimulai di candle pertama, dan server hanya mengirim candle mulai fill
   * pertama di jendelanya. Terukur 5 Okt di produksi pada 1m: SAI/42161 yang baru dibeli
   * pukul 18:28 tampil 26 bar mulai 18:28, PARCEL/143 70 bar, sedangkan LOOP/143 yang sepi
   * sejak 3 Okt tampil 600 bar kontinu. Pembelian baru membuat chart seolah mulai dari nol.
   *
   * Sebelum fill pertama, harga yang berlaku adalah `open` candle pertama. Server membukanya
   * pada fill terakhir sebelum jendela, atau pada harga pembuka kurva (`buildCandles`).
   * Bar-bar itu bergerak hanya karena kurs dan bervolume nol, sama seperti bar sesudah fill
   * terakhir. Nol berarti perilaku lama.
   */
  windowStartSeconds = 0
): UsdResult {
  if (fxPoints.length === 0) {
    return { candles: [], droppedBefore: candles.length, fxOnly: 0 };
  }
  const bucket = (t: number) => Math.floor(t / intervalSeconds) * intervalSeconds;
  const launchBucket = launchedAtSeconds > 0 ? bucket(launchedAtSeconds) : Number.NEGATIVE_INFINITY;
  // Bar sebelum peluncuran tidak mungkin milik pasar ini (misalnya catatan pasar lama dengan
  // ticker yang sama), jadi dibuang sebelum apa pun dihitung.
  const own = candles.filter((c) => c.time >= launchBucket);
  // Titik awal yang sah: sampel kurs pertama, atau peluncuran kalau itu lebih kemudian.
  const seedTime = Math.max(fxPoints[0][0], launchedAtSeconds > 0 ? launchedAtSeconds : 0);

  // Tanpa perdagangan, satu titik semu dibuat dari harga registry pada titik awal di atas.
  // Ia BUKAN perdagangan: volumenya nol, dan seluruh bar yang lahir darinya juga bernilai nol
  // volume, jadi tidak ada aktivitas yang dinyatakan.
  const seedless = own.length === 0;
  if (seedless && !(fallbackNative > 0)) {
    return { candles: [], droppedBefore: 0, fxOnly: 0 };
  }
  const sorted = seedless
    ? [
        {
          time: seedTime,
          open: fallbackNative,
          high: fallbackNative,
          low: fallbackNative,
          close: fallbackNative,
          volume: 0,
        },
      ]
    : [...own].sort((a, b) => a.time - b.time);

  /**
   * Seri dibangun KONTINU, satu bar per bucket, bukan hanya pada bucket yang punya isi.
   *
   * Versi pertama hanya mengeluarkan bar untuk bucket yang punya perdagangan, lalu menambah
   * bar untuk bucket yang punya SAMPEL kurs setelah perdagangan terakhir. Hasilnya berlubang
   * di dua arah: jeda antar-perdagangan kosong, dan dengan sampel kurs tiap lima menit pada
   * chart satu menit, empat dari lima bucket tidak ada. Di layar itu terbaca sebagai chart
   * rusak — bar gemuk berjauhan — padahal datanya ada.
   *
   * Yang benar adalah CARRY-FORWARD: untuk bucket tanpa perdagangan, harga native terakhir
   * yang diketahui dipakai; untuk bucket tanpa sampel kurs baru, kurs terakhir yang diketahui
   * dipakai. Bar seperti itu DATAR (open = close), dan itu pernyataan yang tepat: tidak ada
   * informasi baru di bucket tersebut. Begitu salah satunya bergerak, barnya bergerak.
   *
   * `maxBars` memotong dari ujung TERBARU. Tanpa itu, tujuh hari pada bucket satu menit
   * adalah 10.080 bar — lightweight-charts menggambarnya, tetapi tidak ada yang bisa
   * membacanya dan setiap pemuatan mengirim megabyte ke browser.
   */
  const firstFx = fxPoints[0][0];
  const tradeByBucket = new Map<number, Candle>();
  let dropped = 0;
  for (const c of sorted) {
    if (c.time < firstFx) {
      // Bucket yang mendahului sampel kurs pertama tidak punya kurs tersimpan, dan menilainya
      // dengan kurs mana pun berarti mengarang harga dolar untuk waktu yang tidak terekam.
      dropped++;
      continue;
    }
    tradeByBucket.set(bucket(c.time), c);
  }
  /**
   * Seluruh perdagangan lebih tua daripada rekaman kurs — ini keadaan yang WAJAR, bukan
   * kegagalan.
   *
   * Versi sebelumnya menyerah di sini, dan akibatnya pasar yang diluncurkan sebelum perekaman
   * dimulai tidak pernah punya sumbu dolar sama sekali. Padahal harga native terakhirnya
   * diketahui, dan itu cukup: bagian yang tidak bisa digambar hanyalah masa lalu sebelum
   * rekaman, dan itu sudah dihitung di `droppedBefore`.
   *
   * Jadi harga terakhir yang diketahui dijadikan titik awal pada sampel kurs pertama. Aturan
   * ini identik dengan jalur "belum pernah ditradingkan", dan itulah intinya — satu aturan
   * untuk semua pasar, bukan cabang per keadaan.
   */
  if (tradeByBucket.size === 0) {
    const lastKnown = sorted[sorted.length - 1]?.close || fallbackNative;
    if (!(lastKnown > 0)) return { candles: [], droppedBefore: dropped, fxOnly: 0 };
    tradeByBucket.set(bucket(seedTime), {
      time: seedTime,
      open: lastKnown,
      high: lastKnown,
      low: lastKnown,
      close: lastKnown,
      // Nol: tidak ada perdagangan di bucket ini, dan tidak boleh ada yang menyatakan ada.
      volume: 0,
    });
  }

  const firstTradeBucket = Math.min(...tradeByBucket.keys());
  // Awal jendela, dibatasi peluncuran dan sampel kurs pertama: tidak ada bar sebelum keduanya.
  const firstTrade = tradeByBucket.get(firstTradeBucket)!;
  const priceBefore = firstTrade.open > 0 ? firstTrade.open : firstTrade.close;
  const windowBucket =
    windowStartSeconds > 0 && !seedless && priceBefore > 0
      ? Math.max(bucket(windowStartSeconds), launchBucket, bucket(firstFx))
      : Number.POSITIVE_INFINITY;
  const firstBucket = Math.min(firstTradeBucket, windowBucket);
  const lastBucket = bucket(nowSeconds);
  const total = Math.floor((lastBucket - firstBucket) / intervalSeconds) + 1;
  const startBucket = total > maxBars ? lastBucket - (maxBars - 1) * intervalSeconds : firstBucket;

  // Harga native yang berlaku saat `startBucket`: penutupan perdagangan terakhir sebelum itu,
  // atau, sebelum fill pertama, harga yang ia buka.
  let nativeClose = startBucket < firstTradeBucket ? priceBefore : sorted[0].close;
  for (const c of sorted) {
    if (c.time <= startBucket) nativeClose = c.close;
    else break;
  }

  let fxIndex = 0;
  let fxRate = fxPoints[0][1];
  const out: Candle[] = [];
  let fxOnly = 0;
  let prevUsdClose: number | null = null;

  /**
   * SETIAP bucket digambar, termasuk di dalam lubang rekaman kurs: waktu selalu maju.
   *
   * Versi sebelumnya melewati bucket di dalam lubang. lightweight-charts menaruh bar per urutan,
   * bukan per waktu, jadi bucket yang dilewati memampatkan sumbu waktu, dan chart terlihat
   * berhenti. Owner (5 Okt): "waktu ga terus maju". Di dalam lubang, kurs terakhir yang diketahui
   * dipakai, jadi barnya datar dan bervolume nol: tidak ada informasi baru. Kurs berikutnya yang
   * terekam muncul di bucket tempat ia terekam.
   */
  for (let t = startBucket; t <= lastBucket; t += intervalSeconds) {
    // Kurs berjalan maju ke sampel terakhir yang waktunya <= akhir bucket ini.
    const bucketEnd = t + intervalSeconds - 1;
    let high = -Infinity;
    let low = Infinity;
    while (fxIndex < fxPoints.length && fxPoints[fxIndex][0] <= bucketEnd) {
      fxRate = fxPoints[fxIndex][1];
      if (fxPoints[fxIndex][0] >= t) {
        high = Math.max(high, fxRate);
        low = Math.min(low, fxRate);
      }
      fxIndex++;
    }

    const trade = tradeByBucket.get(t);
    if (trade) {
      nativeClose = trade.close;
      const o = trade.open * fxRate;
      const c2 = trade.close * fxRate;
      out.push({
        time: t,
        open: prevUsdClose ?? o,
        high: Math.max(o, c2, trade.high * fxRate),
        low: Math.min(o, c2, trade.low * fxRate),
        close: c2,
        volume: trade.volume * fxRate,
      });
      prevUsdClose = c2;
      continue;
    }

    // Tidak ada perdagangan: nilainya bergerak hanya karena kurs. Volume NOL — volume bukan
    // nol di sini akan menyatakan aktivitas yang tidak terjadi.
    const close = nativeClose * fxRate;
    const open = prevUsdClose ?? close;
    const hi = high === -Infinity ? close : nativeClose * high;
    const lo = low === Infinity ? close : nativeClose * low;
    out.push({
      time: t,
      open,
      high: Math.max(open, close, hi),
      low: Math.min(open, close, lo),
      close,
      volume: 0,
    });
    prevUsdClose = close;
    fxOnly++;
  }

  return { candles: out, droppedBefore: dropped, fxOnly };
}

/** Satu perdagangan dari `/api/agent/telemetry` (`trades`), cukup untuk membangun candle. */
export interface TradePoint {
  timestamp: string;
  priceNative: number;
  priceNativeAfter?: number | null;
  amountNative: number;
  blockNumber?: number | null;
}

/**
 * Candle untuk bucket yang BERISI perdagangan, dibangun di browser dari SEMUA perdagangan sejak
 * peluncuran, untuk lebar bar apa pun.
 *
 * Kenapa tidak memakai `candles` dari server: server membangunnya di jendela 600 bucket terakhir,
 * jadi pada 1m riwayatnya berhenti 10 jam ke belakang, pada 5m dua hari (owner, 5 Okt: "kemana
 * sebelum-sebelumnya waktunya?"). Daftar perdagangannya sendiri lengkap sejak peluncuran, jadi
 * candle dari daftar itu menjangkau sampai lahirnya token.
 *
 * Aturannya sama dengan `buildCandles` di server: harga = `priceNativeAfter ?? priceNative`
 * (harga kurva sesudah perdagangan); `open` = penutupan bucket berisi sebelumnya, atau harga
 * peluncuran untuk bucket pertama; high/low memuat `open`; volume = jumlah native.
 */
export function tradeCandles(trades: TradePoint[], intervalSeconds: number, launchPrice: number): Candle[] {
  if (!(intervalSeconds > 0)) return [];
  const points = trades
    .map((t) => ({
      s: Math.floor(Date.parse(t.timestamp) / 1000),
      p: Number(t.priceNativeAfter ?? t.priceNative),
      v: Number(t.amountNative) || 0,
      b: Number(t.blockNumber ?? 0),
    }))
    .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.p) && x.p > 0)
    .sort((a, b) => a.s - b.s || a.b - b.b);
  const out: Candle[] = [];
  let prev = launchPrice > 0 ? launchPrice : 0;
  for (const x of points) {
    const time = Math.floor(x.s / intervalSeconds) * intervalSeconds;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, x.p);
      last.low = Math.min(last.low, x.p);
      last.close = x.p;
      last.volume += x.v;
    } else {
      const open = prev > 0 ? prev : x.p;
      out.push({ time, open, high: Math.max(open, x.p), low: Math.min(open, x.p), close: x.p, volume: x.v });
    }
    prev = x.p;
  }
  return out;
}

/**
 * Sumbu native (0G, MON, ETH): SATU bar per bucket dari awal jendela sampai SEKARANG, untuk
 * semua pasar. Waktu selalu maju. Bucket tanpa perdagangan diisi datar pada harga yang berlaku,
 * bervolume nol: sebelum fill pertama di jendela, di antara fill, dan sesudah fill terakhir.
 *
 * Kenapa di klien: server (`buildCandles`) sengaja memangkas ekor sesudah fill terakhir dan
 * jeda panjang di antara fill (maksimal 4 bar datar). lightweight-charts menaruh bar per
 * urutan, bukan per waktu, jadi bucket yang hilang memampatkan sumbu waktu. Terlihat 5 Okt pada
 * $ZEEBO/0G 1m: 8 bar, berhenti di fill terakhir 06:53, lalu tidak ada apa-apa sampai jam
 * sekarang. Chart terlihat seperti terminal yang jamnya mati.
 *
 * Harga di awal jendela: penutupan candle terakhir SEBELUM jendela, atau `open` candle pertama
 * (server membukanya pada fill terakhir sebelum jendelanya, atau pada harga pembuka kurva).
 * Candle bertanggal sedikit di depan jam kita tidak pernah dipotong. `maxBars` memotong dari
 * ujung terbaru, sama dengan `toUsdCandles`.
 */
export function continuousNative(
  candles: Candle[],
  intervalSeconds: number,
  windowStartSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  maxBars = 600
): Candle[] {
  if (candles.length === 0 || !(intervalSeconds > 0)) return candles;
  const bucket = (t: number) => Math.floor(t / intervalSeconds) * intervalSeconds;
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const lastBucket = Math.max(bucket(nowSeconds), bucket(sorted[sorted.length - 1].time));
  const wanted = windowStartSeconds > 0 ? bucket(windowStartSeconds) : bucket(sorted[0].time);
  const start = Math.max(wanted, lastBucket - (maxBars - 1) * intervalSeconds);

  let price = sorted[0].open > 0 ? sorted[0].open : sorted[0].close;
  const byBucket = new Map<number, Candle>();
  for (const c of sorted) {
    if (bucket(c.time) < start) price = c.close;
    else byBucket.set(bucket(c.time), c);
  }
  if (!(price > 0)) return candles;

  const out: Candle[] = [];
  for (let t = start; t <= lastBucket; t += intervalSeconds) {
    const c = byBucket.get(t);
    if (!c) {
      out.push({ time: t, open: price, high: price, low: price, close: price, volume: 0 });
      continue;
    }
    // Bar berisi dibuka di penutupan bar sebelumnya, supaya seri tidak terputus.
    const open = out.length > 0 ? out[out.length - 1].close : c.open > 0 ? c.open : c.close;
    out.push({ time: t, open, high: Math.max(c.high, open), low: Math.min(c.low, open), close: c.close, volume: c.volume });
    price = c.close;
  }
  return out;
}

/**
 * Seri native untuk pasar yang BELUM pernah ditradingkan: harga kurva, datar, sejak peluncuran.
 *
 * Kurva memberi harga sejak transaksi peluncuran, jadi pasar tanpa satu pun fill tetap punya
 * harga yang bisa dibaca. Sebelum ini sumbu native menampilkan pane kosong untuk setiap pasar
 * baru. Bar-bar ini DATAR dan bervolume NOL: tidak ada perdagangan yang dinyatakan, dan tidak
 * ada satu bar pun sebelum peluncuran.
 *
 * `maxBars` memotong dari ujung terbaru, sama seperti `toUsdCandles`.
 */
export function flatSinceLaunch(
  launchedAtSeconds: number,
  priceNative: number,
  intervalSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  maxBars = 600
): Candle[] {
  if (!(launchedAtSeconds > 0) || !(priceNative > 0) || !(intervalSeconds > 0)) return [];
  const bucket = (t: number) => Math.floor(t / intervalSeconds) * intervalSeconds;
  const last = bucket(Math.max(nowSeconds, launchedAtSeconds));
  const first = Math.max(bucket(launchedAtSeconds), last - (maxBars - 1) * intervalSeconds);
  const out: Candle[] = [];
  for (let t = first; t <= last; t += intervalSeconds) {
    out.push({ time: t, open: priceNative, high: priceNative, low: priceNative, close: priceNative, volume: 0 });
  }
  return out;
}
