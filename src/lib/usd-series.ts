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
  fallbackNative = 0
): UsdResult {
  if (fxPoints.length === 0) {
    return { candles: [], droppedBefore: candles.length, fxOnly: 0 };
  }

  // Tanpa perdagangan, satu titik semu dibuat dari harga registry pada sampel kurs pertama.
  // Ia BUKAN perdagangan: volumenya nol, dan seluruh bar yang lahir darinya juga bernilai nol
  // volume, jadi tidak ada aktivitas yang dinyatakan.
  const seedless = candles.length === 0;
  if (seedless && !(fallbackNative > 0)) {
    return { candles: [], droppedBefore: 0, fxOnly: 0 };
  }
  const sorted = seedless
    ? [
        {
          time: fxPoints[0][0],
          open: fallbackNative,
          high: fallbackNative,
          low: fallbackNative,
          close: fallbackNative,
          volume: 0,
        },
      ]
    : [...candles].sort((a, b) => a.time - b.time);
  const bucket = (t: number) => Math.floor(t / intervalSeconds) * intervalSeconds;

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
    tradeByBucket.set(bucket(fxPoints[0][0]), {
      time: fxPoints[0][0],
      open: lastKnown,
      high: lastKnown,
      low: lastKnown,
      close: lastKnown,
      // Nol: tidak ada perdagangan di bucket ini, dan tidak boleh ada yang menyatakan ada.
      volume: 0,
    });
  }

  const firstBucket = Math.min(...tradeByBucket.keys());
  const lastBucket = bucket(nowSeconds);
  const total = Math.floor((lastBucket - firstBucket) / intervalSeconds) + 1;
  const startBucket = total > maxBars ? lastBucket - (maxBars - 1) * intervalSeconds : firstBucket;

  // Harga native yang berlaku saat `startBucket`: penutupan perdagangan terakhir sebelum itu.
  let nativeClose = sorted[0].close;
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
   * Bucket di dalam LUBANG pengamatan tidak digambar sama sekali.
   *
   * Sebelum ini, lubang diisi carry-forward: nilainya dipegang rata sepanjang lubang, lalu
   * seluruh perubahan yang terjadi di dalamnya muncul sebagai SATU bar tegak di ujungnya. Itu
   * artefak yang terlihat — dan lebih buruk, ia berbohong dua kali: menyatakan harga tidak
   * berubah selama lubang (padahal kursnya bergerak, kita saja tidak merekamnya), lalu
   * menyatakan seluruh pergerakan itu terjadi dalam satu bucket.
   *
   * Tidak menggambar apa pun menyatakan hal yang benar: di sini tidak ada pengamatan. Seri
   * terputus, dan bar berikutnya dibuka pada nilainya sendiri alih-alih mewarisi nilai basi —
   * itulah sebabnya `prevUsdClose` direset di dalam lubang.
   *
   * Ambangnya relatif terhadap bucket, bukan tetap: pada 1 jam, jeda 20 menit bukan lubang;
   * pada 1 menit, jeda itu 20 bucket tanpa data. Batas bawah 10 menit menahan jeda perekaman
   * normal (satu sampel per menit, kadang terlewat) agar tidak dianggap lubang.
   */
  const gapThreshold = Math.max(4 * intervalSeconds, 600);
  const nextSampleAfter = (t: number): number | null => {
    for (let i = 0; i < fxPoints.length; i++) if (fxPoints[i][0] > t) return fxPoints[i][0];
    return null;
  };
  let lastSampleSeen = fxPoints[0][0];

  for (let t = startBucket; t <= lastBucket; t += intervalSeconds) {
    // Kurs berjalan maju ke sampel terakhir yang waktunya <= akhir bucket ini.
    const bucketEnd = t + intervalSeconds - 1;
    let high = -Infinity;
    let low = Infinity;
    let sampledHere = false;
    while (fxIndex < fxPoints.length && fxPoints[fxIndex][0] <= bucketEnd) {
      fxRate = fxPoints[fxIndex][1];
      lastSampleSeen = fxPoints[fxIndex][0];
      if (fxPoints[fxIndex][0] >= t) {
        sampledHere = true;
        high = Math.max(high, fxRate);
        low = Math.min(low, fxRate);
      }
      fxIndex++;
    }

    const trade = tradeByBucket.get(t);

    // Di dalam lubang pengamatan: tidak ada bar. Perdagangan TETAP digambar — ia pengamatan
    // tersendiri, dan menyembunyikannya karena kursnya jarang akan membuang data yang nyata.
    if (!trade && !sampledHere) {
      const nextAt = nextSampleAfter(bucketEnd);
      const gap = (nextAt ?? nowSeconds) - lastSampleSeen;
      if (gap > gapThreshold) {
        prevUsdClose = null;
        continue;
      }
    }
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
