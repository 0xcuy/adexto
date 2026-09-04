import { CHAINS } from "@/lib/chains";

/**
 * Tumpukan kartu chain di sisi kanan hero, terurai sendiri saat halaman dibuka.
 *
 * EMPAT KEPUTUSAN YANG MEMBENTUKNYA
 *
 * 1. Tanpa JavaScript. Ini komponen server dan animasinya CSS murni: `animation`
 *    berjalan begitu gaya diterapkan, jadi tidak ada `useEffect`, tidak ada state
 *    `mounted`, dan tidak ada biaya hidrasi untuk empat kartu dekoratif. Versi yang
 *    memakai state akan menambah bundel klien di halaman yang justru paling penting
 *    cepatnya.
 *
 * 2. Tingginya DIPATOK. Wadahnya punya tinggi tetap dan kartunya absolute, sehingga
 *    animasi masuk tidak bisa menggeser apa pun. Itu bukan kerapian: pita ticker di
 *    bawah hero baru saja dipastikan utuh di atas lipatan pada empat tinggi layar,
 *    dan elemen hero yang tumbuh setelah load akan mendorongnya turun lagi.
 *
 * 3. Angkanya dari `CHAINS`, seninya dari berkas. Nama chain dan chain ID dibaca
 *    dari konfigurasi \u2014 kalau NEXT_PUBLIC_CHAIN_OVERRIDES mengarahkan aplikasi ke
 *    testnet, kartunya ikut berkata "0G Testnet" dengan ID yang benar, bukan diam-diam
 *    memasang angka mainnet. Latarnya berkas WebP hasil z-image-turbo, dan promptnya
 *    melarang teks/angka/grafik justru supaya tidak ada satu pun angka di kartu ini
 *    yang berasal dari model. Lihat /public/hero/SOURCES.txt.
 *
 * 4. Peta seni ada DI SINI, bukan di chains.ts. `brandLogo` naik ke konfigurasi chain
 *    karena dua komponen membutuhkannya; latar hero hanya dipakai satu komponen, dan
 *    memindahkannya ke konfigurasi bersama akan menaruh aset dekoratif satu halaman
 *    di tempat yang dibaca seluruh aplikasi.
 *
 * YANG SENGAJA TIDAK ADA DI KARTU: harga, market cap, jumlah holder, grafik. Belum
 * ada satu pun token diluncurkan, jadi angka apa pun di situ harus dikarang \u2014 dan
 * kartu hero adalah tempat paling meyakinkan untuk sebuah angka karangan.
 */

interface Card {
  key: "0G" | "Base" | "Arbitrum" | "Monad";
  art: string;
  /** Transform akhir. Kartu pertama paling depan. */
  transform: string;
  /** Jeda animasi. Kartu belakang mendarat lebih dulu, depan terakhir. */
  delayMs: number;
  z: number;
}

// Urutan mengikuti ticker: 0G lebih dulu, lalu Base, Arbitrum, Monad. 0G di depan
// karena itu chain tempat identitas agen dan metadata DA-nya berada.
const CARDS: Card[] = [
  { key: "0G", art: "/hero/chain-0g.webp", transform: "translate3d(0px, 0px, 0) rotate(-2.5deg)", delayMs: 340, z: 40 },
  { key: "Base", art: "/hero/chain-base.webp", transform: "translate3d(7px, -12px, 0) rotate(0.5deg)", delayMs: 250, z: 30 },
  { key: "Arbitrum", art: "/hero/chain-arbitrum.webp", transform: "translate3d(14px, -24px, 0) rotate(3.5deg)", delayMs: 160, z: 20 },
  { key: "Monad", art: "/hero/chain-monad.webp", transform: "translate3d(21px, -36px, 0) rotate(6.5deg)", delayMs: 70, z: 10 },
];

export default function ChainCardStack() {
  return (
    /* Wadahnya SENGAJA lebih besar dari kartunya, dan angkanya dari pengukuran.
       Rotasi membuat kartu melebar di luar kotak aslinya, jadi lebar wadah bukan
       lebar kartu ditambah geseran translate saja.

       Riwayatnya, dan tiap langkah dari pengukuran bukan taksiran: versi pertama
       menyamakan wadah dengan kartu (292px) dan kartu belakang terpotong 120px di
       layar 1024px. Versi kedua 372px — masih keluar 17px, sementara sisi kirinya
       menyisakan 20px yang tak terpakai. Versi ketiga 380px memang muat, tetapi
       melebar begitu banyak sehingga kolom teks tinggal 524px dan judulnya
       membungkus empat baris — yang mendorong pita ticker 53px ke bawah lipatan.

       Sekarang kartunya 248x290 dan wadahnya 324x344. Setiap piksel lebar di sini
       diambil dari kolom teks di sebelahnya, dan kolom itu yang menentukan berapa
       baris judulnya membungkus. */
    <div className="adexto-deck relative mx-auto h-[344px] w-[324px]" aria-hidden="true">
      {CARDS.map((card) => {
        const chain = CHAINS[card.key];
        return (
          <article
            key={card.key}
            className="adexto-card absolute bottom-0 left-5 h-[290px] w-[248px] overflow-hidden rounded-3xl border border-line bg-cream-2 shadow-lg"
            style={
              {
                zIndex: card.z,
                "--card-t": card.transform,
                "--card-d": `${card.delayMs}ms`,
              } as React.CSSProperties
            }
          >
            <img src={card.art} alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.55]" />
            {/* Gradien putih dari bawah: nama chain harus tetap terbaca di atas
                tekstur apa pun yang dihasilkan model, bukan bergantung pada
                keberuntungan warna gambarnya. */}
            <div className="absolute inset-0 bg-gradient-to-t from-cream-1 via-cream-1/75 to-transparent" />

            <div className="relative flex h-full flex-col justify-between p-4">
              <div className="flex items-center justify-between gap-2">
                {chain.brandLogo ? (
                  <img src={chain.brandLogo} alt="" className="h-5 w-auto max-w-[42px] object-contain" />
                ) : (
                  <span className="text-xs font-semibold text-ink">{chain.key}</span>
                )}
                <span className="rounded-full border border-line bg-white/70 px-2 py-0.5 text-[10px] font-medium text-ink-soft">
                  {chain.nativeSymbol}
                </span>
              </div>

              <div>
                <p className="text-sm font-semibold leading-tight tracking-tight text-ink">{chain.name}</p>
                <p className="mt-0.5 text-[11px] text-ink-faint" data-numeric>
                  chain {chain.chainId}
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
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
