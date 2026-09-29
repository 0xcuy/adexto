/**
 * Isi riwayat kurs native/USD dari kline bursa yang benar-benar terjadi.
 *
 * KENAPA INI ADA
 *
 * `src/lib/fx-history.ts` merekam kurs saat `/api/prices` dilayani, jadi riwayatnya mulai dari
 * nol pada pemasangan baru — dan chart USD dengan benar MENOLAK menggambar bucket tanpa kurs
 * tersimpan. Artinya pemasangan baru menampilkan chart datar berjam-jam. Skrip ini memotong
 * penantian itu dengan data yang TERJADI, bukan karangan.
 *
 * KENAPA BYBIT, BUKAN COINGECKO
 *
 * Versi pertama memakai `market_chart` CoinGecko. Dua hal membuatnya salah pilihan:
 *   1. CoinGecko memblokir IP server produksi (403 CloudFront), jadi skrip ini tidak bisa
 *      dijalankan tepat di tempat yang paling membutuhkannya.
 *   2. Resolusinya ditentukan rentang: per jam di luar 24 jam terakhir. Pada chart 1 menit itu
 *      satu bar per jam, dan setiap langkah jam tergambar sebagai bar tegak.
 * Kline Bybit memberi 1 menit untuk hari terakhir dan 5 menit untuk sisanya, memuat KELIMA aset
 * (termasuk MON, yang tidak ada di Binance), dan bisa dijangkau dari VPS. Nilainya harga
 * penutupan tiap candle — perdagangan nyata di bursa, bukan interpolasi.
 *
 * Titik yang sudah ada TIDAK ditimpa. Pengamatan situs sendiri selalu menang; skrip ini hanya
 * mengisi lubang.
 *
 * Pakai:
 *   node scripts/backfill-fx-history.mjs                     # semua simbol, 30 hari
 *   node scripts/backfill-fx-history.mjs --symbol=MON --days=2
 *   node scripts/backfill-fx-history.mjs --dry-run
 *
 * Di VPS, di dalam kontainer (image tidak membawa folder scripts/, jadi dikirim lewat stdin):
 *   docker exec -i -e ADEXTO_DATA_DIR=/app/data adexto-production \
 *     node --input-type=module - --days=30 < scripts/backfill-fx-history.mjs
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  })
);
/**
 * Sampai 400 hari, sama dengan retensi `fx-history.ts`. Batas lama tujuh hari membuat rentang
 * "All" di chart tidak bisa digambar dalam dolar: pasar tertua berumur 23 hari, jadi dua pertiga
 * riwayatnya tidak punya kurs.
 */
const DAYS = Math.max(1, Math.min(400, Number(args.get("days") || 30)));
const ONLY = args.get("symbol")?.toUpperCase() || null;
const DRY = args.has("dry-run");

const DATA_DIR = process.env.ADEXTO_DATA_DIR || ".data";
const FILE = join(DATA_DIR, "fx-history.json");

/**
 * Sama dengan `BYBIT_PAIRS` di src/lib/native-price.ts. Dua daftar, dan itu diakui: yang satu
 * runtime, yang satu skrip sekali-jalan yang juga dikirim lewat stdin ke kontainer tanpa
 * `node_modules` aplikasi. Kalau berbeda, gejalanya jelas: simbol yang hanya ada di satu daftar
 * tidak pernah terisi.
 */
const PAIRS = {
  ETH: "ETHUSDT",
  "0G": "0GUSDT",
  A0GI: "0GUSDT",
  MON: "MONUSDT",
  ARB: "ARBUSDT",
  cbBTC: "BTCUSDT",
};

/** Sama dengan resolusi perekam. Dua titik lebih rapat dari ini tidak menambah informasi. */
const MIN_GAP_SECONDS = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Kline satu pasangan dalam rentang [fromMs, toMs], diurutkan naik.
 *
 * Bybit mengembalikan paling banyak 1000 candle per permintaan, TERBARU LEBIH DULU, jadi rentang
 * panjang ditelusuri mundur dengan menggeser `end` ke candle tertua yang sudah diterima.
 *
 * Titiknya dicap waktu AKHIR candle, bukan awalnya: harga penutupan baru diketahui saat candle
 * selesai. Mencapnya di awal berarti bucket pukul 10:00 dinilai dengan harga pukul 10:00:59 —
 * angka yang belum ada saat bucket itu dimulai. Candle yang masih berjalan dilewati karena alasan
 * yang sama.
 */
