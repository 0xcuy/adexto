import Link from "next/link";
import { BookOpen, Github, Send, Twitter } from "lucide-react";
import { LAUNCH_SENTENCE } from "@/lib/launch-state";

/**
 * Tautan kolom: baris setinggi 40 px selebar kolom di layar sentuh (di bawah lg), tautan biasa
 * di desktop. Baseline 3 Okt: tautan setinggi 13 px berjarak 7 px adalah ±11 ERROR tap<24 di
 * SETIAP halaman ponsel (WCAG 2.2 SC 2.5.8). Selebar kolom, bukan selebar teks, supaya tautan
 * pendek seperti "Swap" juga ≥ 32 px lebarnya.
 */
// 28 px (dulu 40 px): owner 4 Okt 15:45, jarak antar tautan di ponsel terlalu jauh. Masih ≥ 24 px (SC 2.5.8).
const COL_LINK = "flex min-h-[28px] w-full items-center transition-colors hover:text-accent lg:inline lg:min-h-0 lg:w-auto";
const COL_LIST = "lg:space-y-2";
const COL_HEAD = "font-bold text-ink mb-1 uppercase tracking-wider text-xs lg:mb-3";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-cream-2/60 relative z-10 overflow-hidden text-ink-soft text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Dua kolom di ponsel, bukan empat blok bertumpuk.
            Sebelumnya `grid-cols-1` di bawah 640px, jadi keempat kelompok tautan berbaris
            vertikal dan footer sendirian setinggi satu layar penuh — pembaca harus menggulir
            melewati seluruhnya untuk mencapai baris hak cipta. Kelompok tautan itu pendek
            (4–6 baris), jadi dua kolom memuat keduanya tanpa memepetkan apa pun.
            Blok merek tetap selebar penuh: di dalamnya ada paragraf, dan paragraf dalam kolom
            selebar setengah ponsel pecah menjadi dua-tiga kata per baris. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-8">
          <div className="col-span-2 space-y-3 lg:col-span-1">
            <div className="flex items-center gap-3">
              {/* Dulu logo ini dibungkus kotak putih ber-border. Karena logonya
                  sudah tidak punya plat sendiri, kotak itu jadi kotak di dalam
                  kotak dan membuatnya terlihat sesak. Dibuang. */}
              <img src="/logo.svg" alt="ADEXTO Protocol Logo" className="w-12 h-12 object-contain shrink-0" />
              {/* Kepanjangan "Autonomous Decentralized EXchange & Token Orchestrator" dicabut dari
                  bawah wordmark (2026-09-30): produknya sekarang tempat membuka pasar, bukan
                  "orkestrator", dan paragraf di bawah sudah menyebut apa yang dilakukannya. */}
              <span className="font-display font-semibold text-ink tracking-tight text-lg block leading-tight">adexto<span className="text-accent">.</span></span>
            </div>
            {/* Dulu kalimat ini mengulang nama panjangnya lalu menambahkan
                "powered by 0G Private Computer (TEE)". Bagian TEE-nya adalah klaim yang tidak
                kami verifikasi. Diganti dengan apa yang benar-benar dilakukan produk. Urutan
                chain mengikuti CHAIN_LIST: Monad, Arbitrum, Base, 0G. */}
            <p className="text-ink-soft leading-relaxed text-xs">
              Launch an agent token on a bonding curve that needs no liquidity deposit, on Monad, Arbitrum,
              Robinhood Chain, Base or 0G. The creator is paid out of every swap instead of holding an allocation.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {/* Dulu "● 0G TEE Mainnet Ready" dengan titik hijau — dan titik hijau
                  di footer berarti "sedang berjalan". Yang benar: agen memanggil
                  router 0G lewat HTTPS biasa, dan tidak ada satu baris kode pun di
                  repo ini yang mengambil atau memverifikasi attestation SEV-SNP.
                  Jadi TEE-nya adalah klaim 0G, bukan klaim yang kami buktikan. */}
              {/* Tinggi 32 px di layar sentuh: pil ini tautan, dan setinggi 20 px ia salah satu
                  ERROR tap<24 baseline 3 Okt. `whitespace-nowrap` supaya tidak pecah di 320 px;
                  kalau tidak muat, pilnya turun utuh ke baris berikut (flex-wrap). */}
              <Link
                href="/docs"
                className="inline-flex min-h-[32px] items-center whitespace-nowrap px-2.5 rounded text-[10px] font-bold bg-cream-3 text-ink-soft border border-line hover:text-ink lg:min-h-0 lg:px-2 lg:py-0.5"
                title="0G router reports Intel TDX attestation via dstack. ADEXTO reads that declaration; it does not verify the raw quote."
              >
                0G TeeML · TDX reported
              </Link>
              {/* Amber di sini dulu terbaca sebagai peringatan. Cloudflare x402
                  adalah nama fitur, bukan keadaan, jadi warna peringatan
                  dikembalikan untuk keperluan aslinya. */}
              <span className="inline-flex min-h-[32px] items-center whitespace-nowrap px-2.5 rounded text-[10px] font-bold bg-accent-soft text-accent border border-accent/30 lg:min-h-0 lg:px-2 lg:py-0.5">
                Cloudflare x402 Edge
              </span>
            </div>
          </div>

          <div>
            <h4 className={COL_HEAD}>Protocol &amp; Apps</h4>
            {/* Label diselaraskan dengan header.
                Navbar sudah membuang "Live", "DEX", "DAO" dan "TEE" dari navigasi
                karena itu kata sifat pemasaran, bukan tujuan — tapi footer tidak ikut
                disapu, jadi satu situs memakai dua aturan: header bilang "Swap" dan
                "Explorer", footer bilang "Sovereign DEX Swap" dan "Live Explorer".
                Satu tujuan dengan dua nama membuat pembaca ragu keduanya sama.

                "Live Explorer" juga bukan cuma soal gaya: belum ada satu pun pasar,
                jadi kata "Live" di situ menjanjikan sesuatu yang halaman itu sendiri
                membantah begitu dibuka. */}
            <ul className={`${COL_LIST} text-ink-soft`}>
              <li><Link href="/studio" className={COL_LINK}>Studio</Link></li>
              <li><Link href="/creator" className={COL_LINK}>Creator earnings</Link></li>
              <li><Link href="/explorer" className={COL_LINK}>Explorer</Link></li>
              <li><Link href="/swap" className={COL_LINK}>Swap</Link></li>
              <li><Link href="/agent/demo" className={COL_LINK}>Agent demo</Link></li>
              {/* Ditaruh di sini, bukan di navbar. Navbar sudah memuat enam tautan dan
                  komentarnya mencatat barisnya mepet di 1280 px.

                  Labelnya menyebut APA YANG DIBELI, bukan nama protokolnya saja.
                  "x402" sendirian hanya berarti sesuatu bagi orang yang sudah tahu
                  spesifikasinya; yang lain tidak punya petunjuk bahwa tautan itu soal
                  membeli token lintas chain. */}
              <li><Link href="/x402" className={COL_LINK}>x402 cross-chain buys</Link></li>
              {/* Menunjuk /mcp, BUKAN /api/mcp. Endpointnya JSON-RPC: dibuka di browser ia
                  menjawab galat, jadi tautan footer ke sana akan terasa seperti tautan rusak.
                  Halaman /mcp yang menyebut URL-nya untuk disalin.

                  Labelnya menyebut siapa pemakainya. "MCP server" sendirian hanya berarti
                  sesuatu bagi orang yang sudah tahu protokolnya, sama seperti alasan tautan
                  di atas tidak diberi nama "x402" saja. */}
              <li><Link href="/mcp" className={COL_LINK}>MCP server for agents</Link></li>
            </ul>
          </div>

          <div>
            <h4 className={COL_HEAD}>Architecture &amp; Trust</h4>
            <ul className={`${COL_LIST} text-ink-soft`}>
              <li><Link href="/whitepaper" className={COL_LINK}>Whitepaper &amp; Tokenomics</Link></li>
              {/* Tautan "VC Memorandum & Grants" ke /pitch DICABUT bersama rutenya:
                  halamannya kini di `src/app/_pitch/`, di luar routing. */}
              {/* Dua label ini menjanjikan lebih dari yang ada. Suite MCP belum
                  dibangun sama sekali, dan "Verifiable Compute" menyiratkan kami
                  memeriksa attestation — tidak. Halaman docs sekarang menyatakan
                  status keduanya, jadi tautannya diberi nama sesuai isinya. */}
              <li><Link href="/docs" className={COL_LINK}>Technical status</Link></li>
              {/* Ditaruh di footer, bukan navbar. Navbar sudah memuat enam tautan dan
                  komentarnya mencatat barisnya sudah mepet di 1280 px; menambah entri
                  ketujuh menukar satu masalah dengan masalah lain. */}
              <li><Link href="/security" className={COL_LINK}>Security &amp; analyser output</Link></li>
              {/* Menunjuk /docs, bukan /pitch. Keduanya merender `VerifiedDeploymentCard`
                  yang sama, jadi ini bukan soal alamat mana yang benar — melainkan soal
                  ke mana orang yang cuma ingin memeriksa satu alamat sebaiknya dikirim.
                  Sebelumnya tautan berlabel "Deployed contract registry" menjatuhkan
                  pembaca ke tengah memorandum penggalangan dana, yang menuntut dia
                  melewati proyeksi pendapatan untuk mencapai tabel alamat. /docs adalah
                  halaman status teknis; registry memang termasuk isinya. */}
              <li><Link href="/docs" className={COL_LINK}>Deployed contract registry</Link></li>
            </ul>
          </div>

          {/* Company.
              Judulnya "Company" karena itu kata yang dicari orang di footer, tapi halaman
              About menyebut dengan jelas bahwa tidak ada badan hukum di belakang proyek ini.
              Kolomnya menaut, bukan mengklaim. */}
          <div>
            <h4 className={COL_HEAD}>Company</h4>
            <ul className={COL_LIST}>
              <li><Link href="/about" className={COL_LINK}>About</Link></li>
              <li><Link href="/contact" className={COL_LINK}>Contact</Link></li>
              <li><Link href="/privacy" className={COL_LINK}>Privacy</Link></li>
              <li><Link href="/terms" className={COL_LINK}>Terms</Link></li>
              <li><Link href="/disclaimer" className={COL_LINK}>Disclaimer</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-ink mb-3 uppercase tracking-wider text-xs">EVM chains</h4>
            {/* Dulu empat baris berkotak dengan border cyan/sky/ungu/biru dan empat
                titik berkedip. Kolom footer lain berupa daftar polos, jadi kotak
                pelangi ini terlihat seperti tabel yang tersesat — dan empat animasi
                berkedip sekaligus hanya menarik mata tanpa memberi informasi.
                Sekarang: satu daftar, pemisah hairline, angka rata kanan. */}
            {/* Kata "Live" dihapus dari keempat baris.
                Kolom ini dulu berbunyi "0G Mainnet 16661 Live" di keempat chain,
                dua inci di bawah catatan hero yang menyatakan factory peluncuran
                BELUM di-broadcast. Dua pernyataan itu tidak bisa keduanya benar,
                dan pembaca akan memercayai yang lebih berani. Yang benar: keempat
                chain didukung oleh aplikasi ini, tetapi belum ada satu pun yang
                bisa meluncurkan token. Judul kolomnya juga diubah dari "Supported"
                — kata itu tidak menjanjikan apa-apa — menjadi pernyataan status. */}
            {/* Urutan sama dengan CHAIN_LIST (Monad, Arbitrum, Base, 0G). */}
            <ul className="divide-y divide-line text-xs">
              {[
                { name: "Monad Mainnet", id: "143" },
                { name: "Arbitrum One", id: "42161" },
                { name: "Robinhood Chain", id: "4663" },
                { name: "Base Mainnet", id: "8453" },
                { name: "0G Mainnet", id: "16661" },
              ].map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-ink-soft">{c.name}</span>
                  <span className="font-mono text-[11px] text-ink-faint">{c.id}</span>
                </li>
              ))}
            </ul>
            {/* This footer shows on every page, so a stale sentence here is a
                stale sentence everywhere — it kept saying launching was disabled
                after the curve factory had actually been broadcast to all four
                mainnets, contradicting the studio two scrolls above it. */}
            <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">{LAUNCH_SENTENCE}</p>
          </div>
        </div>

      <div className="mt-8 pt-6 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink-soft">
        {/* "Zero central points of failure" dihapus. Itu tidak benar dan mudah
            dibantah: aplikasi ini satu kontainer di satu VPS di belakang satu
            Caddy, registry-nya satu berkas JSON di satu volume, /api/chat
            bergantung pada satu kunci router, dan gerbang x402 satu Worker.
            Yang memang tanpa titik pusat kegagalan adalah KONTRAKNYA — kurva
            tidak punya fungsi penarikan dan tidak punya pemilik yang bisa
            menghentikannya. Itu klaim yang bisa dipertahankan, jadi itu yang
            ditulis. */}
        <p>© 2026 ADEXTO (adexto.xyz). Curves are immutable and have no withdrawal function.</p>
        {/* Docs, Telegram, X dan GitHub di satu baris: sejak 2026-09-30 ikon X/GitHub tidak lagi di header,
            jadi baris ini tempat utamanya. */}
        {/* 40 px di layar sentuh, sama dengan tautan kolom di atas. */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link
            href="/docs"
            className="flex min-h-[40px] items-center gap-1.5 px-1 text-ink-soft hover:text-accent transition-colors font-semibold lg:min-h-0 lg:px-0"
          >
            <BookOpen className="w-4 h-4" />
            <span>Docs</span>
          </Link>
          <a
            href="https://t.me/adexto"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[40px] items-center gap-1.5 px-1 text-ink-soft hover:text-accent transition-colors font-semibold lg:min-h-0 lg:px-0"
          >
            <Send className="w-4 h-4" />
            <span>adexto</span>
          </a>
          <a
            href="https://x.com/adexto_"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[40px] items-center gap-1.5 px-1 text-ink-soft hover:text-accent transition-colors font-semibold lg:min-h-0 lg:px-0"
          >
            <Twitter className="w-4 h-4" />
            <span>@adexto_</span>
          </a>
          <a
            href="https://github.com/0xcuy/adexto"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[40px] items-center gap-1.5 px-1 text-ink-soft hover:text-accent transition-colors font-semibold lg:min-h-0 lg:px-0"
          >
            <Github className="w-4 h-4" />
            <span>GitHub</span>
          </a>
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
