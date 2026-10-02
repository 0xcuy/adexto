/**
 * Bagian referral yang murni dan aman di klien: format kode, ekor calldata, dan penyimpanan lokal.
 *
 * KENAPA ATRIBUSI ADA DI CALLDATA
 *
 * Kalau atribusi hanya berupa "klien bilang tx ini dirujuk X", siapa pun bisa memantau chain lalu
 * mengirim setiap tx baru dengan kodenya sendiri lebih dulu. Jadi alamat perujuk ditempel di ekor
 * calldata `buy`/`sell` (24 byte: magic `ADXR` + 20 byte alamat). Ekor itu ditandatangani trader
 * bersama transaksinya, jadi tidak bisa diubah sesudahnya, dan server hanya menghitung tx yang
 * ekornya cocok.
 *
 * Kontrak tidak membaca ekor itu: dekoder ABI Solidity mengabaikan calldata sesudah argumen.
 * Terukur 2026-10-03 dengan `eth_call` di Arbitrum: `buy` di kurva 1.0.0 dan 0.11.0 mengembalikan
 * jumlah token yang sama persis dengan dan tanpa ekor.
 */

export const REFERRAL_TAG_MAGIC = "0x41445852"; // "ADXR"
export const REFERRAL_TAG_BYTES = 24;

/** Kode yang dibagikan: alamat 0x, atau handle terdaftar (3–20 karakter, huruf kecil, angka, garis bawah). */
export function normalizeRefCode(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return v.toLowerCase();
  const h = v.toLowerCase();
  if (/^[a-z0-9_]{3,20}$/.test(h) && !/^0x/.test(h)) return h;
  return null;
}

export function isAddressCode(code: string): boolean {
  return /^0x[0-9a-f]{40}$/.test(code);
}

/** Ekor calldata untuk perujuk `address` (huruf kecil, tanpa checksum). */
export function referralTag(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("referrer must be an address");
  return `${REFERRAL_TAG_MAGIC}${address.slice(2).toLowerCase()}`;
}

/**
 * Alamat perujuk dari calldata, bila ekornya ada. `argBytes` = panjang calldata tanpa ekor
 * (selector + argumen), supaya ekor hanya dikenali di posisi yang benar.
 */
export function readReferralTag(data: string, argBytes: number): string | null {
  const hex = data.toLowerCase().replace(/^0x/, "");
  if (hex.length !== (argBytes + REFERRAL_TAG_BYTES) * 2) return null;
  const tail = hex.slice(argBytes * 2);
  if (!tail.startsWith(REFERRAL_TAG_MAGIC.slice(2))) return null;
  return `0x${tail.slice(8)}`;
}

/** Panjang calldata `buy(uint256,address,uint256)` dan `sell(uint256,uint256,address,uint256)`. */
export const BUY_ARG_BYTES = 4 + 32 * 3;
export const SELL_ARG_BYTES = 4 + 32 * 4;
export const BUY_SELECTOR = "0x2afaca20";
export const SELL_SELECTOR = "0x8a038a54";

/** Kunci `localStorage`. Preferensi, jadi ikut dihapus oleh "Essential only" (lihat CookieConsent). */
export const REF_STORAGE_KEY = "adexto_ref";
/** Kode yang ditangkap berlaku 30 hari; tautan referral baru menggantinya. */
export const REF_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function readStoredRef(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: string; at?: number };
    const code = normalizeRefCode(parsed.code);
    if (!code || !parsed.at || Date.now() - parsed.at > REF_TTL_MS) {
      window.localStorage.removeItem(REF_STORAGE_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function storeRef(code: string): void {
  try {
    window.localStorage.setItem(REF_STORAGE_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // mode privat: tanpa penyimpanan, atribusi berlaku hanya untuk tab ini lewat URL
  }
}

/** Pesan EIP-191 untuk mendaftarkan handle. Dibangun di satu tempat untuk klien dan server. */
export function handleRegistrationMessage(p: { handle: string; address: string; issuedAt: number }): string {
  return [
    "ADEXTO referral handle",
    `handle: ${p.handle}`,
    `address: ${p.address.toLowerCase()}`,
    `issuedAt: ${p.issuedAt}`,
  ].join("\n");
}

/** Minggu program: Senin 00:00 UTC. Mengembalikan unix detik awal minggu yang memuat `t`. */
export function weekStart(tSeconds: number): number {
  const d = new Date(tSeconds * 1000);
  const day = (d.getUTCDay() + 6) % 7; // Senin = 0
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day) / 1000);
}

export function weekLabel(startSeconds: number): string {
  return new Date(startSeconds * 1000).toISOString().slice(0, 10);
}
