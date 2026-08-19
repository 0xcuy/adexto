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
  { name: CHAINS["0G"].name, role: "TEE agent compute", live: true },
  { name: CHAINS.Base.name, role: "launch + curve", live: true },
  { name: CHAINS.Arbitrum.name, role: "launch + curve", live: true },
  { name: CHAINS.Monad.name, role: "launch + curve", live: true },
  { name: "World ID", role: "one launch per human", live: true },
  { name: "Cloudflare Workers", role: "x402 edge paywall", live: true },
  { name: "ERC-8004", role: "agent identity", live: true },
  { name: "CoinGecko", role: "native price feed", live: true },
  { name: "Chainlink CCIP", role: "receiver deployed · lanes idle", live: false },
];

function Chip({ entry }: { entry: StackEntry }) {
  return (
    <span className="mr-3 flex shrink-0 items-center gap-3 rounded-full border border-line bg-cream-2 px-5 py-2.5">
      <span className="whitespace-nowrap text-sm font-semibold tracking-tight text-ink">{entry.name}</span>
      <span aria-hidden="true" className="h-3.5 w-px bg-line-strong" />
      <span
        className={`whitespace-nowrap font-mono text-[11px] tracking-wide ${
          entry.live ? "text-ink-faint" : "text-warn"
        }`}
      >
        {entry.role}
      </span>
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
      <p className="mb-8 text-center text-[11px] font-semibold uppercase tracking-[0.28em] text-ink-faint">
        What a launch actually runs on
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
