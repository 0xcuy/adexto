import Link from "next/link";
import VerifiedDeploymentCard from "@/components/VerifiedDeploymentCard";
import { 
  Award, TrendingUp, Cpu, ShieldCheck, Zap, ArrowRight, DollarSign, 
  Layers, Users, CheckCircle2, BarChart3, CloudLightning, RefreshCw, Flame, Globe,
  ShieldAlert
} from "lucide-react";
import { LAUNCH_BADGE, LAUNCH_CLAUSE } from "@/lib/launch-state";
import { CURVE_FACTORY_GENERATION } from "@/config/contracts";

export default function PitchDeckPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      {/* Header */}
      <div className="border-b-2 border-line pb-8 mb-12 text-center max-w-3xl mx-auto">
        {/* Lencana hijau dihapus: hijau menandakan keadaan sehat, bukan jenis
            dokumen. "$100B AI Agent Economy" juga dihapus — angka pasar tanpa
            sumber di judul adalah hal pertama yang dicoret pembaca due diligence,
            dan ia tidak menambah satu pun fakta tentang produk ini. */}
        <p className="kicker justify-center mb-4">Grant &amp; pre-seed memorandum</p>
        <h1 className="text-3xl sm:text-5xl font-semibold text-ink tracking-tight leading-tight">
          A launchpad where the creator holds no tokens
        </h1>
        <p className="text-ink-soft text-sm sm:text-base mt-4 leading-relaxed">
          August 2026 · adexto.xyz · seeking $150K–$500K in ecosystem grants, primarily 0G and Base.
          The curve factory is live on all four mainnets and {LAUNCH_CLAUSE}. Every figure in this memo is
          either read from chain or marked as a model, so you can check it instead of believing it.
        </p>
      </div>

      {/* Ritme diatur oleh .section-block (jarak + garis tipis di atas), bukan lagi
          oleh space-y besar antar kotak. */}
      <div>
        {/* ── VC TEAR-DOWN: THE HARD TRUTHS ──────────────────────────────────── */}
        <div className="section-block space-y-5">
          {/* Tiga kartu ini diperbaiki karena masing-masing punya masalah.

              1. "100% 0G TEE hardware isolation — developer cannot access keys":
                 kami tidak memverifikasi attestation apa pun, jadi ini klaim 0G,
                 bukan klaim kami.
              2. "creators receive $0 from downstream AMM volume": tidak benar sejak
                 2025 — pump.fun membayar creator bagian fee trading. Riset kami
                 sendiri sudah mencatatnya. Perbedaan yang NYATA adalah dari mana
                 uangnya diambil.
              3. "Ponzi Trap": tuduhan hukum, bukan pengamatan desain, dan ia
                 menuntut sesuatu yang tidak bisa dibuktikan halaman ini.

              Judulnya juga diturunkan. "Why 99% of crypto x AI is uninvestable" dan
              "The Three Fatal Flaws We Annihilate" ditulis untuk timeline, bukan
              untuk ruang due diligence. */}
          <div className="kicker">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Executive summary</span>
          </div>
          {/* Judul dan label kartu diubah dari kerangka BIAYA ke kerangka JAMINAN.
              Tidak ada satu fakta yang berubah — ketiga tradeoff tetap tertulis utuh,
              karena pembaca due diligence memang menghargainya dan membuangnya akan
              menjadikan halaman ini brosur.

              Yang salah adalah dari mana kekuatannya diambil. "what each one costs us"
              menjadikan tesisnya sebagai daftar pengakuan, padahal properti itu SENDIRI
              produknya: tarif fee `immutable`, tidak ada owner, tidak ada setter, tidak
              ada jalur upgrade. Itu bisa diperiksa dengan satu panggilan RPC, dan hal
              yang bisa diperiksa lebih kuat daripada proyeksi.

              "Cost to us" juga diganti "Tradeoff" — artinya sama, tapi yang pertama
              terbaca sebagai permintaan maaf dan yang kedua sebagai keputusan teknik. */}
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">
            Three rules nobody can change, including us
          </h2>
          <p className="text-ink-soft text-sm leading-relaxed">
            None of this is a new idea. It is the property set that predates upgradeable contracts and admin
            multisigs: no owner, no setter, no upgrade path, and a supply that no key can reissue. What is unusual
            is applying it to a launchpad, where the standard design keeps a privileged key for exactly the
            emergencies that later become exit routes. Every claim below is a function call away from being checked.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-medium">
            <div className="card card-hover p-4 space-y-2">
              <span className="text-ink font-semibold text-sm block">1. The creator gets no allocation</span>
              <p className="text-ink-soft leading-relaxed">
                100% of supply enters the curve, so there is no position to sell and nothing to vest. Income is
                0.10% of every swap, taken from inside the 0.30% the creator configures rather than added on
                top of it.
                <strong className="text-ink block mt-1">
                  Tradeoff: a creator who wanted a fast exit has no reason to pick this.
                </strong>
              </p>
            </div>

            <div className="card card-hover p-4 space-y-2">
              <span className="text-ink font-semibold text-sm block">2. No deposit, and no graduation</span>
              <p className="text-ink-soft leading-relaxed">
                The curve opens against a virtual reserve, so a launch costs gas only, and it never migrates to
                an external pool — removing the step most launchpad exploits target.
                <strong className="text-ink block mt-1">
                  Tradeoff: liquidity can never be deepened by a partner, only by trading volume.
                </strong>
              </p>
            </div>

            <div className="card card-hover p-4 space-y-2">
              <span className="text-ink font-semibold text-sm block">3. Machine-payable cross-chain buys</span>
              <p className="text-ink-soft leading-relaxed">
                A market lives on one chain but a buyer&apos;s money does not have to. An unpaid call is answered
                with HTTP 402 and a quote; pay it with USDC on Base and the curve on the target chain delivers
                the tokens directly.
                <strong className="text-ink block mt-1">
                  Status: quote, payment and delivery are live and proven with real funds. Size is capped by the
                  native inventory we hold.
                </strong>
              </p>
            </div>
          </div>
        </div>

        {/* ── THE 4-IN-1 ORCHESTRATION ARCHITECTURE ──────────────────────────── */}
        <div className="section-block space-y-5">
          <div className="kicker">Pillar architecture</div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">What the four letters do</h2>
          
          {/* Paragraf penjelas tidak boleh monospace. Kelas `font-mono` di sini
              membuat empat kartu pilar terbaca seperti keluaran terminal, dan itu
              baru kelihatan jelas setelah situs punya typeface sungguhan. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
            <div className="card card-hover p-4 border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">A → Autonomous</strong>
              {/* Bukan "hardware-verified" dan bukan "verifiable inference": tidak
                  ada attestation yang kami ambil atau periksa.
                  "Intel TDX attested via dstack" pun masih terlalu tegas — dibaca
                  begitu saja, ia menyatakan attestation-nya sudah tegak. Yang bisa
                  dipertahankan: router yang MELAPORKAN itu, dan kami membaca
                  laporannya. Sama persis dengan kalimat di landing dan /docs. */}
              <span className="text-ink">
                Agent inference on the 0G Compute router, which reports a TeeML tier with Intel TDX via dstack —
                a declaration we read rather than a quote we verify — bound to one immutable agent address per
                token.
              </span>
            </div>
            <div className="card card-hover p-4 border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">DEX → Sovereign Curve</strong>
              <span className="text-ink">
                A per-token bonding curve over a virtual reserve. On the default tier a trader pays 0.40%:
                0.15% depth stays in the curve, 0.10% pays the creator, 0.05% funds agent buybacks, and 0.10%
                goes to the protocol on top of the other three.
              </span>
            </div>
            <div className="card card-hover p-4 border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">T → Token Factory</strong>
              {/* "transfer hook is bound to the agent address" SALAH menyebut apa
                  yang mengikat apa, dan koreksi yang sama sudah dilakukan di
                  landing berbulan lalu tanpa ikut ke sini. `_update` mengecualikan
                  `_launcher` (factory) agar seeding 100% supply lolos dari batas
                  1%; `agentIdentity` tidak muncul di jalur transfer sama sekali —
                  ia menjaga `executeTreasuryBuyback`.
                  "ERC-8004" dulu dihapus dari sini karena token tidak menyentuh
                  registry apa pun. Sejak factory 0.10.0 pengikatan itu nyata, tapi
                  OPSIONAL dan mati secara default, jadi disebut sebagai pilihan. */}
              <span className="text-ink">
                An ERC-20 with no owner, a 1%-of-supply transfer cap for the first 5 blocks, and one immutable
                agent address that may be paired with an ERC-8004 agent id when the creator chooses to.
              </span>
            </div>
            <div className="card card-hover p-4 border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">O → Orchestrator</strong>
              {/* Kalimat lama menyatakan penyelesaian pembayaran belum dibangun. DICABUT,
                  dan cara ia bertahan jauh lebih penting daripada kalimatnya sendiri.

                  Frasanya sengaja TIDAK dikutip harfiah di komentar ini. Ia sekarang
                  terdaftar terlarang di `audit_claims.mjs`, dan pemeriksa itu membaca
                  `innerText` sehingga komentar JSX memang tidak terbaca — tapi penjaga
                  lain di repo ini mencocokkan pola ke SELURUH berkas termasuk komentar,
                  dan `launch-state.ts` sudah pernah menggagalkan deploy justru karena
                  mengutip frasa terlarangnya sendiri.

                  Ia benar ketika ditulis. Lalu `e095163` membangun penyelesaian EIP-3009
                  yang berhasil memindahkan dana sungguhan, dan sejak saat itu kartu ini
                  menyangkal fitur yang bekerja — jenis kesalahan yang sama merugikannya
                  dengan mengklaim yang belum ada, karena pembaca menyimpulkan produknya
                  lebih mentah daripada kenyataannya.

                  Penjaga di `audit_claims.mjs` TIDAK menangkapnya, dan itu celah nyata:
                  "Settlement is not" hanya terdaftar sebagai KONTRADIKSI berpasangan
                  dengan "settled between machines". Halaman ini tidak memuat pasangannya,
                  jadi klaim palsunya lewat sendirian. Sekarang frasanya dilarang berdiri
                  sendiri.

                  Pelajaran yang sama seperti `launch-state.ts`: klausa yang menyatakan
                  sesuatu BELUM ada punya tanggal kedaluwarsa, dan tanggal itu tidak
                  mengumumkan diri. */}
              <span className="text-ink">
                A Cloudflare Worker that answers an unpaid agent call with HTTP 402 and a quote, then takes the
                USDC payment on Base through an EIP-3009 authorization while the curve on the target chain
                delivers to the buyer&apos;s own address. Delivery runs before the charge, so a failed fill costs
                us and never the buyer.
              </span>
            </div>
          </div>
        </div>

        {/* ── UNIT ECONOMICS & FINANCIAL PROJECTIONS ─────────────────────────── */}
        <div className="section-block space-y-5">
          <div className="kicker">Financial unit economics · revenue &amp; MRR model</div>
          {/* "4 Scalable High-Margin Revenue Streams" membaca seperti empat aliran
              yang sudah mengalir. Revenue hari ini NOL, dan keempatnya belum
              tersambung — jadi judulnya menyebut apa isinya: model, bukan laporan.
              Kartu pertama sudah lama ditandai "(planned)"; tiga lainnya tidak,
              padahal statusnya sama. Sekarang keempatnya konsisten. */}
          {/* Empat baris "Target: $450k/mo", "$185k MRR", "$120k/mo", "$80k/mo" DICABUT,
              dan pencabutan itulah yang memperbaiki nada seluruh halaman.

              Nada mindernya adalah GEJALA, bukan penyakitnya. Angka $450k/bulan pada
              protokol dengan 14 swap memaksa kalimat merendahkan berdiri persis di
              sebelahnya — itulah asal "earning a rounding error" dan "none of them
              earning yet". Begitu proyeksinya hilang, kalimat yang sama tidak perlu
              dimaafkan lagi.

              Angka pengganti bukan hedge. Tarif lebih kuat daripada proyeksi karena ia
              benar di SETIAP skala: 0,10% dari volume berlaku pada volume berapa pun,
              sementara "$450k pada volume $900M" hanya benar pada satu volume yang kami
              karang sendiri. Pembaca bisa mengalikannya sendiri; melakukannya untuk dia
              hanya memindahkan asumsi kami ke dalam angka yang tampak seperti temuan.

              Seluruh penyangkalan TETAP: settlement belum dibangun, tidak ada billing,
              tool-nya tidak ada. Yang dicabut angka fantasinya, bukan pengungkapannya. */}
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">
            Four revenue mechanisms, and exactly how far each one is built
          </h2>
          <p className="text-ink-soft text-sm leading-relaxed">
            Rates, not forecasts. A rate holds at every volume; a forecast holds at one volume we picked ourselves.
            The first mechanism is on chain and collecting today, and its destination has no setter, so what it will
            earn at scale is arithmetic rather than a promise. The other three are named at their intended rate with
            their current state stated plainly.
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-medium">
            <div className="p-4 rounded-xl bg-white border border-line space-y-1.5">
              <strong className="text-ink block font-bold text-sm">1. Curve swap take-rate — live on four mainnets, collecting</strong>
              {/* Riwayat baris ini layak disimpan, karena ia sudah dua kali salah ke
                  arah yang berlawanan.

                  Mula-mula "0.05%" dan "not yet enabled in the contracts" — angkanya
                  keliru dan kalimatnya meremehkan apa yang sudah ditulis. Lalu "written,
                  not deployed", yang benar sampai factory 0.11.0 di-broadcast ke keempat
                  mainnet.

                  Sekarang kaki itu HIDUP: `PROTOCOL_FEE_BPS` = 10 di keempat factory dan
                  `protocolTreasury` immutable di setiap kurva yang mereka buat. Tapi
                  "hidup" bukan "menghasilkan": pendapatannya nol sampai ada volume, dan
                  pasar yang lahir dari factory 0.10.0 TIDAK AKAN PERNAH membayarnya
                  karena setiap tarif fee di sana immutable. Itu permanen, bukan migrasi
                  yang tertunda.

                  Koreksi ketiga: "Revenue so far is zero" juga berhenti benar. Treasury
                  sudah menerima pembayaran. Angkanya memang sangat kecil, tapi "nol" dan
                  "sangat kecil" adalah dua klaim berbeda, dan yang pertama sudah salah.
                  Dibaca dari chain: $ADEXTO 0,0000372 dibayar + 0,0000288 mengendap,
                  $ADT 0,00001 dibayar. Total seumur hidup 0,000076 0G. */}
              <p className="text-ink-soft">A 0.10% protocol take-rate on swap volume, charged on top of the creator&apos;s configured total. Live on all four mainnets: <code className="text-accent">PROTOCOL_FEE_BPS</code> is a constant on each factory and the destination is immutable on every curve they create, so it cannot be redirected and there is no setter. It has been collecting since the first swap — 0.000076 0G so far, on 14 swaps.</p>
              <span className="text-ink-soft font-mono font-bold block pt-1">Rate: 0.10% of swap volume · destination immutable · no setter exists</span>
            </div>

            <div className="p-4 rounded-xl bg-white border border-line space-y-1.5">
              <strong className="text-ink block font-bold text-sm">2. Spread on cross-chain buys — live, settled with real funds</strong>
              {/* Kartu ini dulu menjanjikan "10% facilitation take-rate on paid agent
                  API calls" — angka yang tidak pernah ada di kode mana pun, dan waktu
                  itu tidak ada pembayaran untuk dibagi sama sekali.

                  Sekarang pembayarannya sungguhan, jadi angkanya diukur, bukan
                  dikarang. Pada pembelian sungguhan pertama: settlement Base 85.768 gas
                  = $0,00128, buy 0G 98.918 gas = $0,00008. Pada order $0,02 spread 300
                  bps hanya menghasilkan $0,0006, jadi pembelian itu MERUGI $0,00075.
                  Harganya lalu dinaikkan ke $0,10, di mana marginnya sekitar +$0,0016.
                  Yang membatasi sekarang persediaan, bukan harga. */}
              <p className="text-ink-soft">A 3% spread held back when converting the buyer&apos;s USDC into the target chain&apos;s native asset. The unit economics are measured rather than modelled: gas across both chains costs $0.00136 per fill, which puts break-even near $0.05, so the price is $0.10 and each fill clears about $0.0016. Capacity per fill and the live quote both come back in the endpoint&apos;s own response.</p>
              <span className="text-ink-soft font-mono font-bold block pt-1">Rate: 3% of order size · live · economics measured on real fills</span>
            </div>

            {/* DUA KARTU DICABUT DARI SINI, dan pencabutannya lebih baik daripada
                penandaannya.
                
                Yang hilang: "3. 0G Compute Subscriptions (planned)" dengan tiga harga
                langganan, dan "4. EVIDIQ MCP Tool Marketplace (not built)". Keduanya
                sudah ditandai jujur, jadi tidak ada klaim palsu — tapi kejujuran itu
                menyelesaikan masalah yang salah.
                
                Kartu yang isinya harga untuk sesuatu yang tidak bisa dibeli tidak
                memberi pembaca apa pun. Ia menempati ruang yang sama dengan aliran yang
                benar-benar memungut, dengan berat visual yang sama, lalu meminta pembaca
                mengabaikan separuhnya. Empat kartu dengan dua penafian terbaca lebih
                lemah daripada dua kartu yang dua-duanya hidup — padahal fakta di
                belakangnya identik.
                
                Nama-nama MCP (Sentinel, Signet, Helm) juga tidak diklaim di mana pun
                lagi di halaman ini. Kalau nanti dibangun, kartunya kembali dengan angka
                yang diukur, bukan dimodelkan. */}
          </div>
        </div>

        {/* ── COMPETITIVE MATRIX: ADEXTO VS EXISTING LAUNCHPADS ────────────── */}
        <div className="section-block space-y-5">
          <div className="kicker">
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Competitive moat &amp; benchmark matrix</span>
          </div>
          {/* "Why ADEXTO Dominates the Next Cycle" dihapus, dan tetap dihapus meskipun
              alasan aslinya sudah berubah.

              Alasan lamanya: kami belum meluncurkan satu token pun. Itu sudah tidak
              benar — dua pasar hidup dengan 14 swap. Tapi 14 swap juga bukan dasar untuk
              mengklaim dominasi siklus, jadi judulnya tetap tidak dipakai. Tabel di
              bawahnya membandingkan DESAIN, dan perbandingan desain berdiri sendiri tanpa
              perlu klaim pangsa pasar. */}
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">How the designs differ</h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-line text-ink-soft">
                  <th className="pb-3 pr-4">Feature / Metric</th>
                  <th className="pb-3 px-4 text-danger">Pump.fun / Clanker</th>
                  <th className="pb-3 px-4 text-accent">Virtuals Protocol</th>
                  <th className="pb-3 pl-4 text-accent font-bold bg-accent-soft rounded-t-lg">ADEXTO (adexto.xyz)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink">
                {/* Baris "Creator Trading Revenue: Pump.fun 0% (Platform takes all)"
                    SALAH dan sudah diperbaiki. Mereka membayar creator bagian fee
                    trading; perbedaannya ada pada dari mana uang itu diambil.
                    Baris "AI Hardware Isolation" juga diubah: mengklaim TEE sebagai
                    keunggulan kami sementara tidak ada attestation yang diperiksa
                    berarti membandingkan sesuatu yang tidak bisa kami tunjukkan. */}
                <tr>
                  <td className="py-3 pr-4 font-bold text-ink">Creator allocation</td>
                  <td className="py-3 px-4 text-ink-soft">Creator may hold supply</td>
                  <td className="py-3 px-4 text-ink-soft">Creator may hold supply</td>
                  <td className="py-3 pl-4 font-bold text-ink bg-accent-soft">None — 100% into the curve</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-ink">Where creator revenue comes from</td>
                  <td className="py-3 px-4 text-ink-soft">Extra fee added for traders</td>
                  <td className="py-3 px-4 text-ink-soft">Share of pool fees</td>
                  <td className="py-3 pl-4 font-bold text-ink bg-accent-soft">0.10% from inside the existing fee</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-ink">Cost to open a market</td>
                  <td className="py-3 px-4 text-ink-soft">Gas</td>
                  <td className="py-3 px-4 text-ink-soft">100 $VIRTUAL</td>
                  <td className="py-3 pl-4 font-bold text-ink bg-accent-soft">Gas only, no deposit</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-ink">Graduation to an external pool</td>
                  <td className="py-3 px-4 text-ink-soft">Yes</td>
                  <td className="py-3 px-4 text-ink-soft">Yes</td>
                  <td className="py-3 pl-4 font-bold text-ink bg-accent-soft">Never — the curve is permanent</td>
                </tr>
                <tr>
                  {/* Dulu "1–4 chains, one market each", benar ketika studio bisa
                      mengenai empat chain dalam satu peluncuran. Studio kini satu chain
                      per peluncuran — dipilih seperti radio — karena default empat chain
                      membelah likuiditas peluncuran kecil menjadi empat pasar tipis
                      dengan empat harga yang bergerak sendiri. Keempat chain tetap
                      tersedia, satu peluncuran per chain. */}
                  <td className="py-3 pr-4 font-bold text-ink">Chains available</td>
                  <td className="py-3 px-4 text-ink-soft">Single chain</td>
                  <td className="py-3 px-4 text-ink-soft">Base</td>
                  <td className="py-3 pl-4 font-bold text-ink bg-accent-soft">4 chains · one launch each</td>
                </tr>
                {/* "ERC-8004 1% Genesis Limit" salah label: cap itu ada di
                    AdextoToken._update dan tidak berhubungan dengan standar mana pun. */}
                <tr>
                  <td className="py-3 pr-4 font-bold text-ink">Opening-window guard</td>
                  <td className="py-3 px-4 text-ink-soft">None</td>
                  <td className="py-3 px-4 text-ink-soft">Cooldown</td>
                  <td className="py-3 pl-4 font-bold text-ink bg-accent-soft">
                    1% transfer cap, 5 blocks, in the token
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-ink">Agent API billing</td>
                  <td className="py-3 px-4 text-ink-soft">None</td>
                  <td className="py-3 px-4 text-ink-soft">None</td>
                  <td className="py-3 pl-4 font-bold text-ink bg-accent-soft">
                    HTTP 402 quote live · settlement pending
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── ROADMAP & GRANT TARGETS ────────────────────────────────────────── */}
        <div className="section-block space-y-5">
          <div className="kicker">Grant strategy &amp; roadmap · Base + 0G + Arbitrum + Monad</div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">90-Day Execution Milestones</h2>
          
        <div className="space-y-3 text-xs sm:text-sm font-mono">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-white border border-line">
            {/* Badge ini sudah dua kali harus dikoreksi ke arah berlawanan.
                Awalnya "LIVE" sementara tabel registry di bawahnya menyatakan
                factory kurva belum dikirim. Lalu "MAINNET BROADCAST PENDING",
                yang benar sampai factory-nya benar-benar dikirim dan langsung
                basi setelahnya.
                Sekarang berbunyi apa yang bisa diperiksa dengan satu panggilan
                RPC: factory-nya ada di keempat mainnet.

                Caveat "belum ada peluncuran" TETAP ADA — tanpanya sebuah baris
                milestone berpil hijau terbaca sebagai traksi yang tidak ada — tetapi
                ia pindah keluar dari pil ke deskripsi di sebelahnya. Hijau berarti
                selesai, jadi pil hijau berbunyi "NO LAUNCHES YET" memuat dua pesan
                yang berlawanan dalam satu bentuk. Kata-katanya sendiri kini datang
                dari src/lib/launch-state.ts, karena keadaan ini diucapkan di delapan
                halaman dan sebelumnya setiap halaman mengarang versinya sendiri. */}
            <div>
              <strong className="text-ink block text-sm">Phase 1 — contracts and app</strong>
              <span className="text-ink-soft text-xs">
                {/* Nomor generasi ini basi satu generasi: tertulis v0.10.0 sementara yang
                    menjalankan kedua pasar live adalah AdextoFactory 0.11.0, dan 0.10.0
                    adalah factory yang DIGANTIKAN. Angkanya diambil dari
                    src/config/contracts.ts, bukan ditulis tangan lagi, karena label itu
                    sudah diperiksa audit_consistency terhadap VERSION di chain — jadi
                    baris ini tidak bisa lagi menyimpang sendiri. */}
                Curve and factory written, tested on five EVMs; app complete end to end; x402 cross-chain buys
                paying and delivering with real funds; curve factory v{CURVE_FACTORY_GENERATION.version} broadcast
                to 0G, Base, Arbitrum and Monad — {LAUNCH_CLAUSE}
              </span>
            </div>
            <span className="px-3 py-1 rounded bg-ok/10 text-ok border border-ok/30 font-bold text-xs uppercase">
              {LAUNCH_BADGE}
            </span>
          </div>

          {/* Baris ini dulu menyalahkan penyedia jembatan lintas-chain untuk hambatan
              yang tidak ada: "cross-chain lanes pending ... support for 0G and Monad".
              Ditanyakan ke router masing-masing chain dengan
              `isChainSupported(destinationChainSelector)` \u2014 12 dari 12 arah
              TERBUKA, termasuk kesepuluh pasangan yang menyentuh 0G atau Monad, dan
              keempat alamat router-nya cocok dengan yang sudah diverifikasi on-chain.

              Hambatannya milik KITA, dan lebih dalam daripada menunggu pihak lain:
              receiver-nya sudah ter-deploy di keempat chain, tetapi `router` di
              dalamnya salah di tiga di antaranya (EOA deployer di 0G, alamat tanpa
              bytecode di Arbitrum, alamat nol di Monad) dan `immutable`, jadi tidak
              ada setter yang bisa memperbaikinya.

              Yang penting: itu pun BUKAN alasan akhirnya dicabut. Deploy ulang cuma
              menghasilkan counter yang naik dan sebuah event, karena receiver-nya
              tidak punya withdraw/sweep/transfer sama sekali \u2014 native yang masuk
              terkunci selamanya. Versi yang berguna harus memindahkan nilai keluar
              dari kurva, dan jalur keluar itu justru yang protokol ini janjikan tidak
              ada. Jadi fiturnya bertentangan dengan intinya, bukan tertunda.

              Menyalahkan dependensi eksternal yang ternyata tidak menahan apa pun
              adalah bentuk ketidakjujuran yang paling mudah lolos, karena ia
              terdengar seperti kehati-hatian \u2014 sekaligus menyembunyikan cacat
              sendiri. Penjaga bagian 7 di audit_consistency.mjs juga melewatkannya:
              ia hanya mencocokkan "no router"/"no endpoint", bukan "pending ...
              support". Celah itu ditutup, dan bagian 11 sekarang memeriksa KEADAAN
              receiver-nya, bukan kata-katanya. */}
          {/* BARIS "Dropped, not postponed" DICABUT SELURUHNYA.
              
              Ia memuat DAO governance dan buyback lintas chain, ditandai DROPPED. Isinya
              benar dan penalarannya benar: `execute` hanya bisa memanggil apa yang alamat
              governor sendiri sudah diizinkan, dan jalur peluncuran tidak punya satu pun
              setter maupun owner, jadi memberinya kuasa berarti menambah permukaan admin
              yang justru menjadi jaminan inti protokol ini.
              
              Tapi mendokumentasikan sesuatu yang DICABUT tidak melayani siapa pun. Fitur
              yang tidak akan pernah ada bukan informasi, dan memasang lencana DROPPED di
              roadmap membuat halaman terbaca seperti daftar penyesalan. Pembaca yang
              ingin tahu apakah ada admin surface sudah dijawab di tempat yang tepat:
              /security menyatakan tidak ada owner dan tidak ada setter, sebagai KEKUATAN.
              
              Alamat `AdextoGovernor` tetap terdaftar di registry kontrak, karena kontrak
              itu memang ada di chain dan menyembunyikannya akan jadi kelalaian yang beda.
              Yang dicabut narasinya, bukan faktanya. */}
        </div>
      </div>

      {/* ── ON-CHAIN DEPLOYED CONTRACTS CARD ────────────────────────────── */}
      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <VerifiedDeploymentCard />
      </div>
    </div>

    {/* CTA Footer */}
      <div className="mt-14 pt-8 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link href="/whitepaper" className="text-xs font-bold text-accent hover:text-accent font-mono flex items-center gap-1.5">
          Read Full Mathematical Whitepaper →
        </Link>
        <Link
          href="/studio"
          className="px-8 py-3.5 rounded-xl font-semibold text-xs bg-accent hover:bg-accent-strong text-white shadow-xl shadow-accent/10 hover:shadow-accent/10 transition-all"
        >
          Test Live Studio Demo
        </Link>
      </div>
    </div>
  );
}
