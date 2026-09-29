/**
 * Market cap buka, dan jumlah native yang menghasilkannya.
 *
 * Berkas ini SENGAJA murni — tanpa `node:*`, tanpa fetch — karena dipakai di dua sisi: studio
 * (klien) menampilkan perkiraannya sebelum peluncuran, dan `/api/deploy` (server) menetapkannya ke
 * calldata. Ia dulu tinggal di `native-price.ts`; setelah berkas itu mulai membaca disk, impornya
 * dari komponen klien memecahkan build produksi. Alasan patokannya dalam USD ada di
 * `native-price.ts`.
 */

/** Market cap buka yang dituju untuk SETIAP chain, dalam USD. */
export const OPENING_MARKET_CAP_USD = 4_000;

/**
 * Jumlah native yang membuat market cap buka sama dengan target USD.
 *
 * Dibulatkan ke 6 desimal supaya `ethers.parseEther` tidak pernah menerima pecahan sepanjang
 * float — angka seperti 2.0640166847... tidak menambah ketepatan apa pun, cuma membuat calldata
 * sulit dibaca manusia.
 */
export function openingVirtualNative(nativePriceUsd: number, targetUsd = OPENING_MARKET_CAP_USD): number {
  if (!Number.isFinite(nativePriceUsd) || nativePriceUsd <= 0) return 0;
  return Number((targetUsd / nativePriceUsd).toFixed(6));
}
