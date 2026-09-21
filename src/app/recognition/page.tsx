import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ExternalLink, Info } from "lucide-react";

/**
 * Halaman pengakuan pihak ketiga.
 *
 * KENAPA HALAMAN, BUKAN GAMBAR DI README
 *
 * Bukti ini dipakai di dua tempat: field Links pada progress update Monad Metropolis, dan
 * README `adexto-monad`. Form progress update tidak menerima lampiran gambar, jadi bukti
 * harus punya URL. Satu halaman melayani keduanya.
 *
 * Menaruh berkasnya langsung di README juga salah bentuk. Screenshot tidak bisa diverifikasi
 * — ia bisa disunting — sementara halaman ini bisa menampilkan gambar DAN menautkan sumber
 * aslinya di sebelahnya, jadi pembaca memeriksa yang asli, bukan salinan kami.
 *
 * KENAPA KATA-KATA MEREKA TIDAK DIKUTIP SEBAGAI KATA KAMI
 *
 * Kedua artefak 0G menyebut proyek ini "launchpad". Bulan ini posisinya justru dipindah dari
 * situ: satu transaksi membuka PASAR yang langsung bisa diperdagangkan, bukan menerbitkan
 * token lalu menunggu tempat berdagang. Jadi halaman ini menyebutkan fakta terpilihnya dan
 * klasifikasi yang mereka berikan, lalu menyatakan di mana istilah mereka berbeda dari
 * istilah kami — bukan diam-diam mengadopsi framing yang sudah ditinggalkan.
 *
 * CAVEAT MEREKA DIKUTIP DI SINI, BUKAN DIBIARKAN DITEMUKAN
 *
 * Slide Taipei memuat catatan bahwa volume on-chain proyek ini masih sangat rendah. Itu
 * dikutip utuh di bawah. Pembaca yang menemukannya sendiri setelah kami sembunyikan jauh
 * lebih mahal daripada kami yang menyebutkannya lebih dulu — dan isinya memang sama dengan
 * yang README kami sendiri nyatakan.
 *
 * YANG SENGAJA TIDAK ADA DI SINI
 *
 * Timeline akselerator memuat agenda "Demo at Token2049" pada pekan 5 Oktober 2026. Itu
 * JADWAL, bukan sesuatu yang sudah terjadi, jadi ia tidak disebut sebagai pencapaian. Kalau
 * nanti terjadi, ia ditambahkan setelahnya.
 *
 * Dokumen agenda internal menyebut jumlah tim yang lebih banyak daripada delapan nama di
 * pengumuman Demo Day. Halaman ini hanya menyebut yang delapan itu, karena itulah yang ada
 * di artefak publik yang bisa ditautkan. Angka yang tidak bisa diperiksa pembaca tidak
 * ditulis.
 */
export const metadata = {
  title: "Recognition — ADEXTO",
  description:
    "Third-party material about ADEXTO: the 0G Atlas Founder House Demo Day line-up, 0G's A2A economy landscape, and a 0G developer showcase. Each item links to its source, and the places where their wording differs from ours are stated.",
};

const SHOTS: {
  src: string;
  w: number;
  h: number;
  alt: string;
  eyebrow: string;
  title: string;
  when: string;
  body: string[];
  quote?: { text: string; note: string };
}[] = [
  {
    src: "/recognition/0g-atlas-founder-house-demo-day.jpeg",
    w: 1440,
    h: 741,
    alt: "2026 Atlas Founder House Demo Day announcement by 0G and HackQuest, listing eight projects: SkillFun, Maneki AI, Herald Protocol, VEYRA, Hunch, BlindMarket, Hash PayLink and Adexto.",
    eyebrow: "0G · HackQuest",
    title: "Atlas Founder House Demo Day",
    when: "Demo Day 18 September 2026 · house ran 15–18 September, Bali",
    body: [
      "ADEXTO is one of eight projects named in the Demo Day announcement, alongside SkillFun, Maneki AI, Herald Protocol, VEYRA, Hunch, BlindMarket and Hash PayLink. The session opened at 10:00 (UTC+8) and each team had ten minutes — eight to present, two for questions.",
      "What was demonstrated is the same thing anyone can open: a market launched live on 0G mainnet during the recording, then bought by an AI agent through the MCP server. Both the market and the purchase are on chain and linked from the explorer.",
    ],
  },
  {
    src: "/recognition/0g-a2a-economy-landscape.jpeg",
    w: 1301,
    h: 1600,
    alt: "0G's A2A economy landscape diagram. ADEXTO appears in the Markets and coordination row, marked as live on 0G mainnet and tagged Base, Arb and Monad.",
    eyebrow: "0G",
    title: "A2A economy landscape",
    when: "Published for the Atlas Founder House",
    body: [
      "0G placed ADEXTO in the Markets & coordination row — venues where agents trade skills, tasks and capital with each other — and marked it with the colour they define as live on 0G mainnet or deeply integrated with 0G modules.",
      "The detail worth pointing at is the chain tag: Base / Arb / Monad. That is someone else stating the deployment is multi-chain, rather than this repository claiming it. Their card also notes the optional ERC-8004 binding and that machines buy directly over x402 and MCP, which matches what the contracts do.",
      "Where their wording differs from ours: the card calls it an agent token launchpad. We stopped describing it that way, because a launchpad hands over a token and a page, and what one transaction opens here is a working market — a curve that trades from its first block, with no liquidity deposit and no creator allocation.",
    ],
  },
  {
    src: "/recognition/0g-taipei-developer-showcase.jpeg",
    w: 1273,
    h: 704,
    alt: "0G developer showcase slide titled 'Someone is already building this way', featuring 4lpha and ADEXTO, with a footnote that both are early stage.",
    eyebrow: "0G · Zero Gravity Taipei",
    title: "Developer showcase",
    when: "Separate event from the Founder House",
    body: [
      "A 0G developer-facing slide titled “Someone is already building this way”, featuring ADEXTO next to 4lpha. This is a different event from the Bali Founder House and is listed separately rather than folded into it.",
      "Their summary of the 0G surfaces in use is accurate: the token lives on 0G mainnet, inference routes through the Compute Router, and launch metadata is anchored to 0G DA. Their line that every token binds to an immutable agent address, optionally registered under ERC-8004, is also what the contracts do — the address is fixed at construction and the registry check happens at launch.",
    ],
    quote: {
      text: "Both are early-stage. 4lpha remains in developer preview and labels its sample figures as not live performance; ADEXTO's on-chain volume is still very low and it states plainly that it cannot independently verify raw TDX quotes.",
      note: "Quoted here rather than left to be discovered. Both halves are true and both are already stated in this project's own documentation: trading volume is small, and the attestation label printed for each model is the router's own report, attributed to it, because the raw quote is not fetched or checked here.",
    },
  },
];

