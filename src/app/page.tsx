"use client";

import Link from "next/link";
import { useState } from "react";
import StackMarquee from "@/components/StackMarquee";
import {
  Layers, Cpu, ShieldCheck, ArrowRight, CheckCircle2,
  Coins, TrendingUp, Lock, Globe, Code2,
  CloudLightning, AlertCircle, HelpCircle
} from "lucide-react";

export default function HomePage() {
  const [activeCodeTab, setActiveCodeTab] = useState<"factory" | "hook" | "cloudflare">("factory");

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
      <section className="relative w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center">
        <p className="kicker justify-center mb-6">ADEXTO Protocol v1.0.0</p>

        <h1 className="text-[2.5rem] sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.06] text-ink mb-6">
          Launch an AI agent token with no liquidity deposit.{" "}
          <span className="gradient-text">Gas only.</span>
        </h1>

        <p className="mx-auto max-w-2xl text-base sm:text-lg text-ink-soft leading-relaxed mb-9">
          100% of supply opens inside a sovereign bonding curve, so there is nothing to seed and no
          creator allocation to dump. Every swap then pays the creator 0.10% and the agent&apos;s buyback
          vault 0.05%, settled on-chain for as long as the market keeps trading.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-[15px] bg-accent hover:bg-accent-strong text-white transition-colors"
          >
            Open Studio
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/docs"
            className="text-sm font-semibold text-ink-soft hover:text-ink underline-offset-4 hover:underline transition-colors"
          >
            Read the deployed contracts
          </Link>
        </div>

        {/* Fakta, tanpa kotak. Garis hairline sudah cukup untuk memisahkan. */}
        <dl className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-8 border-t border-line pt-8 text-left">
          <div>
            <dt className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Cost to launch</dt>
            <dd className="mt-1.5 text-lg font-semibold text-ink">Gas only</dd>
            <dd className="text-[11px] text-ink-soft mt-0.5">no liquidity deposit</dd>
          </div>
          <div>
            <dt className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Creator take</dt>
            <dd className="mt-1.5 text-lg font-semibold text-ink" data-numeric>0.10%</dd>
            <dd className="text-[11px] text-ink-soft mt-0.5">of every swap, forever</dd>
          </div>
          <div>
            <dt className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Creator allocation</dt>
            <dd className="mt-1.5 text-lg font-semibold text-ink" data-numeric>Zero</dd>
            <dd className="text-[11px] text-ink-soft mt-0.5">nothing to unlock or dump</dd>
          </div>
          <div>
            {/* Dulu "Mainnet Ready" berwarna hijau bersebelahan dengan "4 Chains
                Active", yang mudah dibaca sebagai "perdagangan sudah jalan di
                empat mainnet". Kontrak memang terverifikasi, tapi factory
                peluncuran belum di-broadcast, jadi cakupannya dinyatakan
                terang-terangan. Klaim yang bisa dibantah dengan satu panggilan
                RPC lebih merugikan daripada klaim kecil yang tepat. */}
            <dt className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Deployment</dt>
            <dd className="mt-1.5 text-lg font-semibold text-ink">Contracts verified</dd>
            <dd className="text-[11px] text-ink-soft mt-0.5">launch factory pending broadcast</dd>
          </div>
        </dl>
      </section>

      {/* Ticker stack: tepat di bawah lipatan pertama, melintang penuh dan
          terpusat, jadi hal pertama sesudah janji utama adalah daftar apa yang
          sebenarnya menopangnya. */}
      <StackMarquee />

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
          <div className="glass-panel p-8 rounded-2xl border border-danger/30 space-y-4">
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
            <div className="flex items-center gap-2 text-danger font-bold text-sm font-mono">
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
          <div className="glass-panel p-8 rounded-2xl border border-ok/30 space-y-4">
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
            <div className="flex items-center gap-2 text-ok font-bold text-sm font-mono">
              <CheckCircle2 className="w-4 h-4" /> WHAT THE CONTRACT ENFORCES
            </div>
            <ul className="space-y-3 text-xs sm:text-sm text-ink font-sans">
              <li className="flex items-start gap-2">
                <span className="text-ok font-bold">✓</span>
                <span>
                  <strong>The creator holds nothing.</strong> 100% of supply enters the curve, so there is no
                  allocation to sell. Income arrives as 0.10% of each swap, taken from inside the existing
                  0.30% fee, not added to it.
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 font-mono">
          {/* Pillar 1: A */}
          <div className="glass-panel p-6 rounded-2xl border border-accent/30 flex flex-col justify-between relative overflow-hidden group hover:border-accent/30 transition-all shadow-xl">
            <div className="absolute top-0 right-0 w-28 h-28 bg-accent-soft rounded-full blur-2xl pointer-events-none group-hover:bg-accent-soft transition-all" />
            <div className="space-y-4 relative z-10">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-accent-soft text-accent border border-accent/30 flex items-center justify-center font-semibold text-lg shadow-lg shadow-accent/10 group-hover:scale-105 transition-transform">
                  <Cpu className="w-6 h-6 text-accent" />
                </div>
                <span className="px-2.5 py-1 rounded-full bg-accent-soft text-accent border border-accent/30 text-[10px] font-bold">
                  PILLAR 01 [A]
                </span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ink group-hover:text-accent transition-colors">Autonomous Agent</h3>
                <span className="text-[11px] font-bold text-accent block mt-0.5">0G Compute router</span>
              </div>
              {/* Kartu ini dulu berbunyi "24/7 AI agents execute inside
                  hardware-isolated AMD SEV-SNP enclaves" dengan lencana "Hardware
                  Attested". Kami tidak pernah mengambil maupun memeriksa laporan
                  attestation: agennya memanggil router 0G lewat HTTPS. Menyebut
                  sesuatu "attested" sementara tidak ada attestation yang diperiksa
                  adalah klaim yang runtuh pada pertanyaan pertama seorang auditor. */}
              <p className="text-xs text-ink-soft font-sans leading-relaxed font-normal">
                Each token is bound to an agent address at launch, and the agent runs its mandate against
                0G Compute. 0G states that inference runs in AMD SEV-SNP enclaves; ADEXTO does not verify
                that attestation itself, so we report it as their claim, not ours.
              </p>
            </div>
            <div className="pt-4 border-t border-line text-[11px] text-ink-soft font-bold flex items-center justify-between mt-4">
              <span>Agent address fixed at launch</span>
              <ShieldCheck className="w-4 h-4 text-ink-faint" />
            </div>
          </div>

          {/* Pillar 2: DEX */}
          <div className="glass-panel p-6 rounded-2xl border border-accent/30 flex flex-col justify-between relative overflow-hidden group hover:border-accent/30 transition-all shadow-xl">
            <div className="absolute top-0 right-0 w-28 h-28 bg-accent-soft rounded-full blur-2xl pointer-events-none group-hover:bg-accent-soft transition-all" />
            <div className="space-y-4 relative z-10">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-accent-soft text-accent border border-accent/30 flex items-center justify-center font-semibold text-lg shadow-lg shadow-accent/10 group-hover:scale-105 transition-transform">
                  <Layers className="w-6 h-6 text-accent" />
                </div>
                <span className="px-2.5 py-1 rounded-full bg-accent-soft text-accent border border-accent/30 text-[10px] font-bold">
                  PILLAR 02 [DEX]
                </span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ink group-hover:text-accent transition-colors">Sovereign DEX</h3>
                <span className="text-[11px] font-bold text-accent block mt-0.5">Sovereign Bonding Curve</span>
              </div>
              <p className="text-xs text-ink-soft font-sans leading-relaxed font-normal">
                A curve that opens against a virtual reserve, so a launch needs no liquidity deposit. The 0.30% swap fee
                splits three ways on-chain: 0.15% depth stays in the curve, 0.10% to the creator, 0.05% to the buyback vault.
              </p>
            </div>
            <div className="pt-4 border-t border-line text-[11px] text-accent font-bold flex items-center justify-between mt-4">
              {/* Bukan "100% Fee Retained": creator menerima 0.10% dari total fee,
                  bukan seluruh fee. Protokol mengambil 0.05% (lihat /pitch), dan
                  sisanya mengendap di kurva. */}
              <span>Creator paid every swap</span>
              <TrendingUp className="w-4 h-4 text-accent" />
            </div>
          </div>

          {/* Pillar 3: T */}
          <div className="glass-panel p-6 rounded-2xl border border-accent/30 flex flex-col justify-between relative overflow-hidden group hover:border-accent/30 transition-all shadow-xl">
            <div className="absolute top-0 right-0 w-28 h-28 bg-accent-soft rounded-full blur-2xl pointer-events-none group-hover:bg-accent-soft transition-all" />
            <div className="space-y-4 relative z-10">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-accent-soft text-accent border border-accent/30 flex items-center justify-center font-semibold text-lg shadow-lg shadow-accent/10 group-hover:scale-105 transition-transform">
                  <Coins className="w-6 h-6 text-accent" />
                </div>
                <span className="px-2.5 py-1 rounded-full bg-accent-soft text-accent border border-accent/30 text-[10px] font-bold">
                  PILLAR 03 [T]
                </span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ink group-hover:text-accent transition-colors">Token Factory</h3>
                <span className="text-[11px] font-bold text-accent block mt-0.5">ERC-20, agent-bound</span>
              </div>
              {/* Dua koreksi.
                  "ERC-8004": AdextoToken hanya menyimpan satu `address immutable
                  agentIdentity`. Tidak ada supportsInterface, tidak ada registry
                  identitas/reputasi/validasi seperti yang ditetapkan standar itu.
                  Menyebutnya kepatuhan ERC-8004 tidak bisa ditunjukkan, jadi yang
                  ditulis sekarang adalah apa yang benar-benar dilakukan field itu.
                  "1-Click": peluncuran menuntut sambung dompet, tanda tangan
                  attestation, proof World ID, lalu satu transaksi PER chain. */}
              <p className="text-xs text-ink-soft font-sans leading-relaxed font-normal">
                An ERC-20 whose transfer hook is bound to one immutable agent address, so the binding cannot
                be reassigned later. 100% of supply enters the curve and is tradable from the launch
                transaction onward, with a 1%-of-supply transfer cap for the first 5 blocks.
              </p>
            </div>
            <div className="pt-4 border-t border-line text-[11px] text-accent font-bold flex items-center justify-between mt-4">
              <span>Agent binding immutable</span>
              <Lock className="w-4 h-4 text-accent" />
            </div>
          </div>

          {/* Pillar 4: O */}
          <div className="glass-panel p-6 rounded-2xl border border-accent/30 flex flex-col justify-between relative overflow-hidden group hover:border-accent/30 transition-all shadow-xl">
            <div className="absolute top-0 right-0 w-28 h-28 bg-accent/10 rounded-full blur-2xl pointer-events-none group-hover:bg-accent/10 transition-all" />
            <div className="space-y-4 relative z-10">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-accent/10 text-accent border border-accent/30 flex items-center justify-center font-semibold text-lg shadow-lg shadow-accent/10 group-hover:scale-105 transition-transform">
                  <CloudLightning className="w-6 h-6 text-accent" />
                </div>
                <span className="px-2.5 py-1 rounded-full bg-accent-soft text-accent border border-accent/30 text-[10px] font-bold">
                  PILLAR 04 [O]
                </span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ink group-hover:text-accent transition-colors">Orchestrator</h3>
                <span className="text-[11px] font-bold text-accent block mt-0.5">Cloudflare Workers x402</span>
              </div>
              <p className="text-xs text-ink-soft font-sans leading-relaxed font-normal">
                An HTTP 402 gate in front of the agent&apos;s API, so another machine can discover the price and
                the settlement vault without a human in the loop. The buyback vault and its burn path exist in
                the curve; connecting edge revenue to it is still to come.
              </p>
            </div>
            <div className="pt-4 border-t border-line text-[11px] text-ink-soft font-bold flex items-center justify-between mt-4">
              <span>402 challenge live · settlement pending</span>
              <Globe className="w-4 h-4 text-ink-faint" />
            </div>
          </div>
        </div>
      </section>

      {/* ── REAL CODE IMPLEMENTATION ─────────────────────────────────────────── */}
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-line">
        <div className="glass-panel p-8 sm:p-12 rounded-2xl border border-line">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-accent/10 text-accent border border-accent/30 text-xs font-mono font-bold mb-3">
                <CloudLightning className="w-3.5 h-3.5" /> CLOUDFLARE WORKERS x402 ENGINE
              </div>
              {/* Seksi ini dulu menjanjikan tiga hal, dan hanya satu yang benar.
                  Yang benar: Worker mengembalikan tantangan HTTP 402 dengan harga
                  dan alamat vault penyelesaian — hidup sekarang, bisa dicoba dengan
                  satu curl. Yang belum ada: verifikasi tanda tangan EIP-712 yang
                  sesungguhnya, penyelesaian multi-token, dan penyaluran otomatis ke
                  vault buyback. Ketiganya tertulis sebagai fitur berjalan.
                  Angkanya juga bertengkar sendiri: pilar dan judul menyebut
                  "sub-50ms", FAQ di bawah menyebut "<35ms". Sekarang satu angka,
                  dan angka itu milik jaringan Cloudflare, bukan hasil pengukuran
                  kami — jadi disebut apa adanya. */}
              <h2 className="text-3xl sm:text-4xl font-semibold text-ink mb-4">
                An API that bills other machines
              </h2>
              <p className="text-ink-soft text-sm leading-relaxed mb-6">
                Every agent endpoint answers an unpaid request with HTTP 402 Payment Required, quoting its
                price and the vault that should receive payment. The challenge is served from Cloudflare&apos;s
                edge, so a caller learns the terms without touching an RPC node.
              </p>

              <div className="space-y-3.5 text-xs sm:text-sm font-mono">
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-line">
                  <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />
                  <span className="text-ink">
                    <strong className="text-ink">Live now:</strong> the 402 challenge, with price, accepted
                    assets and settlement vault. Try it below on the agent demo page.
                  </span>
                </div>
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-line">
                  <AlertCircle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                  <span className="text-ink">
                    <strong className="text-ink">Not wired yet:</strong> EIP-712 voucher verification and
                    on-chain settlement. The endpoint quotes terms; it does not yet take payment.
                  </span>
                </div>
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-line">
                  <AlertCircle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                  <span className="text-ink">
                    <strong className="text-ink">Not wired yet:</strong> routing that revenue into the
                    curve&apos;s buyback vault. The vault and its burn path exist on-chain; the edge does not
                    feed it.
                  </span>
                </div>
              </div>
            </div>

      {/* Smart Contract & Cloudflare Code Tab */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-line overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-accent" />
            <span className="text-xs font-mono font-bold text-ink">ON-CHAIN &amp; EDGE CODE</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button 
              onClick={() => setActiveCodeTab("factory")}
              className={`px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-mono font-bold transition-all ${
                activeCodeTab === "factory" 
                  ? "bg-accent-soft text-accent border border-accent/30" 
                  : "text-ink-soft hover:text-ink bg-cream-3"
              }`}
            >
              AdextoTrinityFactoryV3.sol
            </button>
            <button 
              onClick={() => setActiveCodeTab("hook")}
              className={`px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-mono font-bold transition-all ${
                activeCodeTab === "hook" 
                  ? "bg-accent-soft text-accent border border-accent/30" 
                  : "text-ink-soft hover:text-ink bg-cream-3"
              }`}
            >
              SovereignCurve.sol
            </button>
            <button 
              onClick={() => setActiveCodeTab("cloudflare")}
              className={`px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-mono font-bold transition-all ${
                activeCodeTab === "cloudflare" 
                  ? "bg-accent/10 text-accent border border-accent/30" 
                  : "text-ink-soft hover:text-ink bg-cream-3"
              }`}
            >
              cloudflare-x402.ts
            </button>
          </div>
        </div>

        <div className="font-mono text-[11px] sm:text-xs text-ink space-y-2 bg-white p-4 sm:p-5 rounded-xl border border-line overflow-x-auto leading-relaxed max-w-full">
                {activeCodeTab === "factory" && (
                  <>
                    <div className="text-ink-soft">// SPDX-License-Identifier: MIT</div>
                    <div className="text-accent">pragma solidity ^0.8.26;</div>
                    {/* Tanda tangan ini WAJIB cocok dengan AdextoTrinityFactoryV3.
                        Perhatikan: TIDAK `payable` — launch tidak menerima pembayaran
                        apa pun, hanya gas. Versi lama di sini menulis `external payable`
                        dan nama kontrak yang tidak ada. */}
                    <div className="text-ink mt-2 font-bold">contract <span className="text-accent">AdextoTrinityFactoryV3</span> &#123;</div>
                    <div className="pl-4 text-ink-soft">event TrinityProjectDeployed(address token, address curve, address creator, ...);</div>
                    <div className="pl-4 text-ok mt-1 font-semibold">function deployTrinity(</div>
                    <div className="pl-8 text-ink">string memory name,</div>
                    <div className="pl-8 text-ink">string memory symbol,</div>
                    <div className="pl-8 text-ink">uint256 initialSupply,</div>
                    <div className="pl-8 text-ink">address agentIdentity,</div>
                    <div className="pl-8 text-ink">uint256 virtualNative,</div>
                    <div className="pl-8 text-ink">uint256 swapFeeBps,</div>
                    <div className="pl-8 text-ink">uint256 creatorShareBps,</div>
                    <div className="pl-8 text-ink">uint256 treasuryShareBps,</div>
                    <div className="pl-8 text-ink">bytes32 teeAttestationRoot</div>
                    <div className="pl-4 text-ok font-semibold">) external returns (address token, address curve);</div>
                    <div className="text-ink font-bold">&#125;</div>
                  </>
                )}
                {activeCodeTab === "hook" && (
                  /* Cuplikan ini WAJIB cocok dengan contracts/SovereignCurve.sol.
                     Sebelumnya di sini tertulis `contract SovereignHook is BaseHook`
                     dengan afterSwap dan LP_SPLIT = 70 — kontrak yang tidak pernah
                     ada di repo ini. Siapa pun yang membuka kontraknya akan tahu
                     halaman depan menjanjikan sistem yang lain. */
                  <>
                    <div className="text-ink-soft">// SPDX-License-Identifier: MIT</div>
                    <div className="text-accent font-bold">contract SovereignCurve &#123;</div>
                    <div className="pl-4 text-ink-soft">uint256 public immutable virtualNative; // reserve pembuka, tanpa setoran</div>
                    <div className="pl-4 text-ink-soft">uint256 public immutable depthFeeBps; // mengendap di kurva</div>
                    <div className="pl-4 text-ink-soft">uint256 public immutable creatorFeeBps; // langsung ke creator</div>
                    <div className="pl-4 text-ok mt-2 font-semibold">function _buy(uint256 minTokensOut, address recipient)</div>
                    <div className="pl-4 sm:pl-8 text-ink">private returns (uint256 tokensOut) &#123;</div>
                    <div className="pl-6 sm:pl-12 text-accent">_curveNative += msg.value - creatorFee - treasuryFee;</div>
                    <div className="pl-6 sm:pl-12 text-accent">creatorOwed += creatorFee;</div>
                    <div className="pl-4 sm:pl-8 text-ink">&#125;</div>
                    <div className="text-accent font-bold">&#125;</div>
                  </>
                )}
                {activeCodeTab === "cloudflare" && (
                  <>
                    <div className="text-ink-soft">// Cloudflare Worker: Edge x402 Facilitator</div>
                    <div className="text-accent">export default &#123;</div>
                    <div className="pl-4 text-ink">async fetch(request: Request, env: Env): Promise&lt;Response&gt; &#123;</div>
                    <div className="pl-8 text-ink-soft">const authHeader = request.headers.get("X-402-Authorization");</div>
                    <div className="pl-8 text-ok">if (!authHeader) return new Response("Payment Required", &#123; status: 402 &#125;);</div>
                    <div className="pl-8 text-ink">const valid = await verifyEIP712Sig(authHeader, env.VAULT_ADDR);</div>
                    <div className="pl-8 text-accent">return Response.json(&#123; agentResult: await dispatch0GTEE() &#125;);</div>
                    <div className="pl-4 text-ink">&#125;</div>
                    <div className="text-accent">&#125;;</div>
                  </>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-line flex items-center justify-between text-xs text-ink-soft">
                {/* "Cloudflare Edge Verified" adalah lencana tanpa makna — tidak
                    ada badan yang memverifikasi apa pun di situ. Diganti dengan
                    pernyataan yang bisa diperiksa: cuplikan di atas memang tanda
                    tangan fungsi yang ada di berkas kontraknya. */}
                <span className="flex items-center gap-1.5 text-ink-soft">
                  <ShieldCheck className="w-4 h-4 text-ink-faint" />
                  Signatures match contracts/ in the repo
                </span>
                <span className="font-mono text-ink-faint">adexto.xyz</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ SECTION (ANSWERING HARD VC QUESTIONS) ─────────────────────────── */}
      <section className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-line">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-accent-soft text-accent border border-accent/30 text-xs font-mono font-bold mb-3">
            TECHNICAL &amp; ARCHITECTURAL FAQ
          </div>
          <h2 className="text-3xl sm:text-4xl font-semibold text-ink">Frequently Asked Questions</h2>
        </div>

        <div className="space-y-4 text-left">
          <div className="glass-panel p-6 rounded-2xl border border-line space-y-2">
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
              Not the enclave — the cap table. The creator receives zero tokens, so there is no position to
              dump, and the curve has no withdrawal function, so the reserve cannot be drained by anyone
              including us. The agent address is fixed at launch and cannot be reassigned. Agent inference
              itself runs on 0G Compute, and 0G states that runs inside AMD SEV-SNP; ADEXTO does not check
              that attestation, so treat it as their claim rather than a guarantee from us.
            </p>
          </div>

          <div className="glass-panel p-6 rounded-2xl border border-line space-y-2">
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

          <div className="glass-panel p-6 rounded-2xl border border-line space-y-2">
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
        <h2 className="text-3xl sm:text-4xl font-semibold text-ink tracking-tight mb-4">
          Ready to launch?
        </h2>
        <p className="text-ink-soft text-sm sm:text-base max-w-xl mx-auto mb-9 leading-relaxed">
          A token, its own bonding curve and its agent binding deploy in one transaction per chain. You pay
          gas and nothing else.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-[15px] bg-accent hover:bg-accent-strong text-white transition-colors"
          >
            Open Studio
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/pitch"
            className="text-sm font-semibold text-ink-soft hover:text-ink underline-offset-4 hover:underline transition-colors"
          >
            Investor &amp; grant memorandum
          </Link>
        </div>
      </section>
    </div>
  );
}
