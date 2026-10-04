import Link from "next/link";
import { LAUNCH_SENTENCE } from "@/lib/launch-state";
import { CHAIN_LIST } from "@/lib/chains";
import { FOOTER_COLUMNS, SOCIAL_LINKS } from "@/config/nav";
import ChainChip from "@/components/ui/ChainChip";

/**
 * Footer situs.
 *
 * Kolom tautan datang dari `src/config/nav.ts` (U1.3, 4 Okt): Markets · Launch · Build (+ Verify) ·
 * Company, sama persis dengan mega menu desktop dan lembar More. Sebelumnya footer punya daftar dan
 * label sendiri ("Protocol & Apps", "Architecture & Trust") dan tiga tautan ke /docs ("Technical status",
 * "Deployed contract registry", dan "Docs" di baris bawah); sekarang /docs muncul sekali, di kolom Build.
 *
 * Tautan kolom: baris setinggi 40 px selebar kolom di layar sentuh (di bawah lg), tautan biasa di
 * desktop. Baseline 3 Okt: tautan setinggi 13 px berjarak 7 px adalah ±11 ERROR tap<24 di SETIAP halaman
 * ponsel (WCAG 2.2 SC 2.5.8). Selebar kolom, bukan selebar teks, supaya tautan pendek seperti "Swap" juga
 * ≥ 32 px lebarnya. Deskripsi item nav.ts ikut sebagai `title` (petunjuk hover).
 */
const COL_LINK = "flex min-h-[40px] w-full items-center transition-colors hover:text-accent lg:inline lg:min-h-0 lg:w-auto";
const COL_LIST = "lg:space-y-2";
const COL_HEAD = "font-bold text-ink mb-1 uppercase tracking-wider text-xs lg:mb-3";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-cream-2/60 relative z-10 overflow-hidden text-ink-soft text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Dua kolom di ponsel, bukan blok bertumpuk: kelompok tautan itu pendek, jadi dua kolom
            memuat keduanya tanpa memepetkan apa pun. Blok merek tetap selebar penuh di ponsel: di
            dalamnya ada paragraf, dan paragraf dalam kolom selebar setengah ponsel pecah menjadi
            dua-tiga kata per baris. Mulai lg: merek 2 kolom + 4 kolom tautan. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-6 lg:gap-8">
          <div className="col-span-2 space-y-3">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="ADEXTO Protocol Logo" className="w-12 h-12 object-contain shrink-0" />
              <span className="font-display font-semibold text-ink tracking-tight text-lg block leading-tight">adexto<span className="text-accent">.</span></span>
            </div>
            {/* Apa yang benar-benar dilakukan produk, bukan kepanjangan nama atau klaim TEE yang tidak
                kami verifikasi. Urutan chain mengikuti CHAIN_LIST. */}
            <p className="max-w-sm text-ink-soft leading-relaxed text-xs">
              Launch an agent token on a bonding curve that needs no liquidity deposit, on Monad, Arbitrum,
              Robinhood Chain, Base or 0G. The creator is paid out of every swap instead of holding an allocation.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {/* Bukan "● 0G TEE Mainnet Ready": agen memanggil router 0G lewat HTTPS biasa dan tidak ada
                  kode di repo ini yang memverifikasi attestation, jadi TEE-nya klaim 0G, bukan klaim kami.
                  Tinggi 32 px di layar sentuh: pil ini tautan (baseline 3 Okt: 20 px, ERROR tap<24). */}
              <Link
                href="/docs"
                className="inline-flex min-h-[32px] items-center whitespace-nowrap px-2.5 rounded text-[10px] font-bold bg-cream-3 text-ink-soft border border-line hover:text-ink lg:min-h-0 lg:px-2 lg:py-0.5"
                title="0G router reports Intel TDX attestation via dstack. ADEXTO reads that declaration; it does not verify the raw quote."
              >
                0G TeeML · TDX reported
              </Link>
              {/* Nama fitur, bukan keadaan, jadi bukan warna peringatan. */}
              <span className="inline-flex min-h-[32px] items-center whitespace-nowrap px-2.5 rounded text-[10px] font-bold bg-accent-soft text-accent border border-accent/30 lg:min-h-0 lg:px-2 lg:py-0.5">
                Cloudflare x402 Edge
              </span>
            </div>
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <div key={col.key}>
              <h4 className={COL_HEAD}>{col.label}</h4>
              <ul className={`${COL_LIST} text-ink-soft`}>
                {col.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} title={item.description} className={COL_LINK}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Daftar chain: logo + nama pendek (ChainChip) + chain id. Tanpa kata "Live" dan tanpa titik
            berkedip: dulu kolom ini berbunyi "Live" di setiap chain sementara factory belum di-broadcast,
            dan pembaca memercayai pernyataan yang lebih berani. Kalimat status peluncuran datang dari
            LAUNCH_SENTENCE, supaya footer di setiap halaman tidak pernah basi sendiri. */}
        <div className="mt-8 border-t border-line pt-6">
          <h4 className="font-bold text-ink mb-3 uppercase tracking-wider text-xs">EVM chains</h4>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {CHAIN_LIST.filter((c) => c.key !== "Devchain").map((c) => (
              <li key={c.chainId} className="flex items-center gap-1.5">
                <ChainChip chain={c} />
                <span className="font-mono text-[11px] text-ink-faint">{c.chainId}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">{LAUNCH_SENTENCE}</p>
        </div>

        <div className="mt-8 pt-6 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink-soft">
          {/* Bukan "Zero central points of failure": aplikasinya satu kontainer di satu VPS. Yang memang
              tanpa titik kegagalan pusat adalah KONTRAKNYA, jadi itu yang ditulis. */}
          <p>© 2026 ADEXTO (adexto.xyz). Curves are immutable and have no withdrawal function.</p>
          {/* X, GitHub, Telegram dari nav.ts. Docs tidak diulang di sini: ia sudah ada di kolom Build. */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            {SOCIAL_LINKS.map(({ href, label, name, icon: Icon }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={name}
                className="flex min-h-[40px] items-center gap-1.5 px-1 text-ink-soft hover:text-accent transition-colors font-semibold lg:min-h-0 lg:px-0"
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                <span>{label}</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ))}
          </div>
        </div>
      </div>
      {/* Wordmark raksasa sebagai penutup halaman. Dekorasi murni, tidak terbaca mesin. */}
      <div aria-hidden="true" className="wordmark-watermark -mb-[0.18em] text-center text-[26vw] lg:text-[17rem]">
        adexto.
      </div>
    </footer>
  );
}
