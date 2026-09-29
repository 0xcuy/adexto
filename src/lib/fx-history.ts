import { readJson, writeJson } from "@/lib/server-store";

/**
 * Riwayat kurs aset native terhadap USD, DIREKAM — bukan direkonstruksi.
 *
 * MASALAH YANG DISELESAIKANNYA
 *
 * Harga token dalam USD adalah harga native dikali kurs native/USD. Chart pasar digambar
 * dari event swap on-chain, jadi pasar tanpa perdagangan baru menghasilkan candle yang
 * datar — padahal nilainya dalam dolar BERGERAK sepanjang 0G bergerak. Di layar itu terbaca
 * seperti pasar yang beku, dan itu keliru.
 *
 * KENAPA DIREKAM DAN TIDAK DIHITUNG BELAKANGAN
 *
 * Godaan yang jelas adalah mengalikan seluruh seri native dengan kurs SEKARANG. Itu bukan
 * riwayat USD: ia hanya seri native yang diberi label dolar, bentuknya identik, dan ia
 * menyatakan harga dolar masa lalu yang tidak pernah terjadi. Satu-satunya cara jujur punya
 * riwayat USD adalah menyimpan kurs saat ia benar-benar teramati, lalu memakai nilai yang
 * tersimpan untuk bucket waktu masing-masing.
 *
 * Akibatnya yang harus diterima apa adanya: riwayat USD hanya sepanjang rekaman ini, bukan
 * sepanjang umur pasar. Untuk periode sebelum perekaman dimulai tidak ada angka, dan chart
 * menyatakan itu alih-alih mengisinya.
 *
 * BENTUK PENYIMPANAN
 *
 * Satu berkas, satu entri per simbol, sampel paling rapat satu menit. Pada resolusi itu
 * tujuh hari adalah ~10.080 titik per simbol — beberapa ratus kilobyte untuk lima simbol,
 * yang muat di volume data yang sama dengan registry. Sampel direkam saat `/api/prices`
 * dilayani, jadi tidak ada penjadwal dan tidak ada proses tambahan: selama ada yang membuka
 * situsnya, kursnya terekam.
 */

const FILE = "fx-history.json";

/** Jarak minimum antar sampel. Lebih rapat dari ini tidak menambah informasi, hanya berkas. */
const MIN_SAMPLE_GAP_MS = 60_000;

/** Umur simpan. Lebih lama dari ini dan berkasnya tumbuh tanpa ada yang membacanya. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Titik: [detik epoch, harga USD]. Array, bukan objek, karena ia disimpan puluhan ribu kali. */
export type FxPoint = [number, number];

type Store = Record<string, FxPoint[]>;

function load(): Store {
  const raw = readJson<Store>(FILE, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/**
 * Catat kurs yang baru saja teramati.
 *
 * Hanya harga yang `live` yang direkam. Nilai cadangan (`native-price.ts` menyediakannya saat
 * feed gagal) adalah tebakan, dan merekamnya akan menanam tebakan itu ke dalam riwayat
 * permanen — di mana ia tidak lagi bisa dibedakan dari pengamatan.
 */
export function recordFx(
  prices: Record<string, number>,
  live: Record<string, boolean>,
  /**
   * Asal bacaan ini. HANYA `"coingecko"` yang direkam.
   *
   * Ini memperbaiki cacat yang terukur dan cukup halus: perekam dulu menulis satu sampel per
   * menit setiap kali `/api/prices` dilayani, tanpa memeriksa apakah angkanya baru. Karena
   * `nativePrices()` menyimpan cache 60 detik dan jatuh ke cache itu saat upstream menolak
   * (CoinGecko membatasi laju kami saat backfill), riwayatnya terisi 90 sampel BERURUTAN yang
   * nilainya identik — padahal kursnya bergerak, kita hanya tidak membacanya.
   *
   * Akibatnya dua-duanya salah arah: chart tampak punya data padat yang sebenarnya satu
   * pengamatan diulang, lalu ketika cache akhirnya menyegar, SELURUH pergerakan muncul sebagai
   * satu bar tegak. Merekam hanya bacaan upstream yang sungguhan membuat lubang menjadi lubang
   * yang jujur — dan `toUsdCandles` sudah tahu cara tidak menggambar lubang.
   */
  source: "coingecko" | "fallback" | "cache"
): void {
  if (source !== "coingecko") return;

  const now = Date.now();
  const store = load();
  let changed = false;

  for (const [symbol, price] of Object.entries(prices)) {
    if (!live[symbol]) continue;
    if (!Number.isFinite(price) || price <= 0) continue;

    const series = store[symbol] ?? [];
    const last = series[series.length - 1];
    if (last && now - last[0] * 1000 < MIN_SAMPLE_GAP_MS) continue;

    series.push([Math.floor(now / 1000), price]);

    // Pemangkasan dilakukan di sini, bukan lewat tugas terpisah: satu-satunya saat berkas ini
    // tumbuh adalah saat baris ini berjalan.
    const cutoff = Math.floor((now - RETENTION_MS) / 1000);
    store[symbol] = series.filter((p) => p[0] >= cutoff);
    changed = true;
  }

  if (changed) writeJson(FILE, store);
}

/** Seri satu simbol, terurut naik menurut waktu. */
export function fxSeries(symbol: string): FxPoint[] {
  const series = load()[symbol] ?? [];
  return [...series].sort((a, b) => a[0] - b[0]);
}

/**
 * Kurs yang TERSIMPAN untuk sebuah detik, dipilih dari sampel terdekat SEBELUMNYA.
 *
 * Sebelumnya, bukan yang terdekat mana pun: memakai sampel dari masa depan berarti bucket
 * pukul 10:00 dinilai dengan kurs pukul 10:05, yaitu angka yang belum ada saat bucket itu
 * terjadi. Kalau tidak ada sampel sebelum waktu itu, hasilnya null dan pemanggil harus
 * menyatakan ketiadaannya, bukan menebak.
 */
export function fxAt(series: FxPoint[], atSeconds: number): number | null {
  if (series.length === 0) return null;
  let lo = 0;
  let hi = series.length - 1;
  if (series[0][0] > atSeconds) return null;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (series[mid][0] <= atSeconds) lo = mid;
    else hi = mid - 1;
  }
  return series[lo][1];
}
