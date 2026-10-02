/**
 * Parameter program pertumbuhan Plan 2: referral (P2.5), kontes launch mingguan dan slot Promoted (P2.4).
 *
 * Satu tempat untuk angka yang menyangkut uang. Angka di sini adalah USULAN di README rencana §7
 * (keputusan owner #5, #6, #7). Selama `confirmed` false, halaman publik TIDAK menyebut angka uangnya:
 * mekanismenya berjalan (volume dirujuk dicatat, klasemen dihitung), tapi tidak ada janji bayaran
 * yang belum disetujui pemilik treasury.
 *
 * Aman diimpor dari klien: tidak ada impor, tidak ada rahasia.
 */

export const REFERRAL_TERMS = {
  /** Keputusan owner #5. */
  confirmed: false,
  /** Bagian dari leg protokol 0,10% pada volume yang dirujuk, dalam persen. */
  sharePctOfProtocolFee: 25,
  /** Tidak ada payout untuk minggu yang imbalannya di bawah ini. */
  minPayoutUsd: 5,
  /** Satu level: perujuk dari perujuk tidak mendapat apa pun. */
  levels: 1,
} as const;

export const CONTEST_TERMS = {
  /** Keputusan owner #6. */
  confirmed: false,
  /** Hadiah mingguan dalam USDC (rentang usulan), dibayar owner dari treasury. */
  prizeUsdMin: 100,
  prizeUsdMax: 300,
  weeks: 4,
  /** Skor dihitung dari pembeli unik bersih dalam jam ini sejak launch. */
  scoringWindowHours: 72,
} as const;

export const PROMOTED_TERMS = {
  /** Keputusan owner #7. */
  confirmed: false,
  priceUsd: 25,
  hours: 24,
  slots: 3,
} as const;

/**
 * Alamat yang boleh menandatangani aksi admin (menyetujui slot Promoted, mengekspor CSV referral).
 * Bawaannya deployer dan treasury, keduanya milik owner. `GROWTH_ADMIN_ADDRESSES` (dipisah koma)
 * menggantinya bila diset; hanya dibaca di server.
 */
export const DEFAULT_GROWTH_ADMINS = [
  "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D",
  "0x24268Fffc119ec5550F68e80D94476fD64daE967",
] as const;
