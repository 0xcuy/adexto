/**
 * Harga aset native, dan market cap buka yang diturunkan darinya.
 *
 * MASALAH YANG DISELESAIKAN
 *
 * `defaultVirtualNative` dulu berupa jumlah native yang DIPAKU per chain (0G
 * 1.500 · ETH 1 · MON 60.000). Karena `virtualNative` sama dengan market cap buka
 * — `mcap = harga × supply = (V ÷ supply) × supply = V` — memaku jumlah native
 * berarti membiarkan nilainya hanyut mengikuti harga koin. Hasilnya satu ticker
 * yang diluncurkan ke 4 chain membuka di nilai yang berbeda-beda: $212 di 0G,
 * $1.939 di Base, $1.311 di Monad. Selisih 9x, dan TIDAK bisa diratakan arbitrase
 * karena tidak ada bridge — jadi bukan peluang, hanya ketidakadilan yang menetap.
 *
 * Karena itu target dipatok dalam USD lalu dibagi harga native saat launch.
 *
 * KENAPA CoinGecko UNTUK SEMUANYA
 *
 * Kode lama memakai Binance untuk ETH/ARB/BTC dan CoinGecko hanya untuk 0G,
 * sedangkan MON tidak pernah diambil sama sekali — dipaku 0,25 padahal pasar
 * menyebut ~0,022. Akibatnya setiap nilai USD untuk pasar Monad tampil sekitar
 * 11x lebih tinggi daripada kenyataan. Satu sumber yang memuat keempat aset
 * menghapus seluruh kelas kesalahan itu.
 *
 * KENAPA ADA SUMBER KEDUA
 *
 * CoinGecko tetap sumber utama, tetapi ia memblokir IP server produksi (403 dari
 * CloudFront, diukur langsung dari VPS). Tanpa cadangan, setiap angka USD di situs
 * jatuh ke `FALLBACK_USD` — dan saat itu 0G tercatat 0,14 padahal pasar 0,333,
 * jadi setiap market cap tampil 58% lebih rendah. Pengguna membacanya sebagai
 * pasarnya anjlok di bawah modal pembukaan $4.000, padahal tidak ada yang menjual.
 *
 * Bybit dipakai sebagai cadangan per simbol karena ia satu-satunya bursa yang
 * terukur memuat KELIMA aset (termasuk MON, yang tidak ada di Binance) dan bisa
 * dijangkau dari VPS. Kutipannya dalam USDT, yang diperlakukan setara USD; selisih
 * patokan stablecoin jauh di bawah ketelitian angka USD mana pun di situs ini.
 * Ini tetap harga pasar yang teramati, jadi ia boleh bertanda `live`.
 *
 * KENAPA KELIVE-AN DILAPORKAN
 *
 * Route harga yang lama membalas `success: true` walaupun setiap feed gagal dan
 * seluruh angkanya berasal dari nilai cadangan. Pemanggil jadi tidak bisa
 * membedakan harga nyata dari harga tebakan. Untuk sekadar menghias angka itu
 * masih bisa dimaafkan; untuk MENETAPKAN market cap buka tidak — kurva tidak bisa
 * diubah setelah dibuat, jadi harga yang salah akan permanen. `live` di sini
 * memberi pemanggil hak untuk menolak.
 */

import { lastObserved } from "@/lib/fx-history";
/**
 * Konstanta & aritmetika market cap buka hidup di `@/lib/opening-cap`, dan diekspor ulang dari sini
 * supaya pemanggil sisi server tidak perlu berubah.
 *
 * Dipindahkan karena berkas ini SEKARANG khusus server: ia membaca riwayat kurs lewat `node:fs`.
 * Halaman studio (komponen klien) mengimpor `openingVirtualNative` dari sini, dan build produksi
 * gagal dengan "Reading from node:fs is not handled by plugins" — sementara `tsc` lolos, karena
 * pemeriksa tipe tidak tahu bundel mana yang boleh memuat apa. Bagian yang murni dipisah supaya
 * klien tidak pernah menarik modul server.
 */
