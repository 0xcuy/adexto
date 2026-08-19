import { CHAINS } from "@/lib/chains";

/**
 * Ticker stack ekosistem.
 *
 * Dua aturan yang membentuk isi daftar di bawah:
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
 * Wordmark tipografis, bukan logo. Base, Arbitrum, Monad dan World tidak punya
 * berkas logo di repo ini, jadi versi berlogo akan tampak setengah jadi: dua
 * merek bergambar di antara lima kotak teks.
 */
interface StackEntry {
  name: string;
  /** Dipakai untuk apa, dalam kata-kata yang bisa diperiksa. */
  role: string;
  /** false = sudah terpasang tapi belum menyalurkan lalu lintas. */
  live?: boolean;
}

const STACK: StackEntry[] = [
  // Tanpa ID chain. Percobaan pertama menyertakannya dan hasilnya empat angka
  // tujuh digit berputar di layar — angka yang tidak bisa dipakai pembaca untuk
  // apa pun sambil bergerak. Footer sudah memuat tabel nama-plus-ID yang berdiam
  // di tempat, dan di sana angka itu memang berguna.
  //
  // Empat baris chain ini SEBELUMNYA berbunyi "launch + curve" dan ditandai live.
  // Itu salah, dan salahnya jenis terburuk: catatan di hero — dua inci di atas
  // ticker ini — sudah menyatakan "launch factory pending broadcast". Jadi
  // halaman yang sama mengatakan peluncuran jalan di tiga mainnet DAN belum jalan
  // di mana pun. Pembaca akan memercayai yang lebih berani, lalu membuka studio
  // dan menemukan tombolnya terkunci. Yang benar-benar berjalan di keempat chain
  // hari ini: dompet, harga, tautan explorer, dan kontrak Governor.
  { name: CHAINS["0G"].name, role: "agent router · launch pending", live: false },
  { name: CHAINS.Base.name, role: "curve ready · launch pending", live: false },
  { name: CHAINS.Arbitrum.name, role: "curve ready · launch pending", live: false },
  { name: CHAINS.Monad.name, role: "curve ready · launch pending", live: false },
  // Bukan "one launch per human": produksi menjalankan
  // WORLD_ID_ONE_LAUNCH_PER_HUMAN=false, jadi yang ditegakkan adalah nullifier
  // yang terikat ke satu wallet — bukan satu peluncuran per orang selamanya.
  { name: "World ID", role: "proof of personhood", live: true },
  { name: "Cloudflare Workers", role: "x402 payment challenge", live: true },
  { name: "CoinGecko", role: "native price feed", live: true },
  // ERC-8004 dikeluarkan dari ticker. AdextoToken hanya menyimpan satu
  // `address immutable agentIdentity`; tidak ada supportsInterface, tidak ada
  // registry identitas/reputasi/validasi seperti yang standar itu tetapkan.
  // Menyebutnya "ERC-8004" adalah klaim kepatuhan yang tidak bisa ditunjukkan.
  { name: "0G DA", role: "launch metadata anchored", live: true },
  { name: "Chainlink CCIP", role: "receiver deployed · lanes idle", live: false },
];

function Chip({ entry }: { entry: StackEntry }) {
  return (
    <span className="mr-3 flex shrink-0 items-center gap-3 rounded-full border border-line bg-cream-2 px-5 py-2.5">
      <span className="whitespace-nowrap text-sm font-semibold tracking-tight text-ink">{entry.name}</span>
      <span aria-hidden="true" className="h-3.5 w-px bg-line-strong" />
      {/* Yang belum berjalan ditandai satu titik amber, bukan seluruh teksnya
          diberi warna peringatan. Lima dari sembilan entri memang belum berjalan,
          dan mewarnai kelimanya membuat barisan ini terbaca seperti dinding
          peringatan alih-alih daftar status. */}
      {!entry.live && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />}
      <span className="whitespace-nowrap font-mono text-[11px] tracking-wide text-ink-faint">{entry.role}</span>
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
    <section className="w-full border-y border-line bg-cream-3/50 py-12">
      {/* Judulnya dulu "What a launch actually runs on" — kalimat yang menyiratkan
          peluncuran sudah terjadi. Belum ada satu pun di mainnet. */}
      <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.28em] text-ink-faint">
        The stack, stated plainly
      </p>
      <p className="mb-8 flex items-center justify-center gap-2 text-center text-[11px] text-ink-soft">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
        marks what is deployed but not yet carrying traffic
      </p>

      <div className="adexto-marquee-wrap flex flex-col gap-3 overflow-hidden">
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
