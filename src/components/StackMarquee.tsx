import { CHAINS } from "@/lib/chains";

/**
 * Ticker stack ekosistem.
 *
 * Aturan yang membentuk isi daftar di bawah:
 *
 * 1. Sebuah nama hanya masuk kalau ADEXTO benar-benar berjalan di atasnya, dan
 *    `role` menyebutkan pemakaiannya secara harfiah. Uniswap sengaja TIDAK ada
 *    meskipun sempat diminta: integrasinya nol — kurva ini AMM-nya sendiri, bukan
 *    hook Uniswap v4 — jadi logonya akan jadi klaim yang bisa dibantah dengan satu
 *    pencarian di repo. Chainlink masuk, tetapi dengan label apa adanya: receiver
 *    CCIP sudah ter-deploy, lane-nya belum dibuka.
 *
 * 2. Nama chain dibaca dari `CHAINS`, bukan ditulis ulang di sini. Kalau
 *    NEXT_PUBLIC_CHAIN_OVERRIDES mengarahkan aplikasi ke testnet, ticker ikut
 *    berkata "0G Testnet" alih-alih diam-diam tetap memasang "Mainnet".
 *
 * 3. LOGO RESMI KALAU ADA, MONOGRAM KALAU TIDAK BOLEH.
 *
 *    Delapan dari sembilan entri memakai berkas logo resmi di /public/brand/.
 *    Asalnya dicatat berkas demi berkas di /public/brand/SOURCES.txt — lima dari
 *    @web3icons/core (MIT), satu dari simple-icons (CC0-1.0), dan 0G langsung dari
 *    brand kit resmi mereka. Berkasnya di-vendor, bukan dipasang sebagai
 *    dependency, karena dua paket itu membawa >21.000 berkas untuk enam glyph.
 *
 *    Satu entri TIDAK memakai logo, dan ini bukan karena berkasnya tidak ada:
 *    pedoman merek CoinGecko meminta logonya diberi hyperlink ke coingecko.com
 *    plus teks "Data provided by CoinGecko", dan melarang pemakaian berulang atau
 *    menonjol. Baris di bawah mengulang tiap chip empat kali, beranimasi, dan
 *    ditandai aria-hidden — jadi ia tidak bisa membawa tautan yang bisa difokus
 *    maupun kalimat atribusi itu. Namanya tetap tertulis sebagai teks, yang
 *    memang bentuk atribusi yang mereka izinkan; logonya tidak dipasang.
 *
 *    Karena itu `mark` dan `tint` tetap ada di setiap entri, bukan hanya di entri
 *    tanpa logo: keduanya juga jadi jaring kalau suatu berkas hilang dari
 *    /public/brand/, sehingga chip-nya tetap terbaca alih-alih menampilkan ikon
 *    gambar rusak. `mark` ditulis eksplisit dan tidak diturunkan otomatis dari
 *    `name` — "0G DA" dan "0G Mainnet" harus bisa dibedakan, dan pemotongan
 *    otomatis akan menyamakan keduanya.
 */
interface StackEntry {
  name: string;
  /** Dipakai untuk apa, dalam kata-kata yang bisa diperiksa. */
  role: string;
  /** false = sudah terpasang tapi belum menyalurkan lalu lintas. */
  live?: boolean;
  /** Berkas di /public/brand/. Kosong = pakai monogram; lihat catatan 3. */
  logo?: string;
  /** Inisial cadangan, dan satu-satunya penanda untuk entri tanpa logo. */
  mark: string;
  /** Warna merek, dipakai monogram. */
  tint: string;
}

