/**
 * Satu tempat untuk satu kenyataan: factory hidup di empat mainnet, dan peluncuran
 * nyata lewatnya sudah terjadi di 0G.
 *
 * KENAPA BERKAS INI ADA
 *
 * Keadaan itu diucapkan di delapan halaman, dan sebelum berkas ini ada, setiap halaman
 * mengarang kalimatnya sendiri — dihitung dari halaman yang benar-benar dirender, ada
 * DUA BELAS varian untuk satu keadaan. Akibatnya bukan sekadar tidak rapi: memperbaiki
 * satu halaman selalu meninggalkan tujuh lainnya.
 *
 * Dan yang paling mahal sudah terbukti. Saat peluncuran pertama benar-benar terjadi,
 * kalimat "belum ada peluncuran" berubah menjadi salah SEKALIGUS di delapan tempat.
 * Karena semuanya membaca berkas ini, penggantiannya satu suntingan, bukan delapan —
 * dan `audit_consistency.mjs` bagian 10 yang memaksanya terjadi: ia membaca
 * `totalProjectsCount()` dari chain dan MENGGAGALKAN deploy selama teks di sini masih
 * menyatakan nol.
 *
 * KENAPA TOKEN UJI TIDAK DISEBUT DI SINI
 *
 * Ada dua token dengan ticker buangan di 0G mainnet, sisa percobaan perekaman video.
 * Keduanya TIDAK disebut di teks mana pun, dan itu keputusan yang benar: keduanya bukan
 * produk, tidak terdaftar di registry situs ini, dan menyebutnya hanya memasang artefak
 * uji ke permukaan yang dibaca calon pengguna.
 *
 * Yang tetap dijaga: kalimat di bawah tidak menyatakan NOL peluncuran, karena angka
 * on-chain bisa dibaca siapa pun dan `totalProjectsCount()` bernilai 2. Jadi yang
 * ditulis adalah dua hal yang sama-sama benar dan sama-sama relevan bagi pembaca —
 * factory-nya hidup, dan token $ADEXTO belum diluncurkan. Tidak berbohong, tidak pula
 * memamerkan sampah uji. Rinciannya ada di ADEXTO-RUNBOOK.md, bukan di situs.
 *
 * CATATAN UNTUK PENYUNTING BERIKUTNYA
 *
 * Penjaga bagian 10 mencocokkan polanya ke SELURUH berkas ini, termasuk komentar. Jadi
 * jangan mengutip frasa "belum ada peluncuran" versi Inggrisnya secara harfiah di sini
 * — mengutipnya saja sudah cukup untuk menggagalkan deploy. Itu terjadi sekali saat
 * berkas ini ditulis ulang.
 */

/** Ringkas, untuk lencana dan label sempit. */
export const LAUNCH_BADGE = "broadcast to 4 mainnets";

/**
 * Satu klausa, untuk disisipkan di akhir kalimat lain.
 * Contoh: "… broadcast to 0G, Base, Arbitrum and Monad — {LAUNCH_CLAUSE}".
 *
 * Sengaja menyebut $ADEXTO, bukan jumlah peluncuran. Klausa yang menyebut angka akan
 * basi setiap kali ada launch baru; klausa ini tetap benar sampai token protokolnya
 * sendiri benar-benar diluncurkan.
 */
export const LAUNCH_CLAUSE = "the ADEXTO token itself has not launched yet";

/** Kalimat utuh, untuk footer dan blok penjelas. */
export const LAUNCH_SENTENCE =
  "The curve factory is live on all four mainnets. The ADEXTO token itself has not launched yet.";

/**
 * Judul dan penjelasan untuk keadaan kosong (registry, daftar market, pemilih).
 *
 * Dipisah dari yang di atas karena tugasnya beda: yang ini menjelaskan kenapa sebuah
 * DAFTAR kosong. Kata-katanya berubah bersama peluncuran pertama, dan alasannya bukan
 * kosmetik: judul lamanya menyatakan tidak ada pasar sama sekali, dan itu berhenti
 * benar begitu sebuah pasar ada di chain — bahkan ketika daftar di situs ini memang
 * masih kosong. Yang benar sekarang adalah pernyataan tentang DAFTAR INI, bukan
 * tentang seluruh chain.
 */
export const EMPTY_TITLE = "Nothing listed here yet";
export const EMPTY_BODY =
  "Markets appear here once they are launched through this site, and fill in on their own as soon as one registers.";
