/* "use client" dibuang bersama tab kode. Satu-satunya yang membuat halaman ini
   komponen klien adalah `activeCodeTab`; tidak ada handler, efek, atau akses
   window lain di sini. Anak-anaknya (StackMarquee, ChainCardStack, PillarCards)
   membawa direktifnya sendiri kalau memang perlu. */

import Link from "next/link";
import StackMarquee from "@/components/StackMarquee";
/* Cpu, Layers, Coins, TrendingUp, Lock dan Globe dibuang dari sini: keenamnya hanya
   dipakai empat kartu pilar, yang sekarang tinggal di PillarCards.tsx bersama
   ikon-ikonnya. */
import {
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  Code2,
  CloudLightning,
  AlertCircle,
  HelpCircle,
  Coins,
  Layers,
  CandlestickChart,
  MessagesSquare,
  Bot,
} from "lucide-react";
import { launchCosts, launchCostRange, formatUsd } from "@/lib/launch-cost";
import { CURVE_FACTORY_GENERATION } from "@/config/contracts";
import ChainCardStack from "@/components/ChainCardStack";
import AudienceGrid from "@/components/AudienceGrid";
import PillarCards from "@/components/PillarCards";

/**
 * Kontrak yang ABI-nya diterbitkan. Daftar ini WAJIB sama dengan isi public/abi/,
 * dan audit_consistency memeriksanya — kalau tidak, halaman ini bisa diam-diam
 * menyembunyikan satu kontrak atau menyebut kontrak yang ABI-nya tidak ada.
 */
const ABI_FILES = ["AdextoFactory", "AdextoCurve", "AdextoToken"] as const;

/**
 * Server component, dan sekarang `async` karena biaya launch dibaca hidup.
 *
 * Angkanya harga gas dikali harga token native, dan keduanya bergerak — harga gas tiap
 * blok. Menuliskannya tangan berarti mengulang pola yang sudah gagal berkali-kali di
 * repo ini: benar saat ditulis, salah beberapa hari kemudian, tanpa ada yang memberi
 * tahu. `launchCosts()` membaca keempat chain berbarengan dan menandai chain yang RPC-nya
 * tidak menjawab sebagai tidak-hidup alih-alih menampilkan perkiraan.
 */
