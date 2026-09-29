import { statSync } from "node:fs";
import { join } from "node:path";
import { dataDir, readJson, writeJson } from "@/lib/server-store";

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

declare global {
  var __ADEXTO_FX_CACHE__: { mtimeMs: number; store: Store } | undefined;
}

/**
 * Isi berkas, di-cache di memori dan dimuat ulang HANYA bila berkasnya berubah.
 *
 * `recordFx` dipanggil pada setiap `/api/prices`, dan setelah backfill berkas ini memuat
 * ribuan titik; membaca dan mengurai seluruhnya pada setiap permintaan harga adalah kerja yang
 * tidak perlu. Kuncinya `mtime`, bukan umur: backfill berjalan di PROSES LAIN, jadi cache yang
 * hanya kedaluwarsa oleh waktu akan terus menyajikan riwayat lama sampai servernya dimulai ulang.
 */
function load(): Store {
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(join(dataDir(), FILE)).mtimeMs;
  } catch {
    mtimeMs = -1;
  }
  const hit = globalThis.__ADEXTO_FX_CACHE__;
  if (hit && hit.mtimeMs === mtimeMs) return hit.store;
  const raw = readJson<Store>(FILE, {});
  const store = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  globalThis.__ADEXTO_FX_CACHE__ = { mtimeMs, store };
  return store;
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
   * Asal bacaan ini. Bacaan dari CACHE tidak pernah direkam; per simbol, hanya yang `live`.
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
  source: "coingecko" | "exchange" | "last-known" | "fallback" | "cache"
): void {
  // Pemutaran ulang cache adalah pengamatan YANG SAMA dibaca lagi. Simbol dari `last-known`
  // dan `fallback` sudah tersaring oleh `live[symbol]` di bawah, jadi yang lolos hanyalah
  // bacaan langsung dari CoinGecko atau bursa.
  if (source === "cache") return;

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

  if (changed) {
    writeJson(FILE, store);
    globalThis.__ADEXTO_FX_CACHE__ = undefined;
  }
}

/**
 * Pengamatan TERAKHIR untuk satu simbol, atau null.
 *
 * Dipakai `nativePrices()` sebagai pengganti bacaan langsung saat semua sumber gagal: kurs
 * yang teramati beberapa jam lalu jauh lebih dekat ke kenyataan daripada angka yang dipaku di
 * kode, yang sempat berbulan-bulan basi.
 */
export function lastObserved(symbol: string): FxPoint | null {
  const series = load()[symbol];
  if (!series || series.length === 0) return null;
  let latest = series[0];
  for (const p of series) if (p[0] > latest[0]) latest = p;
  return latest;
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