async function klines(pair, intervalMin, fromMs, toMs) {
  const out = [];
  const nowMs = Date.now();
  let end = toMs;
  for (let guard = 0; guard < 20 && end > fromMs; guard++) {
    const url =
      `https://api.bybit.com/v5/market/kline?category=spot&symbol=${pair}` +
      `&interval=${intervalMin}&start=${fromMs}&end=${end}&limit=1000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Bybit menjawab ${res.status}`);
    const json = await res.json();
    const list = json?.result?.list ?? [];
    if (list.length === 0) break;
    for (const k of list) {
      const startMs = Number(k[0]);
      const endMs = startMs + intervalMin * 60_000;
      const close = Number(k[4]);
      if (endMs > nowMs) continue; // candle yang masih berjalan
      if (Number.isFinite(close) && close > 0) out.push([Math.floor(endMs / 1000), close]);
    }
    const oldest = Math.min(...list.map((k) => Number(k[0])));
    if (oldest <= fromMs || list.length < 1000) break;
    end = oldest - 1;
    await sleep(250);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Cari indeks titik dengan waktu terdekat di seri yang sudah terurut. */
function nearestGap(sortedTimes, t) {
  let lo = 0;
  let hi = sortedTimes.length - 1;
  if (hi < 0) return Infinity;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimes[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const a = Math.abs(sortedTimes[lo] - t);
  const b = lo > 0 ? Math.abs(sortedTimes[lo - 1] - t) : Infinity;
  return Math.min(a, b);
}

const store = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const nowMs = Date.now();
const rangeStart = nowMs - DAYS * 24 * 3600_000;

// Satu pengambilan per PASANGAN; 0G dan A0GI berbagi pasangan yang sama.
const fetched = new Map();
let added = 0;

for (const [symbol, pair] of Object.entries(PAIRS)) {
  if (ONLY && symbol !== ONLY) continue;

  let points = fetched.get(pair);
  if (!points) {
    try {
      // Kerapatan mengikuti tingkat retensi `fx-history.ts`: 1 menit untuk dua hari terakhir,
      // 5 menit sampai tujuh hari, 1 jam sebelumnya. Mengambil lebih rapat dari itu hanya untuk
      // dipangkas lagi oleh perekam adalah permintaan yang terbuang.
      const twoDaysAgo = nowMs - 2 * 24 * 3600_000;
      const weekAgo = nowMs - 7 * 24 * 3600_000;
      const recent = await klines(pair, 1, Math.max(rangeStart, twoDaysAgo), nowMs);
      await sleep(250);
      const middle = rangeStart < twoDaysAgo ? await klines(pair, 5, Math.max(rangeStart, weekAgo), twoDaysAgo) : [];
      await sleep(250);
      const oldest = rangeStart < weekAgo ? await klines(pair, 60, rangeStart, weekAgo) : [];
      points = [...oldest, ...middle, ...recent];
      fetched.set(pair, points);
    } catch (e) {
      console.log(`${symbol.padEnd(5)} DILEWATI — ${e.message}`);
      continue;
    }
  }

  const existing = Array.isArray(store[symbol]) ? store[symbol] : [];
  const times = existing.map((p) => p[0]).sort((a, b) => a - b);
  const merged = [...existing];
  let mine = 0;
  for (const [t, price] of points) {
    if (nearestGap(times, t) < MIN_GAP_SECONDS) continue;
    merged.push([t, price]);
    mine++;
  }
  merged.sort((a, b) => a[0] - b[0]);
  store[symbol] = merged;
  added += mine;

  const first = merged[0] ? new Date(merged[0][0] * 1000).toISOString().slice(0, 16) : "-";
  const last = merged.at(-1) ? new Date(merged.at(-1)[0] * 1000).toISOString().slice(0, 16) : "-";
  console.log(`${symbol.padEnd(5)} +${String(mine).padStart(5)} titik  total ${String(merged.length).padStart(5)}  ${first} → ${last}`);
}

if (DRY) {
  console.log(`\n--dry-run: ${added} titik TIDAK ditulis`);
  process.exit(0);
}

mkdirSync(DATA_DIR, { recursive: true });
if (existsSync(FILE)) copyFileSync(FILE, `${FILE}.bak`);
writeFileSync(FILE, JSON.stringify(store));
console.log(`\nditulis ${FILE} — ${added} titik baru`);
console.log("Sumber: kline spot Bybit (harga penutupan perdagangan nyata), bukan angka yang dibuat skrip ini.");
