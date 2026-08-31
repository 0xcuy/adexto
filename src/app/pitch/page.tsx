import Link from "next/link";
import VerifiedDeploymentCard from "@/components/VerifiedDeploymentCard";
import { 
  Award, TrendingUp, Cpu, ShieldCheck, Zap, ArrowRight, DollarSign, 
  Layers, Users, CheckCircle2, BarChart3, CloudLightning, RefreshCw, Flame, Globe,
  ShieldAlert
} from "lucide-react";

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
          The curve factory is live on all four mainnets and no token has been launched through it yet; this memo
          says so wherever it matters rather than reading as traction it does not have.
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
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">
            Three design choices, and what each one costs us
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-medium">
            <div className="card card-hover p-4 space-y-2">
              <span className="text-ink font-semibold text-sm block">1. The creator gets no allocation</span>
              <p className="text-ink-soft leading-relaxed">
                100% of supply enters the curve, so there is no position to sell and nothing to vest. Income is
                0.10% of every swap, taken from inside the existing 0.30% fee rather than added on top of it.
                <strong className="text-ink block mt-1">
                  Cost to us: a creator who wanted a fast exit has no reason to pick this.
                </strong>
              </p>
            </div>

            <div className="card card-hover p-4 space-y-2">
              <span className="text-ink font-semibold text-sm block">2. No deposit, and no graduation</span>
              <p className="text-ink-soft leading-relaxed">
                The curve opens against a virtual reserve, so a launch costs gas only, and it never migrates to
                an external pool — removing the step most launchpad exploits target.
                <strong className="text-ink block mt-1">
                  Cost to us: liquidity can never be deepened by a partner, only by trading volume.
                </strong>
              </p>
            </div>

            <div className="card card-hover p-4 space-y-2">
              <span className="text-ink font-semibold text-sm block">3. Machine-payable agent endpoints</span>
              <p className="text-ink-soft leading-relaxed">
                Each agent answers unpaid calls with HTTP 402 and a price, so revenue can come from other
                software rather than from speculation.
                <strong className="text-ink block mt-1">
                  Status: the challenge is live; verification and settlement are not built yet.
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
                  ada attestation yang kami ambil atau periksa. */}
              <span className="text-ink">
                Agent inference on the 0G Compute router — TeeML tier, Intel TDX attested via dstack — bound
                to one immutable agent address per token.
              </span>
            </div>
            <div className="card card-hover p-4 border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">DEX → Sovereign Curve</strong>
              <span className="text-ink">A per-token bonding curve over a virtual reserve: 0.15% depth stays in the curve, 0.10% pays the creator, 0.05% funds agent buybacks.</span>
            </div>
            <div className="card card-hover p-4 border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">T → Token Factory</strong>
              {/* "ERC-8004" dihapus: token hanya menyimpan satu address immutable,
                  tanpa supportsInterface dan tanpa registry yang standar itu minta. */}
              <span className="text-ink">
                An ERC-20 whose transfer hook is bound to the agent address, plus a 1%-of-supply transfer cap
                for the first 5 blocks.
              </span>
            </div>
            <div className="card card-hover p-4 border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">O → Orchestrator</strong>
              {/* Bukan "settling": worker mengutip harga, belum menyelesaikan
                  pembayaran. Angka sub-50ms juga bukan hasil ukuran kami. */}
              <span className="text-ink">
                A Cloudflare Worker that answers unpaid agent calls with HTTP 402 and a price. Settlement is not
                implemented.
              </span>
            </div>
          </div>
        </div>

        {/* ── UNIT ECONOMICS & FINANCIAL PROJECTIONS ─────────────────────────── */}
        <div className="section-block space-y-5">
          <div className="kicker">Financial unit economics · revenue &amp; MRR model</div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">4 Scalable High-Margin Revenue Streams</h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-medium">
            <div className="p-4 rounded-xl bg-white border border-line space-y-1.5">
              <strong className="text-ink block font-bold text-sm">1. Curve Swap Take-Rate (planned)</strong>
              {/* Ditandai "planned": pembagian fee di SovereignCurve hari ini hanya
                  depth + creator + buyback token itu sendiri. Tidak ada irisan
                  protokol di kontrak, jadi ini proyeksi monetisasi, bukan penerimaan
                  yang sudah berjalan. */}
              <p className="text-ink-soft">A 0.05% protocol take-rate on swap volume across thousands of sovereign curves on Base, 0G, Arbitrum &amp; Monad. Not yet enabled in the contracts — today the full fee goes to depth, the creator, and the token&apos;s own buyback vault.</p>
              <span className="text-ink-soft font-mono font-bold block pt-1">Target: $450k/mo at $900M Monthly Volume</span>
            </div>

            <div className="p-4 rounded-xl bg-white border border-line space-y-1.5">
              <strong className="text-ink block font-bold text-sm">2. Cloudflare x402 Micropayment Split</strong>
              <p className="text-ink-soft">10% facilitation take-rate on paid agent API calls settled between machines at the global edge.</p>
              <span className="text-ink-soft font-mono font-bold block pt-1">Target: $120k/mo at 12M monthly tool calls</span>
            </div>

            <div className="p-4 rounded-xl bg-white border border-line space-y-1.5">
              <strong className="text-ink block font-bold text-sm">3. 0G TEE SaaS Enclave Subscriptions</strong>
              <p className="text-ink-soft">Tiered hosting for dedicated 0G private compute: $29/mo (Starter), $149/mo (Pro), $499/mo (Sovereign Fleet).</p>
              {/* Dulu "$185k/mo ARR" — ARR itu tahunan, jadi "per bulan ARR" bukan
                  satuan yang ada. Salah satuan di halaman proyeksi keuangan adalah
                  hal yang paling cepat membuat seluruh tabel diragukan. */}
              <span className="text-ink-soft font-mono font-bold block pt-1">Target: $185k MRR across 2,500 active enclaves</span>
            </div>

            <div className="p-4 rounded-xl bg-white border border-line space-y-1.5">
              <strong className="text-ink block font-bold text-sm">4. EVIDIQ MCP Tool Marketplace</strong>
              <p className="text-ink-soft">Revenue split on premium agent security (Sentinel), brand assets (Signet), and schedulers (Helm).</p>
              <span className="text-ink-soft font-mono font-bold block pt-1">Target: $80k/mo in addon subscriptions</span>
            </div>
          </div>
        </div>

        {/* ── COMPETITIVE MATRIX: ADEXTO VS EXISTING LAUNCHPADS ────────────── */}
        <div className="section-block space-y-5">
          <div className="kicker">
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Competitive moat &amp; benchmark matrix</span>
          </div>
          {/* "Why ADEXTO Dominates the Next Cycle" dihapus. Kami belum meluncurkan
              satu token pun di mainnet; mengklaim dominasi siklus dari posisi itu
              melemahkan tabel di bawahnya, yang sebenarnya isinya baik. */}
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
                  <td className="py-3 pr-4 font-bold text-ink">Multi-chain launch</td>
                  <td className="py-3 px-4 text-ink-soft">Single chain</td>
                  <td className="py-3 px-4 text-ink-soft">Base</td>
                  <td className="py-3 pl-4 font-bold text-ink bg-accent-soft">1–4 chains, one market each</td>
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
                RPC: factory-nya ada di keempat mainnet. Kata "no launches yet"
                ikut dibawa supaya tidak ada yang membaca ini sebagai traksi. */}
            <div>
              <strong className="text-ink block text-sm">Phase 1 — contracts and app</strong>
              <span className="text-ink-soft text-xs">
                Curve and factory written, tested on five EVMs; app complete end to end; x402 quote endpoint
                deployed; curve factory v0.10.0 broadcast to 0G, Base, Arbitrum and Monad
              </span>
            </div>
            <span className="px-3 py-1 rounded bg-ok/10 text-ok border border-ok/30 font-bold text-xs">
              4 MAINNETS · NO LAUNCHES YET
            </span>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-white border border-line">
            <div>
              <strong className="text-ink block text-sm">Phase 2 (Q4 2026):</strong>
              <span className="text-ink-soft text-xs">
                DAO governance on 0G · cross-chain lanes pending CCIP support for 0G and Monad
              </span>
            </div>
            <span className="px-3 py-1 rounded bg-accent-soft text-accent font-bold text-xs">IN PROGRESS</span>
          </div>
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