const STACK: StackEntry[] = [
  // Tanpa ID chain. Percobaan pertama menyertakannya dan hasilnya empat angka
  // tujuh digit berputar di layar — angka yang tidak bisa dipakai pembaca untuk
  // apa pun sambil bergerak. Footer sudah memuat tabel nama-plus-ID yang berdiam
  // di tempat, dan di sana angka itu memang berguna.
  //
  // Empat baris ini sudah dua kali salah, ke dua arah yang berlawanan, dan
  // riwayatnya ditulis lengkap supaya tidak diputar untuk ketiga kalinya.
  //
  // Mula-mula berbunyi "launch + curve" dan ditandai live, padahal catatan di hero
  // saat itu menyatakan "launch factory pending broadcast" — halaman yang sama
  // mengatakan peluncuran jalan DAN belum jalan. Itu diperbaiki menjadi "curve
  // ready · launch pending" dengan titik amber.
  //
  // Perbaikan itu sekarang yang jadi salah. Factory 0.10.0 sudah di-broadcast ke
  // keempat mainnet, dan hero di atas berbunyi "Launching live". Jadi tabrakannya
  // cuma berbalik arah: hero bilang hidup, ticker bilang tertunda. Pembaca yang
  // percaya ticker akan menyangka studio-nya masih terkunci padahal tidak.
  //
  // Yang dinyatakan sekarang adalah kemampuan yang bisa dibaca dari chain: factory
  // 0.10.0 ada byte-nya di keempat chain (20.054 B, dan ukuran itu sudah diikat ke
  // README oleh audit_consistency.mjs bagian 1), registry ERC-8004 hidup di
  // keempatnya, dan agent-nya milik deployer. Berapa token yang sudah lahir BUKAN
  // urusan baris ini — itu sudah dinyatakan sekali di deret angka hero, dan
  // mengulangnya di sini hanya membuat sembilan chip berbunyi seperti daftar
  // tunggu.
  { name: CHAINS["0G"].name, role: "launch factory 0.10.0 live", live: true, logo: "/brand/0g.svg", mark: "0G", tint: "#111827" },
  { name: CHAINS.Base.name, role: "launch factory 0.10.0 live", live: true, logo: "/brand/base.svg", mark: "B", tint: "#0052FF" },
  { name: CHAINS.Arbitrum.name, role: "launch factory 0.10.0 live", live: true, logo: "/brand/arbitrum.svg", mark: "A", tint: "#12AAFF" },
  { name: CHAINS.Monad.name, role: "launch factory 0.10.0 live", live: true, logo: "/brand/monad.svg", mark: "M", tint: "#836EF9" },
  // Bukan "one launch per human": produksi menjalankan
  // WORLD_ID_ONE_LAUNCH_PER_HUMAN=false, jadi yang ditegakkan adalah nullifier
  // yang terikat ke satu wallet — bukan satu peluncuran per orang selamanya.
  { name: "World ID", role: "proof of personhood", live: true, logo: "/brand/world.svg", mark: "W", tint: "#3C3C3C" },
  { name: "Cloudflare Workers", role: "x402 payment challenge", live: true, logo: "/brand/cloudflare.svg", mark: "CF", tint: "#F38020" },
  // Satu-satunya entri tanpa logo, atas permintaan pemiliknya sendiri; lihat
  // catatan 3 di atas dan /public/brand/SOURCES.txt.
  { name: "CoinGecko", role: "native price feed", live: true, mark: "CG", tint: "#8DC63F" },
  // ERC-8004 dikeluarkan dari ticker. AdextoToken hanya menyimpan satu
  // `address immutable agentIdentity`; tidak ada supportsInterface, tidak ada
  // registry identitas/reputasi/validasi seperti yang standar itu tetapkan.
  // Menyebutnya "ERC-8004" adalah klaim kepatuhan yang tidak bisa ditunjukkan.
  { name: "0G DA", role: "launch metadata anchored", live: true, logo: "/brand/0g.svg", mark: "DA", tint: "#111827" },
  { name: "Chainlink CCIP", role: "receiver deployed · lanes idle", live: false, logo: "/brand/chainlink.svg", mark: "LINK", tint: "#375BD2" },
];

/**
 * Glyph di kepala chip: logo resmi kalau entri punya berkasnya, monogram kalau
 * tidak.
 *
 * Tingginya diseragamkan, LEBARNYA dibiarkan mengikuti bentuk asli. Itu konvensi
 * baris logo yang biasa, dan di sini ada alasan konkretnya: logo 0G adalah
 * wordmark 248x120. Memaksanya ke kotak 24x24 akan menyusutkannya jadi 24x11.6px
 * dan hampir tak terbaca, sementara memotong viewBox-nya supaya "pas" justru
 * dicantumkan sebagai penyalahgunaan di brand kit mereka. Jadi kotaknya tidak
 * dipatok lebarnya, hanya diberi lebar minimum supaya kolom teks tiap chip tetap
 * sejajar.
 *
 * Monogram sengaja bukan cakram pekat berhuruf putih: palet situs ini terang,
 * dan cakram pekat berputar akan menarik perhatian lebih besar daripada teks yang
 * justru harus dibaca. Latarnya diberi opasitas rendah, hurufnya warna merek penuh.
 */