export default async function HomePage() {
  const costs = await launchCosts();
  const costRange = launchCostRange(costs);
  return (
    <div className="flex flex-col items-center justify-center relative">
      {/* ── HERO ────────────────────────────────────────────────────────────────
          Sebelumnya bagian ini memuat: pil status dengan empat pasangan
          nama-chain-plus-ID, judul tiga klausa ("Agents, DEXs & Tokens in
          1-Click"), lede di dalam kotak berbingkai dengan dua kata tercetak
          berwarna, DUA tombol sebesar-besaran (yang kedua menuju memo VC),
          empat kartu berbingkai, lalu satu bilah lencana kepercayaan — semuanya
          di atas lipatan pertama.
          Yang tersisa sekarang: satu janji, satu penjelasan, satu tombol. Alasan
          pemangkasannya: sebuah halaman hanya bisa punya satu langkah berikutnya.
          Kalau ada dua tombol berukuran sama, pembaca berhenti untuk memilih, dan
          "memo due diligence" bukan langkah pertama bagi siapa pun yang datang
          untuk meluncurkan token — tautannya pindah ke footer.
          Angka-angka faktual tidak dibuang, hanya dikeluarkan dari kotaknya:
          empat kartu berbingkai di dalam halaman yang sudah penuh bingkai
          membuat fakta terlihat seperti hiasan. Catatan "factory pending
          broadcast" tetap dipertahankan kata demi kata. */}
      {/* `hero-pad` menggantikan `pt-20 pb-16`: paddingnya menyusut menurut TINGGI
          viewport supaya pita ticker di bawah utuh tanpa menggulir. Alasan
          lengkapnya, termasuk angka hasil pengukurannya, ada di globals.css. */}
      {/* max-w-7xl, bukan 6xl. Diukur: pada 6xl (1008px) kolom teks tinggal 524px
          setelah dikurangi padding, dek, dan gap — dan judul 52,5px di kolom itu
          membungkus empat baris, yang mendorong pita ticker 53px ke bawah lipatan. */}
      <section className="hero-pad relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 xl:grid-cols-[minmax(0,1fr)_auto] xl:gap-10">
          <div className="text-center xl:text-left">
        {/* Angkanya DITURUNKAN dari `CURVE_FACTORY_GENERATION`, tidak ditulis tangan lagi.
            Sebelumnya literal "v0.10.0" dan ia membeku di sana setelah factory 0.11.0
            di-broadcast ke keempat mainnet, jadi baris paling atas halaman utama menyebut
            generasi yang sudah digantikan. Label itu sendiri sudah diperiksa
            audit_consistency terhadap `VERSION` di chain, jadi sekarang tidak ada tempat
            untuk menyimpang.

            Alasan lama tetap berlaku untuk major nol, tapi dasarnya berubah: dulu tertulis
            "belum ada satu pun peluncuran nyata", dan itu sudah tidak benar — ada dua pasar
            hidup. Yang membuatnya tetap 0.x adalah bahwa nomor ini melacak GENERASI
            KONTRAK, dan `VERSION` di keempat factory memang berbunyi 0.11.0. Tag rilis di
            GitHub urutan terpisah untuk manusia. */}
        <p className="kicker mb-6 justify-center xl:justify-start">
          ADEXTO Protocol v{CURVE_FACTORY_GENERATION.version}
        </p>

        {/* Judul lama: "Launch an AI agent token with no liquidity deposit. Gas only."
            Dua cacat, dan keduanya mahal.

            Pertama, "AI agent token" tidak ada backing-nya. Sesi yang menghapus empat
            kartu alat MCP fiktif dari /docs dan mencabut "The agent runs on 0G Compute"
            dari kartu pilar meninggalkan judul ini sebagai SATU-SATUNYA tempat di situs
            yang masih mengklaimnya.

            Kedua — dan ini yang lebih merugikan — "no liquidity deposit / gas only"
            adalah FITUR, dan fitur yang hanya berarti bagi orang yang sudah tahu
            launchpad lain menuntut setoran. Pembaca yang belum tahu itu tidak mendapat
            apa pun dari kalimat tersebut, dan pembaca yang sudah tahu memfilekan kita
            sebagai launchpad lain.

            Yang benar-benar membedakan tidak pernah muncul di layar pertama: pasarnya
            dibuka sebagai VENUE, bukan halaman token. Ada terminal dengan candle 1 detik
            sampai 1 tahun, RSI, MACD, Bollinger, VWAP, order book dan trade feed; ada
            agent yang tahu kurvanya sendiri; dan ada harga yang bisa dibayar mesin dari
            chain lain. Semuanya sudah berjalan, dan semuanya dulu terkubur di scroll
            kelima.

            Biaya dan penghasilan tidak hilang — keduanya pindah ke subjudul, tempat
            angka memang bekerja lebih baik daripada di judul. */}
        <h1 className="text-[2.5rem] sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.06] text-ink mb-6">
          Open a market, <span className="gradient-text">not just a token.</span>
        </h1>

        {/* Ditulis ulang MANFAAT-DULU, dan alasannya bisa diukur, bukan selera.
            Versi lama: "100% of supply opens inside a sovereign bonding curve, so
            there is nothing to seed and no creator allocation to dump. Every swap
            then pays the creator 0.10% and the buyback vault 0.05%, settled
            on-chain for as long as the market keeps trading."

            Dua kalimat, 46 kata, 23 kata per kalimat — sementara halaman pitch
            biasanya 12–18. Dan tiga istilah yang butuh penjelasan ("sovereign
            bonding curve", "seed", "on-chain") datang SEBELUM pembaca tahu ia
            dapat apa. Pembaca harus mencerna mekanismenya lebih dulu untuk
            mencapai manfaatnya.

            Versi ini tiga kalimat pendek, nol jargon, dan urutannya dibalik:
            biaya, penghasilan, lalu alasan pembeli boleh percaya. Tidak ada klaim
            baru: gas-only, 0.10% ke creator, dan 100% supply masuk kurva ketiganya
            sudah terverifikasi di kontrak.

            Angka kaki fee lain dikeluarkan dari kalimat ini supaya ia tidak membawa
            beberapa persentase sekaligus. Semuanya tidak hilang dari halaman — kartu
            pilar "Sovereign DEX" memuat pembagiannya utuh (trader membayar 0.40%:
            0.15% depth / 0.10% creator / 0.05% buyback / 0.10% protokol), dan di sana
            angka itu punya konteks yang membuatnya berarti.

            Yang di kalimat ini TETAP 0.10%, dan itu bukan kelalaian: kaki protokol
            ditambahkan DI ATAS total yang dikonfigurasi creator, bukan dipotong dari
            bagiannya. Jadi penghasilan creator tidak berubah sedikit pun. */}
        {/* Tiga kalimat pendek, dan urutannya disengaja: apa yang terjadi, apa yang kamu
            dapat, lalu kenapa pembeli boleh percaya. Tidak ada jargon di kalimat pertama.

            Kalimat kedua yang menggantikan seluruh cerita "AI agent": ia menyebut EMPAT
            hal yang benar-benar dibuka tiap launch — terminal, agent, harga lintas chain,
            alat mesin — tanpa satu pun mengklaim ada bot yang memperdagangkan pasarnya. */}
        <p className="mx-auto mb-9 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg xl:mx-0">
          One transaction, gas only, no liquidity deposit. It opens as a working venue: live candles, an order
          book, an agent that answers for it, and a price any machine can pay from another chain. You hold none
          of the supply, and <span data-numeric>0.10%</span> of every trade is yours for as long as it trades.
        </p>

        <div className="flex flex-col items-center justify-center gap-5 sm:flex-row xl:justify-start">
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-[15px] bg-accent hover:bg-accent-strong text-white transition-colors"
          >
            Open Studio
            <ArrowRight className="w-4 h-4" />
          </Link>
          {/* Tautan bukti menunjuk /explorer, BUKAN satu halaman token.
              Menyebut satu ticker di landing page adalah kesalahan yang sama dengan kolom
              fakta "$ADEXTO is live on 0G" yang baru dicabut: halaman layanan langsung
              terbaca sebagai jualan token, dan pembaca menyimpulkan produknya adalah
              koin itu. /explorer memperlihatkan pasar apa pun yang hidup, jadi ia juga
              tidak perlu disunting setiap ada peluncuran baru. */}
          <Link
            href="/explorer"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-[15px] border border-line text-ink hover:border-accent hover:text-accent transition-colors"
          >
            See a live market
            <ArrowRight className="w-4 h-4" />
          </Link>
            </div>
          </div>

          {/* Tumpukan kartu chain, hanya dari xl (1280px) ke atas.
              Ambangnya lg dulu, dan diukur ternyata salah: pada 1024px dek selebar
              ini terpotong 120px oleh tepi viewport, dan kolom teks yang tersisa
              memaksa judulnya membungkus jadi lima baris. Di bawah xl hero kembali
              satu kolom terpusat — hiasan tidak boleh memakan tempat kalimatnya. */}
          <div className="hidden xl:block">
            <ChainCardStack />
          </div>
        </div>
      </section>

      {/* Ticker stack pindah ke ATAS deret fakta, bukan di bawahnya.
          Alasannya diukur, bukan selera: dengan urutan lama, pita ini mulai di
          756px dan berakhir di 997px, sehingga di layar 1440x800 — tinggi laptop
          paling umum — 197px terbawahnya tidak pernah terlihat tanpa menggulir.
          Yang menyisipkan jarak itu adalah deret <dl> di bawah (mt-16 + pt-8 +
          isi ≈ 170px), bukan hero-nya sendiri.

          Pilihan lain adalah memampatkan padding hero sampai pita itu terangkat,
          tetapi menghitungnya menunjukkan perlu ~140px dan satu-satunya cara
          mendapatkannya adalah merusak tipografi hero. Menukar urutan memberi
          hasil yang sama tanpa mengubah satu ukuran huruf pun, dan urutannya
          justru lebih dekat ke maksud yang sudah ditulis di komentar lama:
          janji utama -> apa yang menopangnya -> angka-angkanya. */}
      <StackMarquee />

      <section className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16">
        {/* Fakta, tanpa kotak. Pita ticker di atas sudah membawa border-y sendiri,
            jadi `border-t` milik <dl> ini dibuang — kalau tidak, hasilnya dua garis
            hairline sejajar berjarak beberapa piksel, yang terbaca seperti cacat
            render alih-alih pemisah. */}
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-8 text-left">
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-ink-faint">Cost to launch</dt>
            <dd className="mt-1.5 text-lg font-semibold text-ink">Gas only</dd>
            <dd className="text-[11px] text-ink-soft mt-0.5">no liquidity deposit</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-ink-faint">Creator take</dt>
            <dd className="mt-1.5 text-lg font-semibold text-ink" data-numeric>0.10%</dd>
            <dd className="text-[11px] text-ink-soft mt-0.5">of every swap, forever</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-ink-faint">Creator allocation</dt>
            <dd className="mt-1.5 text-lg font-semibold text-ink" data-numeric>Zero</dd>
            <dd className="text-[11px] text-ink-soft mt-0.5">nothing to unlock or dump</dd>
          </div>
          <div>
            {/* Kolom ini sudah tiga kali menyesatkan, dan yang terakhir bukan karena
                salah fakta.

                Mula-mula "Mainnet Ready" hijau bersebelahan dengan "4 Chains Active",
                yang terbaca sebagai "perdagangan sudah jalan". Lalu dikoreksi menjadi
                "launch factory pending broadcast" — benar waktu itu, dan basi begitu
                factory-nya benar-benar dikirim. Lalu "Launching live · broadcast to 4
                mainnets · $ADEXTO is live on 0G with its entire supply in the curve":
                setiap kata benar.

                Tetap dicabut, karena isinya salah JENIS. Tiga kolom di sebelahnya
                menjawab "apa yang saya dapat kalau memakai ini"; kolom ini menjawab
                "sejauh mana proyeknya sudah jadi", dan menyebut satu ticker di deret
                fakta membuat halaman layanan terbaca seperti halaman jualan token —
                pembaca menyimpulkan produknya adalah $ADEXTO, bukan kemampuan
                meluncurkan pasarnya sendiri.

                Penggantinya adalah kemampuan yang tidak dimiliki launchpad lain dan
                yang didapat setiap pasar baru TANPA pekerjaan tambahan: gerbang x402
                dan alat MCP menyelesaikan ticker lewat registry yang sama
                (`/api/pool`, tanpa allowlist, tanpa gerbang curated), jadi keduanya
                menjawab pasar baru pada permintaan pertama.

                Status peluncuran tidak hilang dari situs — `/docs` memang halaman
                untuk itu, dan LAUNCH_CLAUSE masih dipakai di sana. */}
            <dt className="text-[11px] uppercase tracking-wider text-ink-faint">Reachable by machines</dt>
            <dd className="mt-1.5 text-lg font-semibold text-ink">x402 + MCP</dd>
            <dd className="text-[11px] text-ink-soft mt-0.5">from the launch transaction, no listing step</dd>
          </div>
        </dl>
      </section>

      {/* ── WHAT YOUR MARKET OPENS WITH ─────────────────────────────────────────
          Seksi ini yang membuat halaman ini bukan halaman launchpad.

          Tanpa ia, satu-satunya hal yang dijanjikan situs ini adalah token yang lebih
          murah diluncurkan — dan itu perlombaan yang tidak layak dimenangkan. Yang
          sudah dibangun jauh lebih besar dari itu, dan seluruhnya terkubur di scroll
          kelima sampai sekarang: terminalnya, agent per-pasar, harga yang bisa dibayar
          mesin dari chain lain, dan alat MCP.

          DITULIS SEBAGAI HASIL, BUKAN SPESIFIKASI. Ini halaman jualan; daftar fitur
          bernada robot adalah cara tercepat kehilangan pembaca yang bukan engineer.
          Nama indikator tetap disebut karena trader memang mencarinya, tetapi kalimat
          pembuka tiap kartu berbicara tentang apa yang didapat.

          TIDAK ADA SATU PUN TICKER DI SINI, dan itu aturan keras untuk seluruh halaman.
          Menyebut satu koin membuat halaman layanan terbaca sebagai jualan koin itu —
          kesalahan yang sama dengan kolom fakta "$ADEXTO is live on 0G" yang dicabut di
          atas. Bukti hidup ditaut lewat /explorer, yang memperlihatkan pasar apa pun
          yang ada dan tidak perlu disunting setiap ada peluncuran baru.

          Ditempatkan SEBELUM tabel biaya: nilai lebih dulu, harga sesudahnya. */}
      <section className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-line">
        <div className="max-w-3xl mb-12">
          <p className="kicker mb-3">
            <Layers className="w-3.5 h-3.5" /> What your market opens with
          </p>
          <h2 className="text-3xl sm:text-4xl font-semibold text-ink">
            A launchpad hands you a token page. This hands you a venue.
          </h2>
          <p className="text-ink-soft text-sm sm:text-base mt-3 leading-relaxed">
            Four things arrive with the launch transaction. None of them is a roadmap item, and none of them
            needs a listing, an application, or a word from us.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 1. Terminal. Nilai terbesar yang paling lama tersembunyi. */}
          <div className="card card-hover p-6 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30">
                <CandlestickChart className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-ink text-base">A trading terminal, not a token page</h3>
            </div>
            <p className="text-sm text-ink-soft leading-relaxed">
              Your market is tradable in a real terminal from the first block: candles from one second to one
              year, RSI, MACD, Bollinger and VWAP, a live order book and a running trade feed. Built for a market
              that is minutes old rather than months.
            </p>
          </div>

          {/* 2. Agent per pasar. Nyata: prompt sistemnya membawa alamat kurva dan fee. */}
          <div className="card card-hover p-6 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30">
                <MessagesSquare className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-ink text-base">An agent that answers for it</h3>
            </div>
            <p className="text-sm text-ink-soft leading-relaxed">
              Every market comes with an agent a holder can ask about the curve, the fee split or the depth. It
              knows its own token and curve because it is bound to them, and it runs on 0G Compute rather than a
              scripted FAQ.
            </p>
          </div>

          {/* 3. x402. Sudah settle dengan dana nyata, jadi ditulis sebagai kemampuan. */}
          <div className="card card-hover p-6 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30">
                <CloudLightning className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-ink text-base">A price anyone can pay from another chain</h3>
            </div>
            <p className="text-sm text-ink-soft leading-relaxed">
              A buyer holding only USDC on Base can take a position in your market without bridging, and without
              ever holding your chain&apos;s gas token. They pay over plain HTTP; the curve delivers straight to
              their own address.
            </p>
          </div>

          {/* 4. MCP. Pembelinya mesin, dan itu sisi pasar yang belum dilayani siapa pun. */}
          <div className="card card-hover p-6 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30">
                <Bot className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-ink text-base">Buyers that are machines, not just people</h3>
            </div>
            <p className="text-sm text-ink-soft leading-relaxed">
              AI agents can find your market, price it and buy it on their own — it appears to any connected
              agent the moment it launches. There is no listing step, because the agent tools and the site read
              the same registry.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center gap-4">
          <p className="text-sm text-ink-soft leading-relaxed">
            Every line above is one click away — open a live market and trade it yourself.
          </p>
          <Link
            href="/explorer"
            className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline underline-offset-4 whitespace-nowrap"
          >
            See a live market
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Ditempatkan SESUDAH deret fakta dan SEBELUM perbandingan desain, dengan sengaja.
          Deret fakta menjawab "berapa biayanya dan apa yang saya dapat"; seksi ini menjawab
          "apakah ini untuk saya". Menaruhnya lebih dulu akan meminta pembaca mengenali
          dirinya sebelum tahu apa yang ditawarkan, dan menaruhnya sesudah perbandingan
          desain berarti ia datang setelah tiga seksi yang seluruhnya berbicara mekanika —
          yaitu setelah pembaca non-teknis sudah pergi. */}
      {/* ── WHAT YOU GET, AND WHAT IT COSTS ────────────────────────────────────
          Seksi ini ada karena deret fakta di atas menjawab "gas only" tanpa satu pun
          angka, dan itu meninggalkan pertanyaan yang paling ingin dijawab pembaca:
          gas only itu berapa. Jawabannya juga bukan satu angka — antar chain ia
          berbeda dua orde besaran, dan yang membuatnya berbeda bukan kontraknya
          melainkan harga gas dikali harga token native.

          Ditaruh SEBELUM AudienceGrid: pembaca tidak bisa mengenali dirinya sebagai
          calon pengguna sampai ia tahu apa yang didapat dan berapa bayarnya.

          KENAPA ADA KOLOM "OPT-IN" DAN BUKAN SEMUANYA DITULIS "INCLUDED"

          Karena pengikatan agent memang TIDAK otomatis, dan menuliskannya sebagai
          otomatis akan mengulang kesalahan yang baru saja dibersihkan dari /docs —
          empat kartu alat MCP yang tidak ada di repo mana pun. Di Studio,
          `agentBinding.enabled` bawaannya `false`, dan menyalakannya menuntut id
          ERC-8004 yang sudah dimiliki pemanggil, diperiksa kepemilikannya on-chain
          per chain. Yang otomatis hanyalah satu `address immutable agentIdentity` di
          token, dan bawaannya alamat dompet creator sendiri.

          Jadi "token langsung punya AI agent" tidak ditulis di sini. Yang ditulis
          adalah apa yang benar-benar terjadi. */}
      <section className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-line">
        <div className="max-w-3xl mb-10">
          {/* Kicker dan judul dipersempit menjadi HARGA saja. Sebelumnya keduanya
              berbunyi "What a launch gets you" / "the market is open to people and to
              machines", dan itu kini tumpang tindih dengan seksi di atasnya yang memang
              bertugas menjawab pertanyaan itu. Dua seksi berurutan yang menjanjikan
              jawaban sama membuat pembaca mengira ia sudah membaca yang ini. */}
          <p className="kicker mb-3">
            <Coins className="w-3.5 h-3.5" /> What it costs
          </p>
          <h2 className="text-3xl sm:text-4xl font-semibold text-ink">
            No launch fee, and the contract could not take one
          </h2>
          <p className="text-ink-soft text-sm sm:text-base mt-3 leading-relaxed">
            <code className="text-accent">deployTrinity</code> is not{" "}
            <code className="text-accent">payable</code>, so there is no fee to add later — you pay the
            chain&apos;s gas and nothing else, in that chain&apos;s own token.
            {costRange ? (
              <>
                {" "}
                Right now that runs from{" "}
                <strong className="text-ink">{formatUsd(costRange.min.costUsd as number)}</strong> on{" "}
                {costRange.min.chainName} to{" "}
                <strong className="text-ink">{formatUsd(costRange.max.costUsd as number)}</strong> on{" "}
                {costRange.max.chainName}.
              </>
            ) : null}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Biaya per chain, dihitung saat render. */}
          <div className="glass-panel rounded-2xl border border-line p-6">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-4 h-4 text-ok" />
              <h3 className="font-bold text-ink text-sm uppercase tracking-wider">Cost to open a market</h3>
            </div>
            {/* DUA KOLOM DICABUT: satuan gas, dan jumlah dalam token native.
                Keduanya membuat tabel ini berhenti menjual.

                Jumlah native tampil sebagai `1.97e-5 ETH` dan `6.32e-5 ETH` — notasi
                ilmiah, di halaman depan. Tidak ada pembeli yang membaca itu sebagai
                "murah"; ia membacanya sebagai sesuatu yang perlu dihitung dulu. Satu-
                satunya pembaca yang diuntungkan justru yang sudah tahu harga ETH, dan
                ia tidak butuh diyakinkan.

                Satuan gas dicabut dengan alasan sejenis: `3.150.718` tidak berarti apa
                pun tanpa harga gas di sebelahnya, jadi ia hanya menambah kolom angka
                yang harus dilewati untuk mencapai satu-satunya angka yang menjawab
                pertanyaan pembaca.

                Yang hilang dari keduanya adalah KREDIBILITAS, bukan informasi — dan itu
                dipindahkan ke catatan kaki, tempat ia bekerja tanpa mengaburkan harganya.
                Angka lengkapnya tetap ada di runbook dan tetap dihitung `launch-cost.ts`;
                yang berubah hanya apa yang dipajang. */}
            <table className="w-full text-left text-sm">
              <tbody>
                {costs.map((c) => (
                  <tr key={c.chainKey} className="border-b border-line/60 last:border-0">
                    <td className="py-3 pr-3 text-ink font-medium whitespace-nowrap">{c.chainName}</td>
                    <td className="py-3 text-right whitespace-nowrap" data-numeric>
                      {/* Chain yang harga gasnya tidak terbaca menyatakan itu, bukan
                          menampilkan angka yang dikarang. */}
                      {c.live ? (
                        <span className="text-ink font-semibold">{formatUsd(c.costUsd as number)}</span>
                      ) : (
                        <span className="text-ink-faint text-xs">gas price unavailable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-ink-faint mt-4 leading-relaxed">
              Paid in each chain&apos;s own gas token, never in stablecoin. Measured against the deployed factory
              and priced at page load, so these move with the market. No liquidity deposit is required and none is
              possible — 100% of supply enters the curve at genesis.
            </p>
          </div>

          {/* Apa yang ikut, dan apa yang tidak. */}
          <div className="glass-panel rounded-2xl border border-line p-6 space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-ok" />
                <h3 className="font-bold text-ink text-sm uppercase tracking-wider">Included, no extra step</h3>
              </div>
              <ul className="space-y-2.5 text-xs text-ink-soft leading-relaxed">
                <li>
                  <strong className="text-ink">A market that trades immediately.</strong> The curve is the
                  permanent venue — no graduation step, no external pool to seed, no owner and no withdrawal
                  function anywhere on the path.
                </li>
                <li>
                  <strong className="text-ink">0.10% of every swap, to you, forever.</strong> Immutable at
                  deployment, with no setter and no admin. You hold zero tokens, so there is nothing to unlock
                  and nothing to dump.
                </li>
                <li>
                  <strong className="text-ink">An x402 endpoint.</strong> A buyer holding only USDC on Base can
                  take a position without bridging and without ever holding your chain&apos;s gas token. The
                  gateway resolves your ticker through the same registry the site uses — there is no listing
                  step and no allowlist.
                </li>
                <li>
                  <strong className="text-ink">MCP tools.</strong> Your market appears in{" "}
                  <code className="text-accent">list_markets</code>,{" "}
                  <code className="text-accent">quote_buy</code> and{" "}
                  <code className="text-accent">trade_history</code> on the same request, so an agent can find
                  and buy it without a human pasting a URL first.
                </li>
                <li>
                  <strong className="text-ink">A trading terminal.</strong> Candles, indicators and a live trade
                  feed, built for markets that are minutes old rather than months.
                </li>
              </ul>
            </div>
            {/* Kolom ini yang membuat kolom di atasnya bisa dipercaya. Daftar "included"
                tanpa daftar "opt-in" di sebelahnya adalah daftar yang menyembunyikan
                sesuatu. */}
            <div className="pt-4 border-t border-line">
              <div className="flex items-center gap-2 mb-3">
                <HelpCircle className="w-4 h-4 text-ink-faint" />
                <h3 className="font-bold text-ink text-sm uppercase tracking-wider">Opt-in, and stated plainly</h3>
              </div>
              <ul className="space-y-2.5 text-xs text-ink-soft leading-relaxed">
                <li>
                  <strong className="text-ink">ERC-8004 agent binding is off by default.</strong> Turning it on
                  requires an agent id you already own, and ownership is checked on-chain on every chain you
                  launch to. Every token does carry one immutable agent address — by default your own wallet —
                  which gates the treasury buyback call.
                </li>
                <li>
                  <strong className="text-ink">No trading bot runs on your behalf.</strong> 0G Compute is used
                  for launch artwork and the assistant on this site, not for a strategy that trades your market.
                </li>
                <li>
                  <strong className="text-ink">Indexed history is Monad today.</strong> Other chains are served
                  by a log scan that states, on every call, whether it reached your launch block.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <AudienceGrid />

    {/* ── THE PROBLEM & THE SOLUTION (VC PERSPECTIVE) ────────────────────────── */}
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-line">
        <div className="text-center max-w-3xl mx-auto mb-16">
          {/* Lencana merah "MARKET PROBLEM VS ADEXTO SOLUTION" dihapus: merah
              dipesan untuk keadaan galat, dan seksi ini bukan galat. Judulnya juga
              diturunkan dari "The Web3 Launchpad Trap" — bahasa kampanye — menjadi
              pernyataan tentang apa yang sedang dibandingkan. */}
          <p className="kicker justify-center mb-3">Design comparison</p>
          <h2 className="text-3xl sm:text-4xl font-semibold text-ink">Where the money comes from</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Problem */}
          <div className="adexto-rise glass-panel space-y-4 rounded-2xl border border-danger/30 p-8">
            {/* Tiga klaim di kolom ini diperbaiki karena yang pertama SALAH dan
                dua lainnya tidak bisa dipertahankan.

                "Creators receive 0% of ongoing swaps" tidak benar sejak 2025:
                pump.fun membayar creator bagian fee trading secara real-time, dan
                angkanya naik ke 0,3% untuk token di bonding curve. Itu sudah
                tercatat di riset kami sendiri (runbook §1d, dengan sumber). Menuduh
                pesaing soal hal yang justru mereka kerjakan adalah cara tercepat
                kehilangan kepercayaan pembaca yang paham bidangnya — dan pembaca
                yang paham bidangnya adalah target halaman ini.

                Yang tetap benar dan cukup kuat untuk disebut: bagian creator di
                pump.fun dibiayai fee TAMBAHAN yang dibebankan ke trader, bukan
                dipotong dari total yang sudah ada. Perbedaan itulah yang nyata.

                Kata "Ponzi" juga dibuang. Itu tuduhan hukum, bukan pengamatan
                desain, dan tidak menambah satu pun argumen teknis. */}
            <div className="flex items-center gap-2 text-danger font-bold text-sm">
              <AlertCircle className="w-4 h-4" /> WHERE INCENTIVES BREAK
            </div>
            <ul className="space-y-3 text-xs sm:text-sm text-ink-soft font-sans">
              <li className="flex items-start gap-2">
                <span className="text-danger font-bold">✕</span>
                <span>
                  <strong>Creator revenue bolted on top.</strong> Pump.fun does pay creators a share of
                  trading fees, but it funds that share with an extra fee charged to traders rather than
                  taking it out of the fee that already exists.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-danger font-bold">✕</span>
                <span>
                  <strong>The allocation is the exit.</strong> When a creator holds a slice of supply, the
                  cheapest way to get paid is to sell it — so the incentive to dump is built into the cap
                  table, no matter how the fees are arranged.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-danger font-bold">✕</span>
                <span>
                  <strong>Graduation is the attack surface.</strong> Migrating a curve into an external pool
                  is where most launchpad exploits have happened, and it is a step the market has to trust.
                </span>
              </li>
            </ul>
          </div>

          {/* Solution */}
          <div className="adexto-rise glass-panel space-y-4 rounded-2xl border border-ok/30 p-8" style={{ "--rise-d": "90ms" } as React.CSSProperties}>
            {/* "Verifiable 0G TEE — no human can extract private keys" dihapus.
                Tidak ada satu baris pun di repo ini yang mengambil, mengurai, atau
                memverifikasi laporan attestation SEV-SNP; `/api/chat` adalah
                permintaan HTTPS biasa ke router-api.0g.ai. Jadi isolasi hardware
                itu klaim 0G, bukan klaim yang kami buktikan, dan kata "verifiable"
                menjanjikan sesuatu yang tidak bisa ditunjukkan pembaca. Lebih buruk
                lagi: `teeAttestationRoot` di calldata sebenarnya adalah root
                penyimpanan 0G DA, dinamai seolah attestation.
                Penggantinya adalah tiga hal yang bisa diperiksa dengan membuka
                kontraknya. */}
            <div className="flex items-center gap-2 text-ok font-bold text-sm">
              <CheckCircle2 className="w-4 h-4" /> WHAT THE CONTRACT ENFORCES
            </div>
            <ul className="space-y-3 text-xs sm:text-sm text-ink font-sans">
              <li className="flex items-start gap-2">
                <span className="text-ok font-bold">✓</span>
                <span>
                  <strong>The creator holds nothing.</strong> 100% of supply enters the curve, so there is no
                  allocation to sell. Income arrives as 0.10% of each swap, taken from inside the 0.30% the
                  creator configures rather than added to it. The protocol&apos;s own 0.10% is the leg that is
                  added on top, which is why a trader pays 0.40% and the creator still keeps 0.10%.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-ok font-bold">✓</span>
                <span>
                  <strong>No withdrawal function exists.</strong> Nobody can drain a curve — not the creator,
                  not us. The depth share of every fee stays inside, which raises the price floor as volume
                  accumulates.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-ok font-bold">✓</span>
                <span>
                  <strong>No graduation step.</strong> The curve is the permanent venue, so the migration that
                  most launchpad exploits target simply is not in the design.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── THE 4 PILLARS (A - DEX - T - O) ────────────────────────────────────── */}
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-line">
        <div className="text-center max-w-3xl mx-auto mb-16">
          {/* "Every token launched on ADEXTO is backed by…" dihapus: nol token
              pernah diluncurkan di mainnet, jadi kalimat itu menyiratkan populasi
              yang belum ada. Diganti menjadi deskripsi apa yang dibuat satu
              transaksi peluncuran. */}
          <p className="kicker justify-center mb-3">Architecture</p>
          <h2 className="text-3xl sm:text-4xl font-semibold text-ink">What one launch creates</h2>
          <p className="text-ink-soft text-sm sm:text-base mt-2 leading-relaxed">
            Four parts, deployed together in a single transaction: the agent, its market, the token, and the
            paywall that bills other machines for the agent&apos;s time.
          </p>
        </div>

        {/* Empat kartu ini dulu empat blok JSX yang disalin penuh, sekitar 40 baris
            masing-masing. Sudah mulai berpisah pula: kartu 4 memakai bg-accent/10
            untuk kotak ikonnya sementara tiga lainnya bg-accent-soft, dan tidak ada
            yang memutuskan itu. Sekarang satu data array + satu komponen; alasan
            lengkapnya, termasuk tiga efek hover yang ternyata tidak melakukan apa pun,
            ada di PillarCards.tsx. */}
        <PillarCards />
      </section>

      {/* ── REAL CODE IMPLEMENTATION ─────────────────────────────────────────── */}
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-line">
        <div className="glass-panel p-8 sm:p-12 rounded-2xl border border-line">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="kicker mb-3">
                <CloudLightning className="w-3.5 h-3.5" /> Cross-chain buys
              </p>
              {/* Seksi ini sudah salah ke DUA arah, dan keduanya layak dicatat.

                  Pertama ia menjanjikan tiga hal yang belum ada sebagai fitur berjalan.
                  Lalu, setelah verifikasi EIP-712 benar-benar dipasang, ia masih
                  menyangkalnya — merendahkan diri sendiri tetap salah kalau tidak sesuai
                  keadaan. Kesimpulannya: daftar ini harus diuji ke endpoint yang HIDUP
                  setiap kali disunting, bukan diwarisi.

                  Diukur langsung ke produksi saat baris ini ditulis, dengan uang
                  sungguhan: tanpa X-PAYMENT 402 berisi kutipan; 0,02 USDC dibayar di
                  Base lewat otorisasi EIP-3009; 4768,95 $ADEXTO mendarat di 0G di atas
                  minTokensOut; dua tx dikembalikan — beli
                  0x7a1583a34e7abd49347b2686bf7c63cf0344f39ec565d85df73ffb502e6d7daf di
                  0G dan settlement
                  0x65a79f7b35fb755aee92da2bb11703df1045955188df352ab4dcfc9b18a62190 di
                  Base. Bolak-balik 16,2 detik.

                  Yang MASIH belum ada disebut apa adanya di kartu terakhir: persediaan
                  0G-nya terbatas, dan hasil USDC-nya belum disalurkan ke vault buyback.

                  Angka latensi lama ("sub-50ms" di pilar, "<35ms" di FAQ) sudah dibuang:
                  itu milik jaringan Cloudflare, bukan pengukuran kami, dan sekarang
                  angka yang disebut adalah bolak-balik yang benar-benar kami ukur. */}
              {/* Judulnya dulu "Pay on Base, get the token on 0G", dan itu sudah tidak
                  benar sejak gerbangnya jadi multi-chain. Worker dulu memegang SATU RPC
                  pengiriman, jadi 0G bukan pilihan melainkan satu-satunya tujuan yang bisa
                  diungkapkan — dan pasar Monad mati di pembuatan provider dengan
                  `network changed: 143 => 16661`. Sekarang RPC dipilih dari chainId pasar,
                  jadi menyebut satu chain di judul akan mengecilkan yang sudah berjalan. */}
              <h2 className="text-3xl sm:text-4xl font-semibold text-ink mb-4">
                Pay on Base, get the token on its own chain
              </h2>
              <p className="text-ink-soft text-sm leading-relaxed mb-6">
                A market lives on one chain, but a buyer&apos;s money does not have to. Ask for a token and
                the endpoint answers HTTP 402 with a quote. Pay it with USDC on Base and the curve on the
                market&apos;s own chain sends the tokens straight to your address. Live for markets on 0G and
                Monad today. No bridging, and no holding the target chain&apos;s gas token.
              </p>

              <div className="space-y-3.5 text-xs sm:text-sm">
                {/* Keempat kartu ini pernah ditulis sebagai bantahan: "No custody",
                    "a failed buy costs us and never you", "Limits worth knowing". Semua
                    isinya benar, tapi dua di antaranya sebenarnya KEKUATAN yang ditulis
                    seperti permintaan maaf, dan itu membuat seluruh seksi terbaca minder.

                    Plafon persediaan tidak dihapus, dipindahkan ke tempat yang bisa
                    ditindaklanjuti: setiap kutipan 402 membawa `inventory.remainingBuys`
                    dan kalau habis endpoint menjawab 503 beserta alasannya, jadi
                    integrator melihatnya di payload, bukan di iklan. Batas yang sama
                    juga tertulis di /docs dan /pitch. Penyaluran USDC ke vault buyback
                    adalah mekanika treasury, bukan hal yang dialami pembeli, jadi
                    tempatnya di /docs. */}
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-line">
                  <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />
                  <span className="text-ink">
                    <strong className="text-ink">You pay only if it worked.</strong> The tokens are
                    delivered first and the charge is taken after, so you are never billed for a purchase
                    that did not arrive.
                  </span>
                </div>
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-line">
                  <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />
                  <span className="text-ink">
                    <strong className="text-ink">The tokens land in your own wallet.</strong> The
                    curve&apos;s <span className="font-mono text-[11px]">buy</span> takes a recipient, so it
                    sends them to your address. They never pass through us.
                  </span>
                </div>
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-line">
                  <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />
                  <span className="text-ink">
                    <strong className="text-ink">Nothing new to trust.</strong> You sign a USDC transfer
                    authorization and USDC itself checks it. No escrow contract, no deposit. A forged
                    signature is rejected and a used one cannot be replayed.
                  </span>
                </div>
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-line">
                  <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />
                  <span className="text-ink">
                    <strong className="text-ink">Proven with real funds.</strong> Both transaction hashes
                    come back in the response, so you can read the payment and the delivery on two
                    explorers instead of taking our word for it.
                  </span>
                </div>
              </div>
            </div>

      {/* Dulu di sini ada tiga tab berisi cuplikan Solidity dan TypeScript yang
          DISALIN TANGAN, dengan caption "Signatures match contracts/ in the repo".

          Cuplikan salinan tangan tidak bisa diperiksa mesin, dan menurut komentarnya
          sendiri sudah dua kali basi — pernah menampilkan `contract SovereignHook is
          BaseHook` dengan `LP_SPLIT = 70` yang tidak pernah ada, lalu `external
          payable` pada fungsi launch yang tidak menerima pembayaran. Saat dibongkar ia
          salah lagi dalam dua hal sekaligus:

          1. Tab kontraknya menampilkan generasi yang SUDAH DIGANTIKAN
             (AdextoCurveFactory / SovereignCurve) padahal setiap pasar yang hidup
             memakai AdextoFactory / AdextoCurve — nama yang sudah lama diketahui
             config di berkas ini lewat CURVE_FACTORY_GENERATION.
          2. Tab worker-nya menampilkan `verifyEIP712Sig(...)` lalu
             `Response.json({ agentResult: await dispatch0GTEE() })`. Kedua fungsi itu
             tidak ada di cloudflare-worker/src/index.ts, dan jalur sukses itu tidak
             pernah dikembalikan worker: waktu itu voucher yang sah dijawab 501.

          Penggantinya bukan cuplikan yang lebih rapi, tapi bukti yang tidak bisa
          melenceng diam-diam: ABI yang diterbitkan di /abi/, yang dibandingkan
          byte-per-byte dengan artifact kompilasi pada setiap deploy. Daftar nama di
          bawah dijaga audit_consistency terhadap isi public/abi/, jadi kalau kontrak
          bertambah atau berganti nama, halaman ini gagal audit alih-alih berbohong. */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-line overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-accent" />
            <span className="text-xs font-semibold text-ink tracking-wider">PUBLISHED INTERFACE</span>
          </div>
          <span className="font-mono text-[11px] text-ink-faint">
            {CURVE_FACTORY_GENERATION.contract} {CURVE_FACTORY_GENERATION.version}
          </span>
        </div>

        <p className="text-ink-soft text-xs sm:text-sm leading-relaxed mb-4">
          Rather than quote the contracts here by hand, the ABI is published. Every deploy
          compares each published file byte for byte against the artifact the compiler
          produced, so these cannot drift from what is running.
        </p>

        <div className="space-y-2">
          {ABI_FILES.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-cream-2 px-3.5 py-2.5"
            >
              <span className="font-mono text-[11px] sm:text-xs font-semibold text-ink">{name}.sol</span>
              <a
                href={`/abi/${name}.json`}
                className="font-mono text-[11px] sm:text-xs text-accent hover:underline shrink-0"
              >
                ABI &rarr;
              </a>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-line flex items-center justify-between gap-3 text-xs text-ink-soft">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-ink-faint" />
            Checked against the compiled artifacts on every deploy
          </span>
          <a href="/abi/index.json" className="font-mono text-accent hover:underline shrink-0">
            /abi/
          </a>
        </div>
      </div>
          </div>
        </div>
      </section>

      {/* ── FAQ SECTION (ANSWERING HARD VC QUESTIONS) ─────────────────────────── */}
      <section className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-line">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <p className="kicker justify-center mb-3">Questions we get asked</p>
          <h2 className="text-3xl sm:text-4xl font-semibold text-ink">The three hard ones</h2>
        </div>

        <div className="space-y-4 text-left">
          <div className="adexto-rise adexto-lift glass-panel space-y-2 rounded-2xl border border-line p-6">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-accent" /> What actually stops the developer from rugging the agent?
            </h3>
            {/* Jawaban lama: "ADEXTO runs in 0G AMD SEV-SNP enclaves, making it
                physically impossible for developers to tamper with agent state."
                Dua masalah. Pertama, kami tidak memverifikasi attestation apa pun,
                jadi bagian enclave-nya bukan klaim kami. Kedua, "physically
                impossible" tidak benar bahkan untuk TEE sungguhan — serangan
                side-channel terhadap SEV-SNP sudah dipublikasikan. Yang memang
                menahan rug di sistem ini ada di kontrak, dan itu bisa diperiksa
                siapa pun. */}
            <p className="text-xs sm:text-sm text-ink-soft leading-relaxed font-sans font-medium">
              Mostly the cap table, not the enclave. The creator receives zero tokens, so there is no
              position to dump; the curve has no withdrawal function, so the reserve cannot be drained by
              anyone including us; and the agent address is fixed at launch and cannot be reassigned. Those
              three are enforced in the contracts and you can read them. The enclave is a real second layer
              — 0G&apos;s router reports Intel TDX attestation through dstack for every model we call, and{" "}
              <Link href="/docs" className="text-accent hover:underline">/docs shows that read live</Link> —
              but we cannot obtain the raw quote, so do not treat it as something ADEXTO proved.
            </p>
          </div>

          <div className="adexto-rise adexto-lift glass-panel space-y-2 rounded-2xl border border-line p-6" style={{ "--rise-d": "90ms" } as React.CSSProperties}>
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-accent" /> What stops a sniper from taking the whole launch?
            </h3>
            {/* Jawaban lama menyebut afterSwap, transient storage EIP-1153, dan
                "0G TEE order validation" — tak satu pun ada di kontrak. Yang benar-benar
                ada: cap 1% supply selama 5 blok di AdextoToken._update, plus slippage
                dan deadline di kurva. Klaim yang bisa dibantah dengan membuka satu
                berkas lebih merugikan daripada klaim yang sederhana tapi benar. */}
            <p className="text-xs sm:text-sm text-ink-soft leading-relaxed font-sans font-medium">
              <code className="text-accent">AdextoToken._update</code> caps any single transfer at 1% of supply for the
              first 5 blocks after launch, so no wallet can take the opening curve in one shot. Every swap also carries a
              slippage bound and a deadline, and buys are simulated before signing so a trade that would revert never costs
              gas. There is no mempool-level protection claim here: the cap is enforced on-chain, in the token itself.
            </p>
          </div>

          <div className="adexto-rise adexto-lift glass-panel space-y-2 rounded-2xl border border-line p-6" style={{ "--rise-d": "180ms" } as React.CSSProperties}>
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-accent" /> Why serve the payment challenge from the edge?
            </h3>
            {/* Angka "<35ms" dihapus. Ia bertentangan dengan "sub-50ms" di seksi
                atas pada halaman yang sama, dan tidak satu pun dari keduanya pernah
                kami ukur — keduanya mengutip jaringan Cloudflare. Sebuah angka yang
                bertengkar dengan dirinya sendiri di satu halaman lebih merugikan
                daripada tidak ada angka. */}
            <p className="text-xs sm:text-sm text-ink-soft leading-relaxed font-sans font-medium">
              Because quoting a price should not require a blockchain read. A caller that has never seen the
              agent before needs one round trip to learn what it costs and where to pay; asking an EVM RPC for
              that turns a discovery step into a multi-hundred-millisecond dependency on a node being up. The
              challenge is static data, so it belongs at the edge. Settlement, when it lands, does need
              on-chain confirmation.
            </p>
          </div>
        </div>
      </section>

      {/* ── PENUTUP ──────────────────────────────────────────────────────────────
          Bentuknya sengaja sama dengan hero: satu tombol, satu tautan tenang. Dulu
          dua tombol besar di sini juga, jadi halaman ini menutup dengan pilihan
          yang persis sama seperti saat membuka — dua kali bertanya, tanpa ada
          yang baru untuk diputuskan. Memo VC pindah ke tautan sekunder di sini
          dan ke kolom footer, tempat pembaca yang memang mencarinya akan lihat. */}
      <section className="w-full max-w-3xl mx-auto px-4 py-24 text-center">
        {/* Penutup lama menjual PENERBITAN: "Ready to launch?" lalu kalimat tentang tiga
            kontrak yang ter-deploy per chain. Itu menutup halaman dengan kalimat paling
            teknis di seluruh halaman, dan mengulangi frame launchpad tepat di tempat
            pembaca memutuskan. Sekarang ia menutup dengan hasilnya. */}
        <h2 className="text-3xl sm:text-4xl font-semibold text-ink tracking-tight mb-4">
          Open your market
        </h2>
        <p className="text-ink-soft text-sm sm:text-base max-w-xl mx-auto mb-9 leading-relaxed">
          One transaction and it is trading — with its terminal, its agent, and a price the rest of the internet
          can pay. Gas only, and you keep 0.10% of every trade for as long as it lives.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-[15px] bg-accent hover:bg-accent-strong text-white transition-colors"
          >
            Open Studio
            <ArrowRight className="w-4 h-4" />
          </Link>
          {/* CTA sekunder "Investor & grant memorandum" DICABUT bersama rutenya.
              /pitch kini di `src/app/_pitch/`, di luar routing, jadi tautan apa pun ke
              sana akan 404 — dan 404 dari ajakan bertindak di halaman depan lebih buruk
              daripada tidak ada ajakan sama sekali. "Open Studio" berdiri sendiri. */}
        </div>
      </section>
    </div>
  );
}
