/**
 * Kebijakan Agent Compute: pool compute yang dibagikan ke pemegang stake.
 *
 * APA YANG SEBENARNYA DIBAGIKAN
 *
 * Satu pool inferensi di `https://compute.adexto.xyz/v1` — Adexto Router di VPS yang sama,
 * meneruskan ke 0G Compute. Pemegang stake TIDAK memakai kunci milik situs ini lewat halaman
 * chat; mereka menerima kunci API sendiri dan memanggil endpoint itu langsung dari kode mereka.
 * Jadi yang dibatasi bukan jumlah klik di UI, melainkan jumlah token yang kunci itu belanjakan.
 *
 * Pool ini TERPISAH dari dua pemakaian model lain di repo ini, dan pemisahan itu disengaja:
 *   - `/api/chat`         co-pilot studio + terminal token, model `glm-5.3`
 *   - `/api/generate-logo` z-image-turbo
 * Keduanya memakai kunci server dan tidak pernah menyentuh kuota siapa pun. Mengubah salah satu
 * dari keduanya saat menyetel pool ini adalah kesalahan, bukan pembersihan.
 *
 * KENAPA KEBIJAKAN DI SINI DAN BUKAN DI KONTRAK
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
 * Plafon beta, dalam token AI (input + output).
 *
 * Disebut BETA karena angkanya kebijakan, bukan hak yang dijamin kontrak, dan karena tidak ada
 * pembayaran yang mengalir dari stake ke compute — biayanya ditanggung pool. Yang SUDAH berjalan
 * adalah penegakannya: pemakaian dibaca dari catatan router dan kunci dimatikan saat plafon
 * tembus. Itu beda dari versi pertama halaman ini, yang menyebut plafon tanpa punya meteran.
 */
export const BETA_TOKEN_CEILING = 1_000_000;

/**
 * Tingkatan stake dan jatah compute yang dibukanya.
 *
 * `allowance` DIHITUNG SEBAGAI INPUT + OUTPUT, kumulatif sejak kunci dibuat. Dulu bidang ini
 * bernama `tokens`, yang tidak mengatakan apa-apa tentang sisi mana yang dihitung — dan itu
 * persis pertanyaan pertama siapa pun yang membayar dengan stake. Sekarang namanya menyebut
 * jatah, dan cara hitungnya ditulis di sini: `prompt_tokens + completion_tokens` dari catatan
 * pemakaian router, tanpa pembobotan, tanpa diskon untuk cached prefix.
 *
 * Linear per tingkat, bukan rumus, supaya angka di halaman selalu sama dengan angka di sini.
 */
export const COMPUTE_TIERS = [
  { stake: 5_000, allowance: 100_000, label: "Starter" },
  { stake: 25_000, allowance: 300_000, label: "Builder" },
  { stake: 100_000, allowance: 600_000, label: "Operator" },
  { stake: 250_000, allowance: BETA_TOKEN_CEILING, label: "Sovereign" },
] as const;

export type ComputeTier = (typeof COMPUTE_TIERS)[number];

/**
 * Endpoint yang diberikan ke pemegang stake. OpenAI-compatible.
 *
 * Kuncinya kunci router asli, bukan token yang diterjemahkan oleh situs ini, jadi tidak ada
 * proxy di jalur panggilan dan tidak ada yang bisa kami sembunyikan tentang siapa yang melayani.
 */
export const AGENT_COMPUTE_ENDPOINT = "https://compute.adexto.xyz/v1";

/**
 * Model yang didokumentasikan untuk pool ini.
 *
 * `AGENT_COMPUTE_MODEL` adalah id yang DIKIRIM pemanggil ke endpoint di atas. Awalan `0g/`
 * adalah cara router menyebut provider 0G Compute; tanpa awalan itu permintaan bisa jatuh ke
 * provider lain di router yang sama.
 *
 * Labelnya BUKAN nama pemasaran. `GET https://router-api.0g.ai/v1/models` memberi model ini
 * `"name": "DeepSeek-V4-Flash"` dengan deskripsi yang diakhiri "Currently served as the pinned
 * 2026-07-31 snapshot" — jadi `0731` di label adalah tanggal snapshot yang dipin, bukan versi
 * yang kami karang. Kalau 0G memindahkan pin-nya, label ini harus ikut berubah atau ia jadi
 * klaim yang salah.
 *
 * Diukur pada 24 September 2026: `POST https://compute.adexto.xyz/v1/chat/completions` dengan
 * model ini membalas 200, dan `x_0g_trace.provider` menunjuk `0x1B3AAef3…5EB0`. Pada menit yang
 * sama, `https://router-api.0g.ai/v1` LANGSUNG dengan kunci kami membalas 503
 * `no_provider_for_trust_mode: tier=private` — dan ketika providernya dipin, 403 "pinned
 * provider has trust tier verified". Jadi sebabnya ada di kunci kami, bukan di permintaan:
 * kunci itu menuntut trust tier `private` sementara providernya `verified`. Router punya kunci
 * 0G lain yang tidak menuntut itu, dan itulah kenapa pool ini jalan sementara jalur langsung
 * tidak.
 */