function Glyph({ entry }: { entry: StackEntry }) {
  if (entry.logo) {
    return (
      <img
        src={entry.logo}
        alt=""
        aria-hidden="true"
        className="h-[18px] w-auto min-w-5 max-w-9 shrink-0 object-contain"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      /* 20px, bukan 24px: logo di sekitarnya tinggi 18px, dan cakram 24px membuat
         satu-satunya entri tanpa logo justru jadi yang paling berat di barisan. */
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold leading-none tracking-tight"
      style={{ backgroundColor: `${entry.tint}1f`, color: entry.tint }}
    >
      {entry.mark}
    </span>
  );
}

function Chip({ entry }: { entry: StackEntry }) {
  return (
    <span className="mr-3 flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-cream-2 pl-2.5 pr-4 py-1.5">
      <Glyph entry={entry} />
      <span className="whitespace-nowrap text-sm font-semibold tracking-tight text-ink">{entry.name}</span>
      <span aria-hidden="true" className="h-3.5 w-px bg-line-strong" />
      {/* Yang belum berjalan ditandai satu titik amber, bukan seluruh teksnya
          diberi warna peringatan. Dulu lima dari sembilan entri bertitik amber dan
          barisan ini terbaca seperti dinding peringatan; sekarang tinggal satu —
          Chainlink CCIP, receiver-nya ter-deploy tapi lane-nya memang belum
          dibuka. Titiknya tetap satu titik, bukan teks berwarna, supaya kalau
          jumlahnya naik lagi barisannya tidak berubah jadi peringatan massal. */}
      {!entry.live && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />}
      <span className="whitespace-nowrap text-[11px] tracking-wide text-ink-faint">{entry.role}</span>
    </span>
  );
}

function Row({ dir }: { dir: "left" | "right" }) {
  const base = dir === "right" ? [...STACK].reverse() : STACK;
  // Empat salinan identik dengan margin per-chip yang sama membuat translateX(-50%)
  // menyambung tepat (tanpa lompatan), dan separuh baris selalu lebih lebar dari
  // viewport (tanpa celah kosong).
  const items = [...base, ...base, ...base, ...base];
  return (
    <div
      aria-hidden="true"
      className={`adexto-row ${dir === "left" ? "adexto-row-left" : "adexto-row-right"}`}
    >
      {items.map((entry, i) => (
        <Chip key={`${entry.name}-${i}`} entry={entry} />
      ))}
    </div>
  );
}

/**
 * Dua baris berlawanan arah, jeda saat kursor masuk, berhenti total kalau sistem
 * meminta gerak minimal (lihat prefers-reduced-motion di globals.css).
 */
export default function StackMarquee() {
  return (
    /* py-12 -> py-8. Pita ini juga dipindah ke atas deret angka di page.tsx; dua
       perubahan itu bersama-sama yang membuatnya utuh di layar 1440x800, dan
       alasan lengkapnya ada di komentar pada page.tsx. */
    <section className="w-full border-y border-line bg-cream-3/50 py-8">
      {/* Judulnya dulu "What a launch actually runs on" — kalimat yang menyiratkan
          peluncuran sudah terjadi. Belum ada satu pun di mainnet. */}
      <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.28em] text-ink-faint">
        The stack, stated plainly
      </p>
      <p className="mb-5 flex items-center justify-center gap-2 text-center text-[11px] text-ink-soft">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
        marks what is deployed but not yet carrying traffic
      </p>

      <div className="adexto-marquee-wrap flex flex-col gap-2.5 overflow-hidden">
        <Row dir="left" />
        <Row dir="right" />
      </div>

      {/* Baris beranimasi di atas ditandai aria-hidden karena isinya diulang empat
          kali; pembaca layar mendapat daftar yang sama sekali. */}
      <ul className="sr-only">
        {STACK.map((entry) => (
          <li key={entry.name}>
            {entry.name} — {entry.role}
          </li>
        ))}
      </ul>
    </section>
  );
}
