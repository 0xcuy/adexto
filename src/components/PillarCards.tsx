import Link from "next/link";
import {
  Cpu,
  Layers,
  Coins,
  CloudLightning,
  ShieldCheck,
  TrendingUp,
  Lock,
  Globe,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * Empat pilar yang dibuat satu transaksi peluncuran: A - DEX - T - O.
 *
 * KENAPA JADI SATU KOMPONEN
 *
 * Sebelumnya empat kartu ini adalah empat blok JSX yang disalin penuh, sekitar 40
 * baris masing-masing, berbeda hanya pada isinya. Dua akibatnya bisa ditunjukkan,
 * bukan diperkirakan:
 *
 *   1. Ia sudah mulai berpisah. Kartu 4 memakai `bg-accent/10` untuk kotak ikon dan
 *      lingkaran blur-nya, sementara tiga lainnya memakai `bg-accent-soft`. Tidak ada
 *      yang memutuskan itu; ia sisa dari menyalin lalu menyunting satu.
 *   2. Memperbaiki tampilan berarti menyunting empat tempat, dan itulah kelas kerja
 *      yang paling sering meninggalkan sisa di repo ini.
 *
 * KENAPA TERASA MONOTON \u2014 DAN INI BUKAN SOAL SELERA
 *
 * Tiga dari empat efek hover-nya tidak melakukan apa pun, karena keadaan hover-nya
 * IDENTIK dengan keadaan istirahatnya:
 *
 *   hover:border-accent/30       padahal border istirahatnya sudah border-accent/30
 *   group-hover:bg-accent-soft   padahal latar lingkaran blur-nya sudah bg-accent-soft
 *   group-hover:bg-accent/10     sama, pada kartu 4
 *
 * Jadi satu-satunya yang benar-benar berubah saat kursor masuk adalah warna judul dan
 * skala kotak ikon. Kartunya memang hampir tidak merespons.
 *
 * Ditambah lagi keempat kartu memakai `border-accent/30` sebagai keadaan ISTIRAHAT.
 * Kalau semua bergaris ungu, ungu berhenti menandakan apa pun \u2014 dan tidak ada lagi
 * yang tersisa untuk menandai hover. Sekarang garis istirahatnya hairline netral dan
 * aksen dipakai hanya saat disentuh.
 *
 * YANG MEMBEDAKAN TIAP KARTU: angka besar berhantu di sudut. Palet situs ini satu
 * warna aksen dan itu aturan yang tidak diubah, jadi identitas per kartu tidak boleh
 * datang dari warna. Angka 01\u201304 memberi tiap kartu satu bentuk yang berbeda tanpa
 * menambah satu warna pun. Huruf A/DEX/T/O tetap ada karena berempat ia mengeja
 * ADEXTO \u2014 itu isi seksinya, bukan hiasan.
 */

interface Pillar {
  /** 01\u201304. Dirender besar dan sangat pudar sebagai penanda identitas kartu. */
  no: string;
  /** Berempat mengeja ADEXTO. */
  letter: string;
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  body: ReactNode;
  footer: {
    label: string;
    Icon: LucideIcon;
    /** Kalau ada, kaki kartu jadi tautan. */
    href?: string;
    /** true = kaki kartu adalah CATATAN, bukan pencapaian; warnanya diredam. */
    caveat?: boolean;
  };
}

const PILLARS: Pillar[] = [
  {
    no: "01",
    letter: "A",
    Icon: Cpu,
    title: "Autonomous Agent",
    subtitle: "0G Compute · TeeML",
    // Kartu ini sudah dua kali salah. Mula-mula: "hardware-isolated AMD SEV-SNP
    // enclaves" dengan lencana "Hardware Attested", tanpa satu pun pemeriksaan. Lalu
    // klaim TEE-nya dihapus seluruhnya, dan itu juga salah \u2014 router 0G memang
    // menyatakan attestation per model. Hardware-nya juga bukan SEV-SNP: router
    // berkata Intel TDX, diverifikasi lewat dstack. Halaman /docs membaca deklarasi
    // itu langsung dari router saat render, dan /api/tee menyajikannya mentah.
    body: (
      <>
        Each token is bound to an agent address at launch. The agent runs on 0G Compute, whose router reports
        Intel TDX attestation via dstack for every model we call. We read that declaration rather than assert
        it — but we do not verify the raw quote ourselves.
      </>
    ),
    footer: { label: "See the live attestation table", Icon: ShieldCheck, href: "/docs" },
  },
  {
    no: "02",
    letter: "DEX",
    Icon: Layers,
    title: "Sovereign DEX",
    subtitle: "Sovereign Bonding Curve",
    body: (
      <>
        A curve that opens against a virtual reserve, so a launch needs no liquidity deposit. The 0.30% swap
        fee splits three ways on-chain: 0.15% depth stays in the curve, 0.10% to the creator, 0.05% to the
        buyback vault.
      </>
    ),
    // Bukan "100% Fee Retained": creator menerima 0.10% dari total fee, bukan seluruh
    // fee. Protokol mengambil 0.05% (lihat /pitch), sisanya mengendap di kurva.
    footer: { label: "Creator paid every swap", Icon: TrendingUp },
  },
  {
    no: "03",
    letter: "T",
    Icon: Coins,
    title: "Token Factory",
    subtitle: "ERC-20, agent-bound",
    // Tiga koreksi tersimpan di sini.
    //   "ERC-8004": AdextoToken hanya menyimpan satu `address immutable agentIdentity`.
    //   Tidak ada supportsInterface, tidak ada registry identitas/reputasi/validasi
    //   seperti yang ditetapkan standar itu, jadi kepatuhannya tidak bisa ditunjukkan.
    //   "1-Click": peluncuran menuntut sambung dompet, tanda tangan attestation, lalu
    //   satu transaksi PER chain. (Langkah proof World ID sudah tidak ada — gerbangnya
    //   dicabut — tapi "1-Click" tetap salah karena sisa langkahnya masih lebih dari
    //   satu, dan tiap chain punya transaksinya sendiri.)
    //   "transfer hook is bound to one immutable agent address" salah menyebut apa yang
    //   mengikat apa: `_update` mengecualikan `_launcher` (factory) supaya seeding 100%
    //   supply ke kurva lolos batas 1%; `agentIdentity` tidak muncul di jalur transfer
    //   sama sekali \u2014 ia menjaga `executeTreasuryBuyback`. Token ini juga TIDAK punya
    //   owner: `Ownable` dibuang karena owner()-nya adalah factory yang tidak punya
    //   fungsi untuk memakainya, sehingga explorer melaporkan tuas admin yang tidak
    //   pernah ada. Itu hal pertama yang dicek pembeli, jadi disebut.
    body: (
      <>
        An ERC-20 with <strong className="font-semibold text-ink">no owner at all</strong> — no admin function
        exists to renounce, because none was ever added. It carries one immutable agent address that cannot be
        reassigned. 100% of supply enters the curve and is tradable from the launch transaction onward, with a
        1%-of-supply transfer cap for the first 5 blocks.
      </>
    ),
    footer: { label: "No owner · agent binding immutable", Icon: Lock },
  },
  {
    no: "04",
    letter: "O",
    Icon: CloudLightning,
    title: "Orchestrator",
    subtitle: "Cloudflare Workers x402",
    body: (
      <>
        An HTTP 402 gate in front of the agent&apos;s API, so another machine can discover the price and the
        settlement vault without a human in the loop. The buyback vault and its burn path exist in the curve;
        connecting edge revenue to it is still to come.
      </>
    ),
    // Kaki kartu ini CATATAN, bukan pencapaian \u2014 402 hidup, settlement belum. Warnanya
    // diredam supaya tidak terbaca seperti tiga kaki kartu lain yang menyatakan sesuatu
    // yang sudah berjalan.
    footer: { label: "402 challenge live · settlement pending", Icon: Globe, caveat: true },
  },
];

function PillarCard({ pillar, index }: { pillar: Pillar; index: number }) {
  const { Icon, footer } = pillar;
  const FooterIcon = footer.Icon;

  const footerInner = (
    <>
      <span>{footer.label}</span>
      <FooterIcon className={`h-4 w-4 shrink-0 ${footer.caveat ? "text-ink-faint" : "text-accent"}`} />
    </>
  );
  const footerClass = `mt-5 flex items-center justify-between gap-3 border-t border-line pt-4 text-[11px] font-semibold ${
    footer.caveat ? "text-ink-soft" : "text-accent"
  }`;

  return (
    <article
      className="adexto-rise adexto-lift group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-line bg-cream-1 p-6"
      style={{ "--rise-d": `${index * 90}ms` } as React.CSSProperties}
    >
      {/* Rel aksen di tepi atas, tumbuh dari kiri saat disentuh. Satu-satunya tempat
          aksen dipakai pada kartu ini, jadi ia benar-benar menandai sesuatu. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2px] origin-left scale-x-0 bg-accent transition-transform duration-500 ease-out group-hover:scale-x-100"
      />

      {/* Angka besar berhantu: penanda identitas kartu tanpa menambah warna. Sengaja
          terpotong tepi supaya jelas terbaca sebagai tekstur, bukan sebagai data. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-5 -right-1 select-none text-[5.5rem] font-semibold leading-none tracking-tighter text-ink/[0.045]"
        data-numeric
      >
        {pillar.no}
      </span>

      <div className="relative space-y-4">
        <div className="flex items-start justify-between gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-cream-2 text-accent transition-colors duration-300 group-hover:border-accent/30 group-hover:bg-accent-soft">
            <Icon className="h-5 w-5" />
          </span>
          <span className="shrink-0 rounded-full border border-line bg-cream-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint transition-colors duration-300 group-hover:border-accent/30 group-hover:text-accent">
            {pillar.letter}
          </span>
        </div>

        <div>
          <h3 className="text-lg font-semibold tracking-tight text-ink">{pillar.title}</h3>
          <p className="mt-0.5 text-[11px] font-semibold text-accent">{pillar.subtitle}</p>
        </div>

        <p className="text-xs leading-relaxed text-ink-soft">{pillar.body}</p>
      </div>

      {footer.href ? (
        <Link href={footer.href} className={`${footerClass} relative hover:underline`}>
          {footerInner}
        </Link>
      ) : (
        <div className={`${footerClass} relative`}>{footerInner}</div>
      )}
    </article>
  );
}

export default function PillarCards() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {PILLARS.map((p, i) => (
        <PillarCard key={p.no} pillar={p} index={i} />
      ))}
    </div>
  );
}