export default function RecognitionPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="mb-10">
        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ink-faint">
          Third-party material
        </p>
        <h1 className="mb-3 text-3xl font-semibold text-ink">Recognition</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-soft">
          Material published by other people about this project, with each item linked to its source. It is collected
          here rather than embedded in a README because a screenshot cannot be verified and a link can.
        </p>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-ink-faint">
          Selection into a programme is not a technical claim, and nothing on this page is offered as one. What the
          protocol does is checkable in the{" "}
          <Link href="/security" className="font-bold text-accent hover:underline">
            contracts and the analyser output
          </Link>
          , and every live market is readable in the{" "}
          <Link href="/explorer" className="font-bold text-accent hover:underline">
            explorer
          </Link>
          .
        </p>
      </div>

      <div className="space-y-12">
        {SHOTS.map((s) => (
          <section key={s.src}>
            <div className="mb-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent">{s.eyebrow}</p>
              <h2 className="text-xl font-semibold text-ink">{s.title}</h2>
              <p className="font-mono text-[11px] text-ink-faint">{s.when}</p>
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-cream-3/[0.04]">
              <Image
                src={s.src}
                width={s.w}
                height={s.h}
                alt={s.alt}
                className="h-auto w-full"
                sizes="(max-width: 896px) 100vw, 896px"
              />
            </div>
            <div className="mt-4 space-y-3">
              {s.body.map((p) => (
                <p key={p.slice(0, 40)} className="text-[13px] leading-relaxed text-ink-soft">
                  {p}
                </p>
              ))}
              {s.quote && (
                <div className="rounded-xl border border-line bg-cream-3/[0.06] p-4">
                  <div className="mb-2 flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                    <p className="text-[12px] italic leading-relaxed text-ink">“{s.quote.text}”</p>
                  </div>
                  <p className="pl-6 text-[11px] leading-relaxed text-ink-faint">{s.quote.note}</p>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-12 rounded-xl border border-line p-5">
        <h2 className="mb-2 text-base font-semibold text-ink">Sources</h2>
        <p className="mb-3 text-[12px] leading-relaxed text-ink-soft">
          The images above are the publishers&apos; own artwork, reproduced so the claim on this page can be checked
          against what they actually published. Open the originals rather than trusting the copies:
        </p>
        <ul className="space-y-2 text-[12px]">
          <li>
            <a
              href="https://x.com/HackQuest_/status/2100551458341138738"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-bold text-accent hover:underline"
            >
              Demo Day announcement, HackQuest <ExternalLink className="h-3 w-3" />
            </a>
          </li>
          <li>
            <a
              href="https://github.com/0gfoundation"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-bold text-accent hover:underline"
            >
              0G Foundation, credited on the showcase slide <ExternalLink className="h-3 w-3" />
            </a>
          </li>
        </ul>
        <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
          The presentation deck used at the Founder House is served at{" "}
          <a href="https://day2.adexto.xyz" className="font-bold text-accent hover:underline">
            day2.adexto.xyz
          </a>
          .
        </p>
      </section>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/explorer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-bold text-white hover:opacity-90"
        >
          Open the live markets <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/security"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-4 py-2 text-[13px] font-bold text-ink hover:bg-cream-3/[0.06]"
        >
          Analyser output and guarantees
        </Link>
      </div>
    </main>
  );
}
