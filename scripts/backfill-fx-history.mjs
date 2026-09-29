/**
 * Isi riwayat kurs native/USD dari data historis CoinGecko.
 *
 * KENAPA INI ADA
 *
 * `src/lib/fx-history.ts` merekam kurs saat `/api/prices` dilayani, jadi riwayatnya mulai
 * dari nol pada pemasangan baru — dan chart USD dengan benar MENOLAK menggambar bucket yang
 * tidak punya kurs tersimpan. Itu perilaku yang diinginkan, tetapi artinya sebuah pemasangan
 * baru harus menunggu berjam-jam sebelum sumbu dolarnya berguna.
 *
 * Skrip ini memotong penantian itu dengan data yang BENAR-BENAR TERJADI, bukan karangan:
 * `market_chart` CoinGecko mengembalikan kurs historis yang mereka amati. Sumbernya pihak
 * ketiga, jadi ia tidak sekelas pengamatan kita sendiri — tapi ia juga bukan angka yang
 * dibuat-buat, dan itu perbedaan yang menentukan di berkas yang dipakai menggambar harga.
 *
 * Titik yang sudah ada TIDAK ditimpa. Pengamatan kita sendiri selalu menang; skrip ini hanya
 * mengisi lubang.
 *
 * Pakai:
 *   node scripts/backfill-fx-history.mjs                  # semua simbol, 7 hari
 *   node scripts/backfill-fx-history.mjs --symbol=0G --days=2
 *   node scripts/backfill-fx-history.mjs --dry-run
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  })
);
const DAYS = Number(args.get("days") || 7);
const ONLY = args.get("symbol")?.toUpperCase() || null;
const DRY = args.has("dry-run");

const DATA_DIR = process.env.ADEXTO_DATA_DIR || ".data";
const FILE = join(DATA_DIR, "fx-history.json");

/** Sama dengan `COINGECKO_IDS` di src/lib/native-price.ts. Dua daftar, dan itu diakui: yang
 *  satu dipakai runtime, yang satu skrip sekali-jalan. Kalau berbeda, gejalanya jelas —
 *  skrip ini mengembalikan "coin not found" untuk simbol yang ditambahkan di satu tempat. */
const IDS = {
  ETH: "ethereum",
  "0G": "zero-gravity",
  A0GI: "zero-gravity",
  MON: "monad",
  ARB: "arbitrum",
};

/** Sama dengan resolusi perekam. Titik 5-menit CoinGecko lolos; duplikat tidak. */
const MIN_GAP_SECONDS = 60;

const store = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
let added = 0;

for (const [symbol, id] of Object.entries(IDS)) {
  if (ONLY && symbol !== ONLY) continue;

  /**
   * DUA permintaan, dan itu bukan pemborosan.
   *
   * Resolusi CoinGecko ditentukan rentangnya: `days=1` mengembalikan titik tiap ~5 menit,
   * `days>=2` hanya per jam. Sekali tarik 7 hari berarti 168 titik — pada chart satu menit itu
   * satu bar per jam, dan chart-nya tampak berlubang. Jadi rentang panjang diambil untuk
   * cakupan, lalu satu hari terakhir diambil lagi untuk kerapatan.
   */
  const ranges = DAYS > 1 ? [DAYS, 1] : [1];
  const rows = [];
  let failed = null;
  for (const days of ranges) {
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`;
    const res = await fetch(url);
    if (!res.ok) {
      failed = res.status;
      continue;
    }
    const json = await res.json();
    if (Array.isArray(json?.prices)) rows.push(...json.prices);
    // Jeda antar permintaan: batas laju CoinGecko-lah yang melewatkan MON dan ARB pada
    // jalannya yang pertama, bukan simbolnya yang tidak ada.
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (rows.length === 0) {
    console.log(`${symbol.padEnd(5)} DILEWATI — ${failed ? `CoinGecko menjawab ${failed}` : "tidak ada titik harga"}`);
    continue;
  }
  rows.sort((a, b) => a[0] - b[0]);

  const existing = Array.isArray(store[symbol]) ? store[symbol] : [];
  const seen = new Set(existing.map((p) => p[0]));
  const merged = [...existing];

  let mine = 0;
  for (const [ms, price] of rows) {
    const t = Math.floor(ms / 1000);
    if (!Number.isFinite(t) || !Number.isFinite(price) || price <= 0) continue;
    if (seen.has(t)) continue;
    // Jangan menaruh dua titik lebih rapat dari resolusi perekam itu sendiri.
    if (merged.some((p) => Math.abs(p[0] - t) < MIN_GAP_SECONDS)) continue;
    merged.push([t, price]);
    seen.add(t);
    mine++;
  }
  merged.sort((a, b) => a[0] - b[0]);
  store[symbol] = merged;
  added += mine;
  const first = merged[0] ? new Date(merged[0][0] * 1000).toISOString().slice(0, 16) : "-";
  const last = merged[merged.length - 1] ? new Date(merged[merged.length - 1][0] * 1000).toISOString().slice(0, 16) : "-";
  console.log(`${symbol.padEnd(5)} +${String(mine).padStart(4)} titik  total ${String(merged.length).padStart(4)}  ${first} → ${last}`);
}

if (DRY) {
  console.log(`\n--dry-run: ${added} titik TIDAK ditulis`);
  process.exit(0);
}

mkdirSync(DATA_DIR, { recursive: true });
if (existsSync(FILE)) copyFileSync(FILE, `${FILE}.bak`);
writeFileSync(FILE, JSON.stringify(store));
console.log(`\nditulis ${FILE} — ${added} titik baru`);
console.log("Sumber: CoinGecko market_chart (kurs historis yang mereka amati), bukan angka yang dibuat skrip ini.");
