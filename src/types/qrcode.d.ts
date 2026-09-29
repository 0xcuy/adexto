/**
 * Deklarasi tipe untuk `qrcode`.
 *
 * Paketnya tidak membawa tipe dan `@types/qrcode` tidak dipasang di repo ini. Yang
 * dideklarasikan di sini SENGAJA hanya permukaan yang benar-benar dipakai kartu bagikan —
 * satu fungsi, empat opsi. Menyalin seluruh definisi paket berarti merawat berkas yang
 * lebih besar daripada pemakaiannya, dan tipe yang tidak pernah dipanggil tidak pernah
 * terbukti benar.
 *
 * `qrcode` juga sekarang tercantum eksplisit di `dependencies`. Sebelumnya ia hanya ada
 * sebagai dependensi transitif, yaitu keadaan yang lolos hari ini dan hilang tanpa
 * peringatan pada pemasangan bersih berikutnya kalau paket induknya berhenti memakainya.
 */
declare module "qrcode" {
  interface QRCodeToDataURLOptions {
    margin?: number;
    width?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
  }
  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  const _default: { toDataURL: typeof toDataURL };
  export default _default;
}
