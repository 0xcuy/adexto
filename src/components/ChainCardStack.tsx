import { CHAINS } from "@/lib/chains";

/**
 * Tumpukan kartu chain di sisi kanan hero, membuka sendiri saat halaman dibuka.
 *
 * KENAPA BENTUKNYA BERUBAH DARI KIPAS MENYAMPING
 *
 * Versi pertama menguraikan kartu ke samping. Untuk memuat rotasinya tanpa terpotong
 * tepi viewport, kipasnya dipampatkan sampai geseran maksimum 21px \u2014 dan pada jarak
 * itu tiga kartu belakang hilang seluruhnya di balik kartu depan. Yang tersisa di
 * layar cuma 0G plus tiga sisi putih setipis garis. Jadi seluruh maksudnya, yaitu
 * memperlihatkan EMPAT chain, hilang demi memperbaiki soal terpotong.
 *
 * Bentuk sekarang mengurai ke ATAS, seperti tumpukan kartu di aplikasi wallet.
 * Alasannya bukan selera: ruang vertikal di sini murah dan ruang horizontal mahal.
 * Baris grid hero setinggi 404px ditentukan kolom teks, jadi dek boleh memakai 340px
 * tanpa menambah apa pun; sebaliknya setiap piksel lebar dek diambil langsung dari
 * kolom teks, dan kolom itu yang menentukan berapa baris judulnya membungkus \u2014 yang
 * sudah sekali mendorong pita ticker 53px ke bawah lipatan.
 *
 * Konsekuensi tata letak kartu: bagian yang MENYEMBUL dari kartu belakang adalah
 * pita atasnya, jadi identitas chain harus tinggal di sana. Logo dan nama chain di
 * pita atas; chain ID dan status factory di badan yang hanya terlihat pada kartu
 * terdepan. Kalau identitas ditaruh di badan seperti versi pertama, tumpukan ini
 * kembali jadi satu kartu yang bisa dibaca dan tiga yang tidak.
 *
 * KENAPA GERAKNYA LEBIH LAMBAT DAN LEBIH JAUH
 *
 * Versi pertama: 720ms, jeda 70\u2013340ms, jarak tempuh ~28px. Selesai dalam sekitar
 * satu detik dengan perpindahan yang lebih kecil daripada tinggi satu baris teks \u2014
 * secara teknis beranimasi, secara praktis tidak terlihat. Sekarang kartu belakang
 * menempuh 150px dalam 1,1 detik dengan jeda berjenjang 180ms, dan mulainya dari
 * tumpukan RAPAT: keempat kartu bertindih persis di posisi kartu depan, lalu naik
 * satu per satu. Itu yang membuat gerakannya terbaca sebagai "terbuka", bukan
 * sebagai empat kartu yang sejak awal sudah berjarak.
 *
 * TIGA HAL LAIN YANG TETAP
 *
 * - Tanpa JavaScript. Komponen server, animasi CSS murni, jadi tidak ada biaya
 *   hidrasi untuk hiasan di halaman yang paling penting cepatnya.
 * - Tinggi wadah dipatok dan kartunya absolute, jadi animasi masuk tidak bisa
 *   menggeser apa pun sesudah load.
 * - Angka dari `CHAINS`, seni dari berkas. Kalau NEXT_PUBLIC_CHAIN_OVERRIDES
 *   mengarahkan app ke testnet, kartunya ikut berkata "0G Testnet" dengan ID yang
 *   benar. Yang SENGAJA tidak ada: harga, market cap, holder, grafik \u2014 belum ada
 *   token diluncurkan, jadi angka apa pun di situ harus dikarang, dan kartu hero
 *   adalah tempat paling meyakinkan untuk angka karangan.
 */

interface Card {
  key: "0G" | "Base" | "Arbitrum" | "Monad";
  art: string;
  /** Transform akhir. Kartu depan di bawah; yang di belakang menyembul ke atas. */
  transform: string;
  /** Jeda animasi. Depan lebih dulu, lalu naik satu per satu ke belakang. */
  delayMs: number;
  z: number;
}

// 0G di depan karena di sanalah identitas agen dan metadata DA-nya berada. Urutan
// sesudahnya mengikuti ticker: Base, Arbitrum, Monad.
const CARDS: Card[] = [
  { key: "0G", art: "/hero/chain-0g.webp", transform: "translate3d(0px, 0px, 0) rotate(0deg)", delayMs: 150, z: 40 },
  { key: "Base", art: "/hero/chain-base.webp", transform: "translate3d(6px, -50px, 0) rotate(-1deg)", delayMs: 330, z: 30 },
  { key: "Arbitrum", art: "/hero/chain-arbitrum.webp", transform: "translate3d(12px, -100px, 0) rotate(-2deg)", delayMs: 510, z: 20 },
  { key: "Monad", art: "/hero/chain-monad.webp", transform: "translate3d(18px, -150px, 0) rotate(-3deg)", delayMs: 690, z: 10 },
];

export default function ChainCardStack() {
  return (
    /* Wadahnya lebih besar dari kartunya, dan angkanya dari pengukuran \u2014 rotasi
       membuat kartu melebar di luar kotak aslinya, jadi lebar wadah bukan sekadar
       lebar kartu ditambah geseran. Tinggi 340px tetap di bawah kolom teks (404px)
       supaya teks yang menentukan tinggi baris grid, bukan dek. */
    <div className="adexto-deck relative mx-auto h-[340px] w-[320px]" aria-hidden="true">
      {CARDS.map((card) => {
        const chain = CHAINS[card.key];
        return (
          <article
            key={card.key}
            className="adexto-card absolute bottom-0 left-3 h-[176px] w-[268px] overflow-hidden rounded-2xl border border-line bg-cream-2 shadow-[0_8px_24px_-12px_rgba(32,24,16,0.35)]"
            style={
              {
                zIndex: card.z,
                "--card-t": card.transform,
                "--card-d": `${card.delayMs}ms`,
              } as React.CSSProperties
            }
          >
            <img src={card.art} alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.5]" />
            {/* Gradien dari kiri: nama chain harus terbaca di atas tekstur apa pun
                yang dihasilkan model, bukan bergantung pada keberuntungan warnanya. */}
            <div className="absolute inset-0 bg-gradient-to-r from-cream-1 via-cream-1/80 to-cream-1/25" />

            <div className="relative flex h-full flex-col justify-between p-3.5">
              {/* PITA ATAS \u2014 satu-satunya bagian yang terlihat pada kartu belakang,
                  jadi identitas chain hidup di sini, bukan di badan. */}
              <div className="flex items-center gap-2.5">
                {chain.brandLogo ? (
                  <img src={chain.brandLogo} alt="" className="h-[18px] w-auto max-w-[38px] shrink-0 object-contain" />
                ) : (
                  <span className="text-xs font-semibold text-ink">{chain.key}</span>
                )}
                <span className="truncate text-sm font-semibold tracking-tight text-ink">{chain.name}</span>
                <span className="ml-auto shrink-0 rounded-full border border-line bg-white/70 px-2 py-0.5 text-[10px] font-medium text-ink-soft">
                  {chain.nativeSymbol}
                </span>
              </div>

              <div>
                <p className="text-[11px] text-ink-faint" data-numeric>
                  chain {chain.chainId}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
                  launch factory 0.10.0
                </p>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