export { OPENING_MARKET_CAP_USD, openingVirtualNative } from "@/lib/opening-cap";


/** Simbol native chain -> id CoinGecko. */
const COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  "0G": "zero-gravity",
  A0GI: "zero-gravity",
  MON: "monad",
  ARB: "arbitrum",
  cbBTC: "bitcoin",
};

/** Simbol native chain -> pasangan spot Bybit (kutipan USDT). */
const BYBIT_PAIRS: Record<string, string> = {
  ETH: "ETHUSDT",
  "0G": "0GUSDT",
  A0GI: "0GUSDT",
  MON: "MONUSDT",
  ARB: "ARBUSDT",
  cbBTC: "BTCUSDT",
};

/**
 * Nilai cadangan TERAKHIR, dipakai hanya bila kedua sumber dan rekaman kurs sama-sama
 * tidak punya apa-apa — praktisnya, pemasangan baru yang belum pernah membaca harga.
 * Sengaja tidak dipakai untuk menetapkan market cap: lihat catatan kelive-an di atas.
 *
 * Diperbarui 2026-09-29 dari kutipan Bybit. Nilai sebelumnya (0G 0,14, ETH 1.900) sudah
 * berbulan-bulan basi, dan ketika sumber utama terblokir angka basi itulah yang tampil di
 * seluruh situs. Angka yang dipaku SELALU membusuk; yang membuatnya jarang terpakai adalah
 * `lastObserved`, bukan ketelitian angka ini.
 */
const FALLBACK_USD: Record<string, number> = {
  ETH: 2_690,
  "0G": 0.333,
  A0GI: 0.333,
  MON: 0.0277,
  ARB: 0.207,
  cbBTC: 83_500,
  USDC: 1,
  USDT: 1,
};

/** Umur maksimum kurs terekam yang masih boleh menggantikan bacaan langsung. */
const LAST_KNOWN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Setelah CoinGecko menjawab 403/429, ia DILEWATI selama ini. Tanpa jeda, setiap penyegaran
 * cache mengetuk ulang WAF yang sedang memblokir kami — menambah latensi tiap bacaan dan, pada
 * rate limit, justru memperpanjang blokirnya.
 */
const COINGECKO_BACKOFF_MS = 10 * 60 * 1000;

const CACHE_TTL_MS = 60_000;

export interface NativePrices {
  prices: Record<string, number>;
  /** Per simbol: true bila berasal dari feed, false bila dari nilai cadangan. */
  live: Record<string, boolean>;
  fetchedAt: string;
  /**
   * `coingecko`/`exchange` = bacaan langsung. `last-known` = kurs terekam terakhir, tidak
   * live. `fallback` = angka dipaku. `cache` = bacaan sebelumnya, diputar ulang.
   */
  source: "coingecko" | "exchange" | "last-known" | "fallback" | "cache";
}

declare global {
  var __ADEXTO_PRICE_CACHE__: { at: number; value: NativePrices } | undefined;
  var __ADEXTO_COINGECKO_BLOCKED_UNTIL__: number | undefined;
}

async function readCoinGecko(): Promise<Record<string, number>> {
  if (Date.now() < (globalThis.__ADEXTO_COINGECKO_BLOCKED_UNTIL__ ?? 0)) return {};
  const ids = [...new Set(Object.values(COINGECKO_IDS))].join(",");
  try {
    /**
     * `cache: "no-store"`, BUKAN `next: { revalidate: 30 }`. Dengan revalidate, Next menyimpan
     * responsnya sendiri dan terus mengembalikan 200 berisi JSON lama ketika revalidasi berhenti
     * — angka beku yang disajikan sebagai angka hidup. Terukur: 0G 0,287985 berjam-jam
     * sementara pasar 0,3339.
     */
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    } as RequestInit);
    if (res.status === 403 || res.status === 429) {
      globalThis.__ADEXTO_COINGECKO_BLOCKED_UNTIL__ = Date.now() + COINGECKO_BACKOFF_MS;
      return {};
    }
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, { usd?: number }>;
    const out: Record<string, number> = {};
    for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
      const usd = data?.[id]?.usd;
      if (typeof usd === "number" && usd > 0) out[symbol] = usd;
    }
    return out;
  } catch {
    return {};
  }
}