export const AGENT_COMPUTE_MODEL = "0g/deepseek-v4-flash";
export const AGENT_COMPUTE_MODEL_LABEL = "DeepSeek-V4-Flash-0731";

/** Dibaca dari `/v1/models` upstream, bukan dari materi pemasaran. */
export const AGENT_COMPUTE_MODEL_FACTS = {
  /** Nama upstream tanpa tanggal snapshot. */
  upstreamName: "DeepSeek-V4-Flash",
  ownedBy: "0G Foundation",
  contextLength: 1_441_792,
  maxCompletionTokens: 393_216,
  /** `verifiability: "TeeTLS"`, `tee_type: "TDX"`, `tee_verifier: "dstack"`. */
  teeType: "TDX",
} as const;

/**
 * Provider router yang kunci pemegang stake dipin ke situ.
 *
 * Tanpa pin ini, satu kunci yang diterbitkan untuk compute agen bisa dipakai memanggil SETIAP
 * provider di router yang sama — kolam Antigravity, kolam Grok — dan jatahnya akan dibelanjakan
 * di tempat yang tidak pernah kami janjikan. Router menegakkannya di `src/sse/handlers/chat.js`:
 * `targetProvider` pada catatan kunci menimpa provider hasil parsing model.
 */
export const AGENT_COMPUTE_PROVIDER = "0g-compute";

/**
 * Lantai token input per permintaan, hasil pengukuran.
 *
 * Diukur 24 September 2026 di `usageHistory` router: prompt dua token ("hi") tercatat
 * `promptTokens: 823`, dan prompt lima token tercatat 829. Jadi setiap permintaan membawa sekitar
 * 820 token yang bukan milik pemanggil — prompt sistem yang disuntikkan router — dan jatah
 * Starter 100.000 token berarti sekitar 120 permintaan, bukan ribuan.
 *
 * ANGKA INI SEMPAT SALAH 2000, DAN SEBABNYA HARUS DICATAT
 *
 * Respons yang dilihat pemanggil melaporkan `prompt_tokens: 2823` untuk permintaan yang tercatat
 * 823. Selisihnya tepat 2000 pada setiap sampel, dan sumbernya `BUFFER_TOKENS` di
 * `open-sse/utils/usageTracking.js`: router SENGAJA menambah 2000 ke prompt_tokens di respons
 * supaya klien yang mengatur konteksnya sendiri menyisakan ruang dan tidak menabrak batas.
 *
 * Meteran memakai angka yang TERCATAT, bukan yang dilaporkan ke klien, karena yang tercatat itu
 * yang benar-benar dipakai. Konsekuensinya harus dinyatakan di UI: siapa pun yang menjumlahkan
 * `usage.prompt_tokens` dari responsnya sendiri akan mendapat 2000 lebih banyak per permintaan
 * daripada meteran kami, dan tanpa penjelasan itu terlihat seperti kami mencuri.
 */
export const MEASURED_INPUT_FLOOR = 823;

/**
 * Selisih tetap antara `prompt_tokens` yang dilaporkan ke klien dan yang tercatat sebagai
 * pemakaian. Bukan perkiraan: ia konstanta di router.
 */
export const CLIENT_USAGE_BUFFER = 2_000;

/** Perkiraan jumlah permintaan untuk sebuah jatah, memakai lantai input di atas. */
export function approxRequests(allowance: number): number {
  return Math.floor(allowance / MEASURED_INPUT_FLOOR);
}

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
 *
 * Penerbitan kunci juga bergantung pada ini: tanpa kontrak, tidak ada angka stake yang bisa
 * dibaca, jadi tidak ada tingkatan yang bisa ditetapkan dan tidak ada kunci yang boleh keluar.
 * Menerbitkannya berdasar saldo dompet akan terlihat mirip tetapi tidak bisa ditegakkan: saldo
 * bisa dijual semenit setelah kunci diterima, sementara stake bisa dibaca ulang setiap sapuan.
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
