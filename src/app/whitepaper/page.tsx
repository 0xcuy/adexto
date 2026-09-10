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
          {/* Semver dibuang. "VERSION 2.4.0" menyiratkan pernah ada 1.0 dan 2.0
              yang dipublikasikan; tidak pernah ada. Sebuah whitepaper juga tidak
              punya API untuk distabilkan, jadi tanggal sudah cukup — dan tanggal
              memberi pembaca hal yang benar-benar mereka butuhkan: seberapa basi
              dokumen ini. */}
          <span>REVISED AUGUST 2026</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-semibold text-ink tracking-tight leading-tight">
          ADEXTO: Autonomous Decentralized EXchange &amp; Token Orchestrator
        </h1>
        <p className="text-sm sm:text-base text-ink mt-4 leading-relaxed font-normal bg-white p-4 rounded-xl border border-line">
          {/* Abstrak lama menyebut "1-Click Token Launchpads" dan "backed by 0G
              Private Computer (TEE)". Peluncuran menuntut sambung dompet, tanda
              tangan attestation, lalu satu transaksi per chain — bukan satu klik.
              (Dulu ada langkah proof World ID di antaranya; gerbangnya sudah
              dicabut, jadi langkahnya dihapus dari daftar ini juga.) Dan bagian
              TEE-nya adalah klaim 0G yang tidak kami verifikasi. */}
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
              <span className="text-ink">
                A per-token bonding curve over a virtual reserve. The creator&apos;s configured fee splits three
                ways (e.g. 0.15% depth / 0.10% creator / 0.05% buyback) and the protocol&apos;s 0.10% is charged
                on top, so a trader on that tier pays 0.40% in total.
              </span>
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
              {/* Kalimat lama menyebut orchestrator sebagai koordinator yang mengelola
                  buyback, burn, DAN penyaluran pendapatan x402. Frasa terakhir itu
                  sekarang terlarang di `audit_claims.mjs`, jadi tidak dikutip harfiah di
                  sini — mengutip frasa terlarang di dalam komentar sudah pernah
                  menggagalkan penjaga di `launch-state.ts`.

                  Ia salah ke arah SEBALIKNYA dari kartu di /pitch, dan itu yang membuat
                  pasangan ini pantas dicatat: satu halaman menyangkal penyelesaian yang
                  sudah bekerja, halaman lain mengklaim penyaluran pendapatan yang belum
                  dibangun. Dua-duanya berasal dari satu keputusan produk yang berubah dan
                  hanya sebagian permukaannya ikut diperbarui.

                  Burn-nya nyata dan permissionless. Yang tidak ada adalah kaki yang
                  memberinya makan dari pendapatan x402 — hari ini USDC-nya berhenti di
                  treasury dan direbalance manual. Jadi klaim penyaluran itu DIHAPUS,
                  bukan diperhalus. */}
              <span className="text-ink">
                Coordinates the cross-chain buy path and the permissionless buyback burn. Routing x402 revenue
                into the vault needs no transfer: a delivery is a buy, so it pays the buyback fee leg and the
                vault grows on every fill. The endpoint then spends it to buy and burn once the vault outweighs
                the gas to trigger it.
              </span>
            </div>
          </div>
        </section>

        {/* Section 3 */}
        <section className="section-block space-y-4">
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <span className="text-accent font-mono">§3.</span> Cross-Chain Buys over x402 &amp; Auto-Buyback
          </h2>
          <p className="text-ink">
            The x402 endpoint sells a <strong className="text-ink">cross-chain buy</strong>, not paid inference.
            An unpaid request is answered with HTTP 402 and a quote; paying it means signing one EIP-3009
            transfer authorization for USDC on Base, which the token contract itself verifies, and the curve on
            the target chain sends the tokens straight to the payer&apos;s address. No bridge, and no need to
            hold the target chain&apos;s gas asset. Delivery is executed before the charge, so a failed fill
            costs the protocol rather than the buyer.
          </p>
          <div className="p-4 rounded-xl bg-white border border-line font-mono text-[11px] sm:text-xs text-ink overflow-x-auto">
            <span className="text-ok font-bold block mb-2">// Revenue Flow Equation</span>
            R_total = SwapFees(AdextoCurve) + x402_CrossChainBuys<br />
            Trader_Pays = swapFeeBps + PROTOCOL_FEE_BPS &nbsp;// the protocol leg is additive<br />
            Creator_Share = creatorFeeBps * Volume &nbsp;// paid per swap, not from a token allocation<br />
            Protocol_Share = PROTOCOL_FEE_BPS * Volume &nbsp;// to an immutable treasury, claimable by anyone<br />
            Buyback_Execution = AdextoCurve.executeBuyback(treasuryNative) &rarr; burn
          </div>
        </section>

        {/* Section 4 */}
        <section className="section-block space-y-4">
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <span className="text-accent font-mono">§4.</span> Tokenomics &amp; Value Accrual ($ADEXTO)
          </h2>
          {/* SELURUH bagian ini ditulis ulang. Yang lama memuat lima pernyataan salah,
              dan empat di antaranya bukan sekadar basi — memang tidak pernah benar.

              1. "governs global factory parameters". `AdextoFactory` tidak punya SATU
                 setter pun, setiap tarif `immutable`, tidak ada owner, dan menu
                 governance sudah dicabut seluruhnya. Tidak ada parameter yang bisa
                 diatur siapa pun, termasuk pemegang token.
              2. "subsidizes 0G TEE compute enclaves". Tidak ada whitelist compute dan
                 tidak ada jalur subsidi di kontrak mana pun. Klaim yang sama sudah
                 diralat di komentar `AdextoGovernor.sol`, tetapi terlewat di sini.
              3. "but not deployed". Sudah ter-deploy di keempat mainnet: 21.281 B kode,
                 VERSION 0.11.0, PROTOCOL_FEE_BPS 10 di 0G, Base, Arbitrum dan Monad.
              4. "Every curve now live ... with no protocol cut in the path". Kebalikannya.
                 Kedua pasar yang live memakai `protocolFeeBps` 10 dan SUDAH membayar
                 treasury: $ADEXTO 0,0000372 0G, $ADT 0,00001 0G.
              5. Tabel alokasi 40/25/20/15 — Community Stakers, Ecosystem Grants, Core
                 Developers, Liquidity Reserve. Tidak ada satu pun dari empat itu. Tidak
                 ada staking, hibah, vesting, atau cadangan di kontrak mana pun.
                 `AdextoToken` melakukan `_mint(msg.sender, initialSupply)` dan launcher
                 memindahkan SELURUHNYA ke kurva dalam transaksi yang sama. Dibaca dari
                 chain: 100,00% supply dipegang kurva di kedua pasar.

              Yang paling berbahaya justru tabelnya, karena angka dalam kotak terbaca
              seperti fakta terverifikasi dan itulah bagian yang paling mungkin
              di-screenshot. Angka di bawah sekarang semuanya bisa dibaca dari chain. */}
          <p className="text-ink">
            $ADEXTO is not a token with powers over this protocol. It is a market launched through the same factory as
            any other, on a ticker the factory reserves for the protocol&apos;s own deployer. It governs nothing:{" "}
            <code className="text-accent font-mono text-xs">AdextoFactory</code> and{" "}
            <code className="text-accent font-mono text-xs">AdextoCurve</code> contain no setters at all, every fee rate
            is <code className="text-accent font-mono text-xs">immutable</code>, and there is no owner. No vote, and no
            token balance, can change a parameter that does not have a setter.
          </p>
          <p className="text-ink">
            There was never an allocation. One billion tokens are minted in the launch transaction and the launcher moves
            the entire balance into the bonding curve before that transaction ends, so the only way to obtain any is to
            buy from the curve at the price the curve quotes. Supply moves in one direction only: buyback native accrued
            from swap fees is spent along the curve and the tokens bought are burned, which is why $ADEXTO now reads
            999,999,925.84 rather than a round billion.
          </p>
          <p className="text-ink">
            The 0.10% protocol fee is live, not planned. Factory{" "}
            <code className="text-accent font-mono text-xs">0.11.0</code> is deployed on all four mainnets with{" "}
            <code className="text-accent font-mono text-xs">PROTOCOL_FEE_BPS = 10</code> and an immutable{" "}
            <code className="text-accent font-mono text-xs">protocolTreasury</code>, and both live markets have already
            paid it — 0.0000372 0G from $ADEXTO and 0.00001 0G from $ADT. It is added on top of the configured swap fee
            rather than taken from it, so a market set to 0.30% costs a trader 0.40%. Markets launched on the earlier
            0.10.0 factory carry no protocol leg and never can: their rates are immutable too.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center font-mono text-xs pt-2">
            <div className="p-3.5 rounded-lg bg-white border border-line">
              <div className="text-xl font-semibold text-ink">100%</div>
              <div className="text-[11px] text-ink-soft font-bold">Supply in the curve</div>
            </div>
            <div className="p-3.5 rounded-lg bg-white border border-line">
              <div className="text-xl font-semibold text-ink">0%</div>
              <div className="text-[11px] text-ink-soft font-bold">Pre-allocated</div>
            </div>
            <div className="p-3.5 rounded-lg bg-white border border-line">
              <div className="text-xl font-semibold text-ink">0.40%</div>
              <div className="text-[11px] text-ink-soft font-bold">Paid per trade</div>
            </div>
            <div className="p-3.5 rounded-lg bg-white border border-line">
              <div className="text-xl font-semibold text-ink">0.10%</div>
              <div className="text-[11px] text-ink-soft font-bold">Protocol leg of it</div>
            </div>
          </div>
        </section>
      </div>

      {/* CTA Footer */}
      <div className="mt-16 pt-8 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Label lama mengajak pembaca menjelajahi dokumentasi MCP EVIDIQ. Ia menjanjikan
            dokumentasi untuk perangkat yang BELUM dibangun — /docs sendiri menyebutnya
            belum live — lalu mengarahkan ke /docs yang tidak memuatnya. Tautan yang
            menjanjikan halaman tidak ada lebih merusak daripada tidak ada tautan.
            Labelnya kini terlarang di `audit_claims.mjs`, jadi tidak dikutip harfiah.

            Penggantinya menunjuk /x402, yang benar-benar mendokumentasikan endpoint yang
            dibahas di §3, lengkap dengan bentuk payload dan kedua hash transaksinya. */}
        <Link href="/x402" className="text-xs font-bold text-accent hover:text-accent font-mono flex items-center gap-1.5">
          Read the x402 integration reference →
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
