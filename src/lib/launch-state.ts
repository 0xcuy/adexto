/**
 * Satu tempat untuk satu kenyataan: factory hidup di empat mainnet, dan belum ada
 * satu pun token diluncurkan lewatnya.
 *
 * KENAPA BERKAS INI ADA
 *
 * Keadaan itu diucapkan di delapan halaman, dan sebelum berkas ini ada, setiap
 * halaman mengarang kalimatnya sendiri. Dihitung dari halaman yang benar-benar
 * dirender, bukan dari sumber: DUA BELAS varian untuk satu keadaan.
 *
 *   "no launches yet"                                    /pitch (di dalam pil hijau)
 *   "no token launched yet"                              /
 *   "No token has been launched yet, which is why ..."   footer, jadi 5 halaman
 *   "no token has been launched through it yet; ..."     /pitch intro
 *   "no token has been launched through it yet, ..."     /explorer
 *   "No token has been launched through the factory yet" /docs
 *   "Nothing has been launched yet"                      /explorer
 *   "nothing has been launched yet"                      /swap
 *   "No markets exist yet"                               /swap
 *   "No markets yet"                                     /explorer, /swap
 *   "Launching live"                                     /
 *   "launch factory 0.10.0 live"                         ticker
 *
 * Akibatnya bukan sekadar tidak rapi. Ia membuat keadaan ini MUSTAHIL disapu
 * sekali: memperbaiki satu halaman selalu meninggalkan tujuh lainnya, dan itu
 * persis keluhan yang berulang. Dan yang lebih mahal: saat peluncuran pertama
 * benar-benar terjadi, dua belas kalimat itu semuanya berubah menjadi salah, di
 * delapan tempat, tanpa satu pun yang saling tahu.
 *
 * Jadi kalimatnya dipindah ke sini. Satu suntingan di berkas ini mengubah seluruh
 * situs, dan `audit_consistency.mjs` bagian 10 menegakkan dua hal: tidak ada
 * halaman yang boleh mengarang varian sendiri, DAN kalau `totalProjectsCount()` di
 * chain sudah bukan nol, kalimat-kalimat ini wajib berhenti dipakai.
 *
 * YANG BUKAN URUSAN BERKAS INI
 *
 * Ini bukan tempat untuk memperhalus fakta. Angkanya nol, dan nol harus terbaca
 * nol. Pil hijau "NO LAUNCHES YET" di /pitch bukan diperbaiki dengan menghapus
 * kalimatnya — kalimatnya benar, dan tanpanya sebuah baris milestone berpil hijau
 * terbaca sebagai traksi yang tidak ada. Yang salah di sana adalah caveat-nya
 * ditaruh DI DALAM lencana keberhasilan; ia pindah ke deskripsi di sebelahnya.
 */

/** Ringkas, untuk lencana dan label sempit. */
export const LAUNCH_BADGE = "broadcast to 4 mainnets";

/**
 * Satu klausa, untuk disisipkan di akhir kalimat lain.
 * Contoh: "… broadcast to 0G, Base, Arbitrum and Monad — {LAUNCH_CLAUSE}".
 */
export const LAUNCH_CLAUSE = "no token has been launched through it yet";

/** Kalimat utuh, untuk footer dan blok penjelas. */
export const LAUNCH_SENTENCE =
  "The curve factory is live on all four mainnets, so launching works on each of them. No token has been launched through it yet, which is why there is still nothing to trade.";

/**
 * Judul dan penjelasan untuk keadaan kosong (registry, daftar market, pemilih).
 *
 * Dipisah dari yang di atas karena tugasnya beda: yang ini harus menjelaskan
 * kenapa sebuah DAFTAR kosong, dan pernah salah menyalahkan filter pemakai
 * ("No markets match this filter") padahal registry-nya memang belum berisi.
 */
export const EMPTY_TITLE = "No markets yet";
export const EMPTY_BODY =
  "The curve factory is live on all four mainnets and no token has been launched through it yet, so this fills in on its own as soon as the first launch registers itself.";