/** Kutipan spot Bybit untuk simbol yang belum terisi. Satu permintaan per pasangan, paralel. */
async function readBybit(symbols: string[]): Promise<Record<string, number>> {
  const pairs = [...new Set(symbols.map((s) => BYBIT_PAIRS[s]).filter(Boolean))];
  const byPair: Record<string, number> = {};
  await Promise.all(
    pairs.map(async (pair) => {
      try {
        const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${pair}`, {
          signal: AbortSignal.timeout(8_000),
          cache: "no-store",
        } as RequestInit);
        if (!res.ok) return;
        const data = (await res.json()) as { result?: { list?: Array<{ lastPrice?: string }> } };
        const last = Number(data?.result?.list?.[0]?.lastPrice);
        if (Number.isFinite(last) && last > 0) byPair[pair] = last;
      } catch {
        // pasangan ini tidak terbaca; simbolnya jatuh ke langkah berikutnya
      }
    })
  );
  const out: Record<string, number> = {};
  for (const symbol of symbols) {
    const pair = BYBIT_PAIRS[symbol];
    if (pair && byPair[pair]) out[symbol] = byPair[pair];
  }
  return out;
}

export async function nativePrices(): Promise<NativePrices> {
  const hit = globalThis.__ADEXTO_PRICE_CACHE__;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, source: "cache" };

  const prices: Record<string, number> = { USDC: 1, USDT: 1 };
  const live: Record<string, boolean> = { USDC: true, USDT: true };
  const wanted = Object.keys(COINGECKO_IDS);

  // 1. Sumber utama.
  const primary = await readCoinGecko();
  let fromPrimary = 0;
  for (const symbol of wanted) {
    if (primary[symbol]) {
      prices[symbol] = primary[symbol];
      live[symbol] = true;
      fromPrimary++;
    }
  }

  // 2. Bursa, hanya untuk simbol yang belum terisi.
  let fromExchange = 0;
  const missing = wanted.filter((s) => prices[s] === undefined);
  if (missing.length > 0) {
    const secondary = await readBybit(missing);
    for (const symbol of missing) {
      if (secondary[symbol]) {
        prices[symbol] = secondary[symbol];
        live[symbol] = true;
        fromExchange++;
      }
    }
  }

  /**
   * 3. Kurs TERAKHIR yang benar-benar teramati, kalau masih cukup baru — dengan `live: false`.
   *
   * Jauh lebih dekat ke kenyataan daripada angka yang dipaku, karena ia pengamatan dari
   * jam-jam terakhir, bukan dari saat berkas ini ditulis. Tetap tidak live: kurva tidak boleh
   * dibuka dari harga yang bukan bacaan sekarang.
   */
  let fromLastKnown = 0;
  for (const symbol of wanted) {
    if (prices[symbol] !== undefined) continue;
    const seen = lastObserved(symbol);
    if (seen && Date.now() - seen[0] * 1000 < LAST_KNOWN_MAX_AGE_MS) {
      prices[symbol] = seen[1];
      live[symbol] = false;
      fromLastKnown++;
    }
  }

  // 4. Angka dipaku, hanya untuk yang tersisa.
  for (const [symbol, usd] of Object.entries(FALLBACK_USD)) {
    if (prices[symbol] === undefined) {
      prices[symbol] = usd;
      live[symbol] = false;
    }
  }

  const value: NativePrices = {
    prices,
    live,
    fetchedAt: new Date().toISOString(),
    source:
      fromPrimary > 0 ? "coingecko" : fromExchange > 0 ? "exchange" : fromLastKnown > 0 ? "last-known" : "fallback",
  };
  globalThis.__ADEXTO_PRICE_CACHE__ = { at: Date.now(), value };
  return value;
}
