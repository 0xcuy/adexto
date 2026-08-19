import Link from "next/link";
import { BookOpen, ShieldCheck, Cpu, Layers, Zap, ArrowRight, Lock, CheckCircle2 } from "lucide-react";

export default function WhitepaperPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      {/* Document Header */}
      <div className="border-b-2 border-line pb-8 mb-10">
        <div className="flex items-center gap-2 text-xs font-mono text-accent font-bold mb-2">
          <span>ADEXTO PROTOCOL SPECIFICATION</span>
          <span>•</span>
          <span>VERSION 2.4.0 (AUGUST 2026)</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-semibold text-ink tracking-tight leading-tight">
          ADEXTO: Autonomous Decentralized EXchange &amp; Token Orchestrator
        </h1>
        <p className="text-sm sm:text-base text-ink mt-4 leading-relaxed font-normal bg-white p-4 rounded-xl border border-line">
          {/* Abstrak lama menyebut "1-Click Token Launchpads" dan "backed by 0G
              Private Computer (TEE)". Peluncuran menuntut sambung dompet, tanda
              tangan attestation, proof World ID, lalu satu transaksi per chain —
              bukan satu klik. Dan bagian TEE-nya adalah klaim 0G yang tidak kami
              verifikasi. */}
          <strong className="text-accent">Abstract:</strong> ADEXTO (adexto.xyz) deploys, in one transaction
          per chain, an agent-bound ERC-20 and a bonding curve that opens against a virtual reserve — so a
          launch costs gas and nothing else, and 100% of supply is tradable immediately. The creator receives no
          allocation; instead a fixed slice of every swap fee is paid to them on-chain for as long as the market
          trades. The curve never graduates to an external pool and has no withdrawal function. Agent inference
          runs on the 0G Compute router, which reports Intel TDX attestation through dstack for every model
          this protocol calls; ADEXTO reads that declaration per model but does not verify the raw quote,
          and this paper marks the difference wherever it matters.
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-12 text-ink text-sm sm:text-base leading-relaxed">
        {/* Section 1 */}
        <section className="section-block space-y-4">
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <span className="text-accent font-mono">§1.</span> The Problem: The Launchpad Trap
          </h2>
          <p className="text-ink">
            Current token launchpads (e.g., Pump.fun, Clanker) suffer from extreme structural misalignment:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-ink">
            <li><strong className="text-ink font-bold">Zero Autonomous Utility:</strong> Tokens launched have no inherent productivity or underlying cashflow generation.</li>
            <li><strong className="text-ink font-bold">Liquidity Cannibalization:</strong> post-bonding graduation dumps liquidity into external pools with inflexible fee tiers where creators forfeit revenue. ADEXTO curves do not graduate: the curve is the permanent venue, which also removes the migration step where most launchpad exploits happen.</li>
            <li><strong className="text-ink font-bold">Centralized AI Fragility:</strong> Existing "AI Tokens" run on centralized cloud providers (AWS, OpenAI) vulnerable to private key theft, prompt tampering, and rug-pulls.</li>
          </ul>
        </section>

        {/* Section 2 */}
        <section className="section-block space-y-4">
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <span className="text-accent font-mono">§2.</span> The ADEXTO Architecture Mapping
          </h2>
          <p className="text-ink">
            ADEXTO solves this by executing atomic synchronization across all four functional primitives:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs my-4">
            <div className="p-4 rounded-xl bg-white border border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">A → Autonomous</strong>
              <span className="text-ink">
                An agent address fixed at launch, running its mandate against the 0G Compute router
                (TeeML tier: 0G&apos;s own enclave, Intel TDX, verified by dstack).
              </span>
            </div>
            <div className="p-4 rounded-xl bg-white border border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">DEX → Sovereign Curve</strong>
              <span className="text-ink">A per-token bonding curve over a virtual reserve, splitting each swap fee three ways (e.g. 0.15% depth / 0.10% creator / 0.05% buyback).</span>
            </div>
            <div className="p-4 rounded-xl bg-white border border-accent/30">
              <strong className="text-accent block mb-1 text-sm font-bold">T → Token Factory</strong>
              {/* Bukan "ERC-8004": satu address immutable, tanpa registry standar. */}
              <span className="text-ink">
                ERC-20 whose transfer hook is bound to one immutable agent address.
              </span>
            </div>
            <div className="p-4 rounded-xl bg-white border border-ok/30">
              <strong className="text-ok block mb-1 text-sm font-bold">O → Orchestrator</strong>
              <span className="text-ink">Master coordinator managing automated buyback, burns, and x402 revenue distribution.</span>
            </div>
          </div>
        </section>

        {/* Section 3 */}
        <section className="section-block space-y-4">
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <span className="text-accent font-mono">§3.</span> The x402 Micropayment Engine &amp; Auto-Buyback
          </h2>
          <p className="text-ink">
            Every ADEXTO agent exposes an HTTP 402 Payment Required endpoint. When external users, bots, or DAOs query the agent for quantitative signals, security audits, or generative assets, the agent accepts USDC/USDT0 micropayments via EIP-712 cryptographic signatures.
          </p>
          <div className="p-4 rounded-xl bg-white border border-line font-mono text-[11px] sm:text-xs text-ink overflow-x-auto">
            <span className="text-ok font-bold block mb-2">// Revenue Flow Equation</span>
            R_total = SwapFees(SovereignCurve) + x402_Micropayments(EVIDIQ)<br />
            Creator_Share = creatorFeeBps * Volume &nbsp;// paid per swap, not from a token allocation<br />
            Buyback_Execution = SovereignCurve.executeBuyback(treasuryNative) &rarr; burn
          </div>
        </section>

        {/* Section 4 */}
        <section className="section-block space-y-4">
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <span className="text-accent font-mono">§4.</span> Tokenomics &amp; Value Accrual ($ADEXTO)
          </h2>
          <p className="text-ink">
            {/* Cakupan dikoreksi ke empat chain (sebelumnya hanya menyebut 0G dan
                Arbitrum, padahal seluruh materi lain menyebut empat), dan porsi
                protokol dinyatakan sebagai RENCANA. Kontrak kurva hari ini membagi
                fee menjadi depth, creator, dan buyback — tidak ada irisan protokol
                di dalamnya, jadi menuliskannya sebagai penerimaan yang sudah
                berjalan tidak akan tahan diperiksa. */}
            The protocol native token ($ADEXTO) governs global factory parameters and subsidizes 0G TEE compute enclaves.
            A protocol fee share across all four networks is <strong>planned but not yet implemented</strong>: today every
            curve splits its swap fee between retained depth, the creator, and that token&apos;s own buyback vault, with no
            protocol cut in the path.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center font-mono text-xs pt-2">
            <div className="p-3.5 rounded-lg bg-white border border-line">
              <div className="text-xl font-semibold text-ink">40%</div>
              <div className="text-[11px] text-ink-soft font-bold">Community Stakers</div>
            </div>
            <div className="p-3.5 rounded-lg bg-white border border-line">
              <div className="text-xl font-semibold text-ink">25%</div>
              <div className="text-[11px] text-ink-soft font-bold">Ecosystem Grants</div>
            </div>
            <div className="p-3.5 rounded-lg bg-white border border-line">
              <div className="text-xl font-semibold text-ink">20%</div>
              <div className="text-[11px] text-ink-soft font-bold">Core Developers</div>
            </div>
            <div className="p-3.5 rounded-lg bg-white border border-line">
              <div className="text-xl font-semibold text-ink">15%</div>
              <div className="text-[11px] text-ink-soft font-bold">Liquidity Reserve</div>
            </div>
          </div>
        </section>
      </div>

      {/* CTA Footer */}
      <div className="mt-16 pt-8 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link href="/docs" className="text-xs font-bold text-accent hover:text-accent font-mono flex items-center gap-1.5">
          Explore EVIDIQ MCP Documentation →
        </Link>
        <Link
          href="/studio"
          className="px-6 py-3 rounded-xl font-bold text-xs bg-accent hover:bg-accent-strong text-white shadow-lg shadow-accent/10"
        >
          Launch in Studio
        </Link>
      </div>
    </div>
  );
}
