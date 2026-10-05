/**
 * Versi Terms dan baris persetujuan yang ikut ditandatangani di setiap attestation peluncuran.
 *
 * KENAPA PERSETUJUANNYA ADA DI DALAM TANDA TANGAN
 *
 * Situs ini tidak punya akun, jadi tidak ada tempat menyimpan "pengguna X menyetujui Terms". Yang ada
 * adalah tanda tangan dompet creator atas pesan attestation, yang diperiksa server sebelum launch apa
 * pun disiapkan. Memasukkan satu baris persetujuan ke pesan itu membuat setiap peluncuran — dari Studio,
 * MCP `prepare_launch`, A2A `launch_market` atau REST — membawa bukti yang bisa diperiksa siapa pun:
 * alamat creator menandatangani kalimat yang menyebut versi Terms-nya.
 *
 * `/api/deploy` menolak attestation tanpa baris ini, jadi tidak ada jalur peluncuran lewat situs atau
 * agen kami yang melewatinya. Peluncuran langsung ke factory tetap mungkin dan tidak bisa dicegah;
 * pasar seperti itu juga tidak akan terdaftar di sini tanpa melewati `/api/deploy`.
 *
 * Mengganti `TERMS_VERSION` membuat attestation lama (paling lama 30 menit) ditolak, sehingga creator
 * diminta menandatangani versi yang baru. Tanggalnya harus sama dengan `UPDATED` di halaman Terms.
 */
export const TERMS_VERSION = "2026-10-05";

/** Baris yang ditandatangani. Teks publik: bahasa Inggris, dan juga terbaca di dompet. */
export const TERMS_ACCEPTANCE_LINE = `I accept the ADEXTO Terms and Acceptable Use Policy (version ${TERMS_VERSION}): https://adexto.xyz/terms`;
