import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Code2,
  Gamepad2,
  KeyRound,
  Megaphone,
  Music,
  Users,
  Video,
} from "lucide-react";

/**
 * Untuk siapa protokol ini, dinyatakan sebagai KEMAMPUAN, bukan sebagai integrasi.
 *
 * Halaman ini sebelumnya hanya berbicara kepada satu pembaca: seseorang yang sudah tahu
 * apa itu bonding curve. Setiap kalimat di atasnya berdiri di atas istilah — kurva,
 * reserve virtual, kaki fee — jadi orang yang punya audiens tetapi bukan pembangun tidak
 * punya satu baris pun yang menyebut dirinya.
 *
 * BATAS YANG DIJAGA DI SINI, dan ini yang paling mudah dilanggar oleh seksi semacam ini:
 * tidak ada baris di bawah yang menyatakan integrasi, kemitraan, atau perkakas khusus
 * untuk kelompok mana pun. Tidak ada SDK game, tidak ada alat lisensi IP, tidak ada
 * dashboard kreator. Yang dijanjikan setiap kartu identik dan sudah ada di kontrak: satu
 * transaksi membuka pasar untuk sesuatu yang kamu miliki, tanpa setoran. Perbedaan
 * antar-kartu adalah SIAPA yang membacanya, bukan fitur yang berbeda.
 *
 * Kalau suatu saat salah satunya mendapat perkakas sungguhan, kartunya boleh menyebutnya.
 * Sampai itu terjadi, menuliskannya berarti mengiklankan permukaan yang tidak ada — dan
 * itu kelas kesalahan yang sudah dua kali membuat halaman ini harus diperbaiki.
 */
const AUDIENCES: { icon: typeof Music; label: string; line: string }[] = [
  { icon: Music, label: "Artists", line: "Turn a following into a market that pays you per trade." },
  { icon: Video, label: "Content creators", line: "Let an audience hold a position instead of only watching." },
  { icon: Megaphone, label: "Influencers", line: "Price attention openly rather than through private deals." },
  { icon: Users, label: "Communities", line: "One shared market, no treasurer holding the keys." },
  { icon: Bot, label: "AI agents", line: "Bind an ERC-8004 identity and give an agent its own market." },
  { icon: Gamepad2, label: "Games", line: "An in-game asset that trades outside the game, permanently." },
  { icon: Code2, label: "Builders & protocols", line: "A market that opens on the first block, with no pool to fund." },
  { icon: KeyRound, label: "IP owners", line: "License nothing. Let the market price the thing itself." },
];

/**
 * Empat jaminan, dan semuanya diperiksa ke sumber kontrak sebelum ditulis di sini.
 *
 * Frasa "No LP lock" SENGAJA TIDAK dipakai meski itu yang paling sering diminta. Ia
 * menyiratkan ada posisi likuiditas yang dikunci untuk sementara, jadi pembaca yang teliti
 * akan bertanya kapan terbuka. Kenyataannya lebih kuat dan lebih sederhana: tidak ada
 * posisi LP sama sekali. Tidak ada yang disetor, dan `AdextoCurve.sol` tidak punya satu pun
 * `withdraw`, `removeLiquidity`, `rescue`, `sweep`, atau `emergency` — nol kemunculan, dan
 * nol `Ownable` yang bisa menambahkannya.
 */
const GUARANTEES = [
  { label: "No liquidity deposit", detail: "the native side of the curve opens as a number, not a balance" },
  { label: "No creator allocation", detail: "100% of supply enters the curve; the creator receives zero tokens" },
  { label: "No privileged mint", detail: "_mint runs once in the constructor; there is no mint function and no owner" },
  { label: "No withdrawal path", detail: "no function in the curve can move reserves out, so none can be added later" },
];

const STEPS = [
  { n: "01", label: "Launch", line: "One transaction. Token, curve and full supply." },
  { n: "02", label: "Trade", line: "The market is fillable on the block it is created." },
  { n: "03", label: "Earn", line: "0.10% of every swap, for as long as it trades." },
];

export default function AudienceGrid() {
  return (
    <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-line">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <p className="kicker justify-center mb-3">Who it is for</p>
        <h2 className="text-3xl sm:text-4xl font-semibold text-ink tracking-tight">
          Not only builders
        </h2>
        <p className="mt-4 text-sm sm:text-base text-ink-soft leading-relaxed">
          The contract does not know what you are. It opens a market for a name you own, takes no deposit,
          and pays you out of the flow. Everything below is the same primitive read by a different person.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-14">
        {AUDIENCES.map(({ icon: Icon, label, line }) => (
          <div key={label} className="card p-5 flex flex-col gap-3">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-cream-3 border border-line">
              <Icon className="w-4 h-4 text-accent" aria-hidden />
            </span>
            <h3 className="text-sm font-semibold text-ink">{label}</h3>
            <p className="text-xs text-ink-soft leading-relaxed">{line}</p>
          </div>
        ))}
      </div>

      <div className="glass-panel rounded-2xl border border-line p-8 sm:p-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-10">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-4">
              <span className="text-[11px] font-semibold text-accent pt-0.5" data-numeric>
                {s.n}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">{s.label}</h3>
                <p className="text-xs text-ink-soft leading-relaxed mt-1">{s.line}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 pt-8 border-t border-line">
          {GUARANTEES.map((g) => (
            <div key={g.label} className="text-xs">
              <span className="font-semibold text-ink">{g.label}</span>
              <span className="text-ink-soft"> — {g.detail}</span>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center gap-4">
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm bg-accent hover:bg-accent-strong text-white transition-colors"
          >
            Open a market
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/docs"
            className="text-xs font-semibold text-ink-soft hover:text-ink underline-offset-4 hover:underline transition-colors"
          >
            Read the contracts these claims come from
          </Link>
        </div>
      </div>
    </section>
  );
}
