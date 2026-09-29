/**
 * Pesan yang ditandatangani pemilik pasar untuk menyunting metadatanya.
 *
 * Hidup di `lib/`, bukan di dalam route-nya, karena KEDUA sisi harus membangun string yang
 * identik byte per byte: klien menandatanganinya, server memverifikasinya. Dua penyusun
 * string yang terpisah adalah cara paling pasti membuat verifikasi gagal karena spasi
 * alih-alih karena kunci — dan galat yang muncul ("signature could not be read") tidak akan
 * menyebut spasi sebagai sebabnya.
 *
 * Isinya memuat SETIAP nilai yang akan ditulis, bukan sekadar "saya pemiliknya". Tanda tangan
 * yang hanya mengikat identitas bisa dipakai ulang untuk isi berbeda oleh siapa pun yang
 * pernah melihatnya; karena pesan ini mengikat isinya, satu tanda tangan hanya sah untuk satu
 * perubahan.
 */
export interface MarketUpdateFields {
  chainId: number;
  symbol: string;
  description: string;
  website: string;
  github: string;
  x: string;
  docs: string;
  /** Lihat `imageFingerprint`. */
  imageFingerprint: string;
  issuedAt: string;
}

export function buildUpdateMessage(input: MarketUpdateFields): string {
  return [
    "ADEXTO market metadata update",
    "",
    `chain: ${input.chainId}`,
    `ticker: ${input.symbol.toUpperCase()}`,
    `description: ${input.description}`,
    `website: ${input.website}`,
    `github: ${input.github}`,
    `x: ${input.x}`,
    `docs: ${input.docs}`,
    `image: ${input.imageFingerprint}`,
    `issuedAt: ${input.issuedAt}`,
    "",
    "Signing this changes only how the market is presented.",
    "It cannot move funds, change fees, or change supply.",
  ].join("\n");
}

/**
 * Sidik jari gambar, untuk dimasukkan ke pesan yang ditandatangani.
 *
 * Data URI bisa mencapai 200.000 karakter, dan menaruhnya utuh akan membuat dialog wallet
 * tidak mungkin dibaca — padahal satu-satunya gunanya dialog itu adalah supaya orang bisa
 * membaca apa yang ditandatanganinya. Panjang plus potongan awal-akhir sudah cukup mengikat:
 * mengganti gambar mengubah nilai ini, jadi tanda tangan lama berhenti cocok.
 */
export function imageFingerprint(image: string | null | undefined): string {
  if (!image) return "unchanged";
  if (image.length <= 96) return image;
  return `${image.slice(0, 48)}…${image.slice(-16)} (${image.length} chars)`;
}

/** Umur maksimum tanda tangan: cukup panjang untuk wallet lambat, cukup pendek supaya tanda
 *  tangan yang bocor tidak berguna lagi besok. */
export const MAX_SIGNATURE_AGE_MS = 10 * 60 * 1000;
