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
 * KENAPA KELIVE-AN DILAPORKAN
 *
 * Route harga yang lama membalas `success: true` walaupun setiap feed gagal dan
 * seluruh angkanya berasal dari nilai cadangan. Pemanggil jadi tidak bisa
 * membedakan harga nyata dari harga tebakan. Untuk sekadar menghias angka itu
 * masih bisa dimaafkan; untuk MENETAPKAN market cap buka tidak — kurva tidak bisa
 * diubah setelah dibuat, jadi harga yang salah akan permanen. `live` di sini
 * memberi pemanggil hak untuk menolak.
 */

/** Market cap buka yang dituju untuk SETIAP chain, dalam USD. */
export const OPENING_MARKET_CAP_USD = 4_000;

/** Simbol native chain -> id CoinGecko. */
const COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  "0G": "zero-gravity",
  A0GI: "zero-gravity",
  MON: "monad",
  ARB: "arbitrum",
  cbBTC: "bitcoin",
};

/**
 * Nilai cadangan, HANYA untuk menghias tampilan saat feed mati. Sengaja tidak
 * dipakai untuk menetapkan market cap: lihat catatan kelive-an di atas.
 */
const FALLBACK_USD: Record<string, number> = {
  ETH: 1_900,
  "0G": 0.14,
  A0GI: 0.14,
  MON: 0.022,
  ARB: 0.078,
  cbBTC: 65_000,
  USDC: 1,
  USDT: 1,
};

const CACHE_TTL_MS = 60_000;

export interface NativePrices {
  prices: Record<string, number>;
  /** Per simbol: true bila berasal dari feed, false bila dari nilai cadangan. */
  live: Record<string, boolean>;
  fetchedAt: string;
  source: "coingecko" | "fallback" | "cache";
}

declare global {
  var __ADEXTO_PRICE_CACHE__: { at: number; value: NativePrices } | undefined;
}

export async function nativePrices(): Promise<NativePrices> {
  const hit = globalThis.__ADEXTO_PRICE_CACHE__;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, source: "cache" };

  const ids = [...new Set(Object.values(COINGECKO_IDS))].join(",");
  const prices: Record<string, number> = { USDC: 1, USDT: 1 };
  const live: Record<string, boolean> = { USDC: true, USDT: true };

  let ok = false;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, {
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 30 },
    } as RequestInit);
    if (res.ok) {
      const data = (await res.json()) as Record<string, { usd?: number }>;
      for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
        const usd = data?.[id]?.usd;
        if (typeof usd === "number" && usd > 0) {
          prices[symbol] = usd;
          live[symbol] = true;
          ok = true;
        }
      }
    }
  } catch {
    // ditangani di bawah: simbol yang tidak terisi jatuh ke cadangan
  }

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
    source: ok ? "coingecko" : "fallback",
  };
  globalThis.__ADEXTO_PRICE_CACHE__ = { at: Date.now(), value };
  return value;
}

/**
 * Jumlah native yang membuat market cap buka sama dengan target USD.
 *
 * Dibulatkan ke 6 desimal supaya `ethers.parseEther` tidak pernah menerima
 * pecahan sepanjang float — angka seperti 2.0640166847...  tidak menambah
 * ketepatan apa pun, cuma membuat calldata sulit dibaca manusia.
 */
export function openingVirtualNative(nativePriceUsd: number, targetUsd = OPENING_MARKET_CAP_USD): number {
  if (!Number.isFinite(nativePriceUsd) || nativePriceUsd <= 0) return 0;
  return Number((targetUsd / nativePriceUsd).toFixed(6));
}
