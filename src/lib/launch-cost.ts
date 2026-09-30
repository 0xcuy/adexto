import { CHAIN_LIST, type ChainInfo, type ChainKey } from "@/lib/chains";
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
 * Gas units of `deployTrinity`, MEASURED against the ADEXTO v1 factories on mainnet
 * (2026-10-01) with `estimateGas` and the arguments Studio sends: 1,000,000,000 whole tokens,
 * the standard tier (100/70/10 bps), a non-zero metadata root, no agent binding.
 *
 * About 0.9–2% above 0.12.0 (3,232,651–3,300,044), because the v1 token records its launch
 * time for the per-wallet launch window. The spread across chains is under 1%, so one constant
 * per chain is more precise than this page needs.
 *
 * NOT included: Base's L1 data fee, which is charged apart from L2 gas. Launch calldata is
 * about 600 bytes, so that fee is a fraction of a cent; the page calls its figures estimates.
 */
// Typed over every production chain, so adding a chain without measuring it fails to compile
// instead of silently leaving it out of the cost table.
const MEASURED_LAUNCH_GAS: Record<Exclude<ChainKey, "Devchain">, number> = {
  "0G": 3_329_186,
  Base: 3_300_657,
  Arbitrum: 3_301_628,
  Monad: 3_295_824,
  Robinhood: 3_300_657,
};
export const LAUNCH_GAS_UNITS: Partial<Record<ChainKey, number>> = MEASURED_LAUNCH_GAS;

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
  // Urutan CHAIN_LIST (Monad, Arbitrum, Base, 0G), bukan urutan kunci LAUNCH_GAS_UNITS:
  // tabel biaya di halaman depan dan /api/launch-cost harus berbaris sama dengan setiap
  // daftar chain lain di situs.
  const chains = CHAIN_LIST.filter((chain) => LAUNCH_GAS_UNITS[chain.key] != null)
    .map((chain) => ({ key: chain.key, chain }))
    .filter(({ chain }) => chain.launchGeneration === "curve");

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
