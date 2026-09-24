/**
 * Kebijakan Agent Compute: berapa compute yang dibuka sebuah stake.
 *
 * KENAPA DI SINI DAN BUKAN DI KONTRAK
 *
 * `AdextoAgentStake.sol` hanya menyimpan stake dan menjawab `stakedOf(address)`. Ia tidak tahu apa
 * itu kuota. Pemisahan itu sengaja: angka-angka di bawah akan berubah berkali-kali — harga compute
 * bergerak, plafon beta akan naik atau turun, modelnya bisa diganti — dan tidak satu pun perubahan
 * itu boleh menuntut sentuhan pada kontrak yang memegang uang orang lain.
 *
 * Konsekuensinya harus dinyatakan, bukan disembunyikan: kuota ini TIDAK dijamin on-chain. Yang
 * dijamin on-chain adalah stake-nya. Halaman `/agent-compute` mengatakan itu apa adanya.
 */

/** Nilai stake minimum untuk mengaktifkan agen, dalam satuan token utuh. */
export const MIN_STAKE_ADEXTO = 5_000;

/**
 * Plafon beta, dalam token AI.
 *
 * Disebut BETA di seluruh UI karena ia memang belum ditagihkan: tidak ada meter yang menagih
 * pemakaian ke stake, dan tidak ada pembayaran yang mengalir. Yang ada satu plafon bersama untuk
 * peserta awal. Menyebutnya "kuota" tanpa kata beta akan menyiratkan hak yang belum kami punya
 * cara menegakkannya.
 */
export const BETA_TOKEN_CEILING = 1_000_000;

/**
 * Tingkatan stake dan compute yang dibukanya.
 *
 * Linear per tingkat, bukan rumus, supaya angka di halaman selalu sama dengan angka di sini dan
 * tidak ada pembulatan yang harus dijelaskan. `tokens` adalah token AI di fase beta.
 */
export const COMPUTE_TIERS = [
  { stake: 5_000, tokens: 100_000, label: "Starter" },
  { stake: 25_000, tokens: 300_000, label: "Builder" },
  { stake: 100_000, tokens: 600_000, label: "Operator" },
  { stake: 250_000, tokens: BETA_TOKEN_CEILING, label: "Sovereign" },
] as const;

export type ComputeTier = (typeof COMPUTE_TIERS)[number];

/**
 * Model yang dipanggil untuk agen.
 *
 * `deepseek-v4-flash` DIPERIKSA dilayani router 0G, bukan diambil dari materi pemasaran: `GET
 * /v1/models` mencantumkannya bersama `deepseek-v4-pro` dan `deepseek-v4.1-flash`.
 *
 * Satu hal yang harus diketahui siapa pun yang membaca ini: pada 25 September 2026 router
 * menjawab 503 `no_provider_for_trust_mode: tier=private` untuk SETIAP model, termasuk `glm-5.3`
 * yang dipakai `/api/chat`. Delapan variasi nama parameter trust mode dicoba dan semuanya
 * menghasilkan galat identik, jadi nilainya datang dari konfigurasi kunci dan bukan dari
 * permintaan. Nama model di sini benar; ketersediaannya urusan terpisah, dan UI tidak boleh
 * mengklaim inferensinya hidup selama itu belum diukur ulang.
 */
export const AGENT_COMPUTE_MODEL = "deepseek-v4-flash";
export const AGENT_COMPUTE_MODEL_LABEL = "DeepSeek V4 Flash";

/** Tingkatan tertinggi yang dicapai sebuah stake, atau null kalau di bawah minimum. */
export function tierForStake(staked: number): ComputeTier | null {
  let match: ComputeTier | null = null;
  for (const t of COMPUTE_TIERS) {
    if (staked >= t.stake) match = t;
  }
  return match;
}

/** Tingkatan berikutnya beserta kekurangan stake untuk mencapainya. */
export function nextTier(staked: number): { tier: ComputeTier; shortfall: number } | null {
  for (const t of COMPUTE_TIERS) {
    if (staked < t.stake) return { tier: t, shortfall: t.stake - staked };
  }
  return null;
}

/**
 * Alamat kontrak stake per chain, dari env.
 *
 * KOSONG ADALAH KEADAAN YANG SAH, dan itu keadaan hari ini: `AdextoAgentStake` ada di source tetapi
 * belum di-deploy — ia menunggu siaran generasi 0.12.0 bersama perubahan kontrak lain (lihat §1i
 * runbook). Halaman harus membaca ini dan mengatakan yang sebenarnya, bukan menampilkan nol sebagai
 * kalau-kalau posisinya kosong.
 */
export const STAKE_CONTRACT: Record<number, string> = {
  16661: process.env.NEXT_PUBLIC_AGENT_STAKE_0G || "",
};

export function stakeContractFor(chainId: number): string | null {
  const a = STAKE_CONTRACT[chainId];
  return a && /^0x[a-fA-F0-9]{40}$/.test(a) ? a : null;
}

/**
 * Token yang di-stake: pasar `$ADEXTO` di 0G mainnet.
 *
 * Ditulis di sini sebagai satu tempat, bukan dibaca dari registry saat render, karena halaman ini
 * bicara tentang SATU token tertentu dan bukan tentang pasar mana pun yang kebetulan terdaftar.
 * Alamatnya diverifikasi di chain: `swapCount` kurvanya terbaca lewat `evmrpc.0g.ai`.
 */
export const STAKE_TOKEN = {
  chainId: 16661,
  symbol: "ADEXTO",
  address: "0xA1358C17004469C7CA5365AbafD294F9b2c11DF7",
  curve: "0xc80e0659D2Fc29e62605C9DF6182a85372652B60",
  decimals: 18,
} as const;
