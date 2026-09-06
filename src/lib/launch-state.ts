/**
 * Satu tempat untuk satu kenyataan: factory hidup di empat mainnet, dan $ADEXTO sendiri
 * sudah diluncurkan di 0G.
 *
 * KENAPA BERKAS INI ADA
 *
 * Keadaan itu diucapkan di delapan halaman, dan sebelum berkas ini ada, setiap halaman
 * mengarang kalimatnya sendiri — dihitung dari halaman yang benar-benar dirender, ada
 * DUA BELAS varian untuk satu keadaan. Akibatnya bukan sekadar tidak rapi: memperbaiki
 * satu halaman selalu meninggalkan tujuh lainnya.
 *
 * Dan berkas ini sudah dua kali membuktikan gunanya, keduanya dengan cara yang sama:
 * sebuah fakta berubah di chain, dan satu kalimat berubah menjadi salah di enam sampai
 * delapan tempat sekaligus.
 *
 *   Kali pertama: peluncuran nyata pertama lewat factory terjadi, dan kalimat "belum ada
 *   peluncuran" jadi salah. `audit_consistency.mjs` bagian 10 yang memaksanya diperbaiki —
 *   ia membaca `totalProjectsCount()` dari chain dan MENGGAGALKAN deploy selama teks di
 *   sini masih menyatakan nol.
 *
 *   Kali kedua, dan itu suntingan ini: $ADEXTO sendiri diluncurkan di 0G mainnet, jadi
 *   klausa "the ADEXTO token itself has not launched yet" — yang dulu dipilih JUSTRU karena
 *   dianggap tidak akan basi — berubah menjadi klaim palsu di enam halaman: hero, pitch
 *   (dua tempat), docs, security, VerifiedDeploymentCard, MarketPicker, dan footer.
 *
 * Pelajarannya dicatat: klausa apa pun yang menyatakan sesuatu BELUM terjadi punya tanggal
 * kedaluwarsa, dan tanggal itu tidak akan mengumumkan diri. Yang dipilih sekarang menyatakan
 * apa yang SUDAH ada, sehingga ia tidak berubah salah karena peristiwa berikutnya.
 *
 * FAKTA YANG DIVERIFIKASI ON-CHAIN SAAT KALIMAT INI DITULIS
 *
 *   token   0x0860a80f6fF87423c3cC379199700576857437C6
 *   curve   0xA65abca8c128B54F8268A9FBE0e2AC71DBF68841
 *   suplai  1.000.000.000, seluruhnya di kurva; saldo deployer NOL
 *   agent   ERC-8004 #3545431 terikat, registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *   kurva   realNative 0 — tidak ada setoran likuiditas, sesuai klaim produk
 *
 * $ADEXTO hidup di 0G SAJA, bukan di keempat chain. Yang hidup di empat mainnet adalah
 * FACTORY-nya. Perbedaan itu harus tetap terbaca di kalimat mana pun di bawah; menyamakan
 * keduanya adalah cara termudah kalimat ini kembali jadi klaim palsu.
 *
 * KENAPA TOKEN UJI TIDAK DISEBUT DI SINI
 *
 * Ada beberapa token ber-ticker buangan di 0G mainnet, sisa percobaan perekaman video.
 * Semuanya TIDAK disebut di teks mana pun, dan itu keputusan yang benar: bukan produk, dan
 * menyebutnya hanya memasang artefak uji ke permukaan yang dibaca calon pengguna.
 * Rinciannya ada di ADEXTO-RUNBOOK.md, bukan di situs.
 *
 * CATATAN UNTUK PENYUNTING BERIKUTNYA
 *
 * Penjaga bagian 10 mencocokkan polanya ke SELURUH berkas ini, termasuk komentar. Jadi
 * jangan mengutip frasa "belum ada peluncuran" versi Inggrisnya secara harfiah di sini —
 * mengutipnya saja sudah cukup untuk menggagalkan deploy. Itu terjadi sekali saat berkas
 * ini ditulis ulang.
 */

/** Ringkas, untuk lencana dan label sempit. */
export const LAUNCH_BADGE = "broadcast to 4 mainnets";

/**
 * Satu klausa, untuk disisipkan di akhir kalimat lain.
 * Contoh: "… broadcast to 0G, Base, Arbitrum and Monad — {LAUNCH_CLAUSE}".
 *
 * Menyebut chain-nya secara eksplisit. Tanpa "on 0G", klausa ini akan terbaca seolah
 * $ADEXTO ada di keempat mainnet, padahal hanya factory-nya yang ada di keempatnya.
 */
export const LAUNCH_CLAUSE = "$ADEXTO is live on 0G with its entire supply in the curve";

/** Kalimat utuh, untuk footer dan blok penjelas. */
export const LAUNCH_SENTENCE =
  "The curve factory is live on all four mainnets. $ADEXTO launched on 0G, with 100% of its supply in the curve and no liquidity deposit.";

/**
 * Judul dan penjelasan untuk keadaan kosong (registry, daftar market, pemilih).
 *
 * Dipisah dari yang di atas karena tugasnya beda: yang ini menjelaskan kenapa sebuah
 * DAFTAR kosong. Kata-katanya adalah pernyataan tentang DAFTAR INI, bukan tentang seluruh
 * chain — sebuah pasar bisa ada di chain sementara daftar di halaman tertentu memang masih
 * kosong, misalnya pemilih market pada chain yang belum punya pasar.
 */
export const EMPTY_TITLE = "Nothing listed here yet";
export const EMPTY_BODY =
  "Markets appear here once they are launched through this site, and fill in on their own as soon as one registers.";
