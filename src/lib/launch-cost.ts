import { CHAINS, type ChainInfo, type ChainKey } from "@/lib/chains";
import { nativePrices } from "@/lib/native-price";

/**
 * Biaya membuka satu pasar, per chain, dihitung HIDUP.
 *
 * KENAPA INI ADA
 *
 * Landing page menyatakan "gas only" tanpa satu pun angka, dan itu meninggalkan
 * pertanyaan yang paling ingin dijawab pembaca: gas only itu berapa. Jawabannya juga
 * bukan satu angka — ia berbeda dua orde besaran antar chain, dan yang membuatnya
 * berbeda bukan kontraknya melainkan harga gas dikali harga token native.
 *
 * KENAPA TIDAK DITULIS TANGAN
 *
 * Karena angka yang ditulis tangan di halaman ini sudah basi berkali-kali dan selalu
 * dengan cara yang sama: benar saat ditulis, salah beberapa hari kemudian, dan tidak ada
 * yang memberi tahu. Versi subgraph membeku di v0.10.2 sampai tiga rilis sesudahnya;
 * petak `getLogs` Base turun dari 10.000 ke 2.000 tanpa pengumuman. Biaya launch
 * bergerak lebih cepat dari keduanya — harga gas berubah tiap blok.
 *
 * YANG DITULIS TANGAN HANYA SATUAN GAS, DAN ITU DISENGAJA
 *
 * `eth_estimateGas` per chain pada setiap render berarti empat panggilan RPC yang bisa
 * gagal, untuk memperbaiki angka yang praktis tidak bergerak: diukur langsung ke keempat
 * factory mainnet, satuan gasnya 3.135.771 sampai 3.159.225 — sebaran 0,75% dari
 * ujung ke ujung. Yang benar-benar bergerak adalah harga gas dan harga token, dan
 * keduanya dibaca hidup.
 *
 * Kalau generasi factory berubah, satuan ini harus diukur ulang. `audit_consistency.mjs`
 * memeriksa versi factory, jadi perubahan generasi tidak akan lolos tanpa terlihat.
 */

/**
 * Satuan gas `deployTrinity`, DIUKUR ke factory 0.11.0 yang terpasang di mainnet
 * (2026-09-15) lewat `estimateGas` dengan argumen yang sama seperti yang dikirim Studio:
 * supply 1.000.000.000 token utuh, tanpa pengikatan agent.
 *
 * Sebaran antar chain 0,75%, jadi satu konstanta per chain sudah lebih presisi daripada
 * yang dibutuhkan halaman ini.
 */
export const LAUNCH_GAS_UNITS: Partial<Record<ChainKey, number>> = {
  "0G": 3_150_718,
  Base: 3_157_505,
  Arbitrum: 3_159_225,
  Monad: 3_135_771,
};

export interface LaunchCost {
  chainKey: ChainKey;
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  gasUnits: number;
  /** Gwei. Null bila RPC tidak menjawab. */
  gasPriceGwei: number | null;
  /** Biaya dalam token native chain itu. Null bila harga gas tidak terbaca. */
  costNative: number | null;
  costUsd: number | null;
  /**
   * Apakah kedua masukan benar-benar terbaca hidup. False berarti angkanya tidak
   * ditampilkan sama sekali — perkiraan yang menyamar sebagai bacaan adalah cacat yang
   * sudah berulang di repo ini.
   */
  live: boolean;
}

async function gasPriceGwei(chain: ChainInfo): Promise<number | null> {
  try {
    const res = await fetch(chain.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "eth_gasPrice", params: [] }),
      signal: AbortSignal.timeout(6_000),
      /**
       * `revalidate`, BUKAN `cache: "no-store"`.
       *
       * `no-store` memaksa halaman depan menjadi dinamis, dan itu berarti empat
       * panggilan RPC pada setiap kunjungan untuk memperbaiki angka yang tidak perlu
       * akurat per detik di halaman pemasaran. Terlihat di keluaran build: `/` pindah
       * dari `○ (Static)` ke `ƒ (Dynamic)`.
       *
       * Lima menit mengikuti pola yang sudah dipakai `og-attestation.ts`, yang membuat
       * `/docs` tetap statis sambil membaca router 0G hidup.
       */
      next: { revalidate: 300 },
    } as RequestInit);
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string };
    if (!body?.result) return null;
    const wei = Number(BigInt(body.result));
    return Number.isFinite(wei) ? wei / 1e9 : null;
  } catch {
    // RPC publik kadang menolak; chain itu lalu dilaporkan `live: false` alih-alih
    // memakai harga gas yang dikarang.
    return null;
  }
}

/**
 * Biaya launch tiap chain yang punya factory kurva.
 *
 * Keempat chain dibaca BERBARENGAN: berurutan, satu RPC lambat menahan seluruh render
 * halaman depan.
 */
export async function launchCosts(): Promise<LaunchCost[]> {
  const chains = (Object.keys(LAUNCH_GAS_UNITS) as ChainKey[])
    .map((key) => ({ key, chain: CHAINS[key] }))
    .filter(({ chain }) => chain && chain.launchGeneration === "curve");

  const [feed, gasPrices] = await Promise.all([
    nativePrices(),
    Promise.all(chains.map(({ chain }) => gasPriceGwei(chain))),
  ]);

  return chains.map(({ key, chain }, i) => {
    const gasUnits = LAUNCH_GAS_UNITS[key] as number;
    const gwei = gasPrices[i];
    const priceUsd = feed.prices[chain.nativeSymbol];
    const costNative = gwei == null ? null : (gasUnits * gwei) / 1e9;
    const costUsd = costNative != null && typeof priceUsd === "number" && priceUsd > 0 ? costNative * priceUsd : null;
    return {
      chainKey: key,
      chainId: chain.chainId,
      chainName: chain.name,
      nativeSymbol: chain.nativeSymbol,
      gasUnits,
      gasPriceGwei: gwei,
      costNative,
      costUsd,
      live: costUsd != null,
    };
  });
}

/** Termurah dan termahal dari yang benar-benar terbaca, untuk satu kalimat ringkas. */
export function launchCostRange(costs: LaunchCost[]): { min: LaunchCost; max: LaunchCost } | null {
  const usable = costs.filter((c) => c.live && c.costUsd != null);
  if (usable.length === 0) return null;
  return {
    min: usable.reduce((a, b) => ((a.costUsd as number) < (b.costUsd as number) ? a : b)),
    max: usable.reduce((a, b) => ((a.costUsd as number) > (b.costUsd as number) ? a : b)),
  };
}

/**
 * Dolar bernilai sangat kecil: `$0.00` akan terbaca seperti gratis, dan itu bukan faktanya.
 *
 * EMPAT DESIMAL SERAGAM di bawah $1, bukan presisi yang berubah menurut besarnya. Versi
 * sebelumnya memakai 4 desimal di bawah $0.01 dan 3 desimal di atasnya, sehingga satu
 * kolom memuat `$0.0024`, `$0.048`, `$0.153`, `$0.0071` — titik desimalnya tidak sejajar
 * dan kolomnya terbaca seperti salah render. Nol di ekor lebih murah daripada itu.
 */
export function formatUsd(value: number): string {
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
