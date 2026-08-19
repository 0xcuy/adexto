import Link from "next/link";
import VerifiedDeploymentCard from "@/components/VerifiedDeploymentCard";
import { ShieldCheck, Cpu, Database, Zap, Lock, Terminal, Layers, Sparkles, CloudLightning, Award, Network, Globe, CheckCircle2, AlertCircle } from "lucide-react";
import { agentAttestation } from "@/lib/og-attestation";

/**
 * Halaman ini server component, jadi status attestation dibaca langsung dari
 * router 0G saat render — tanpa perjalanan tambahan lewat peramban dan tanpa
 * kunci API pernah meninggalkan server.
 */
export default async function DocsPage() {
  const tee = await agentAttestation();
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      {/* Header */}
      <div className="border-b-2 border-line pb-6 mb-10">
        <div className="kicker mb-3">DEVELOPER ECOSYSTEM &amp; INTEGRATION SPEC</div>
        <h1 className="text-3xl sm:text-4xl font-semibold text-ink">Technical status, component by component</h1>
        {/* Jangan mendaftar World ID ZKP dan Chainlink CCIP sebagai bagian arsitektur
            yang berjalan: seksi "status jujur" di bawah menyatakan keduanya BELUM aktif.
            Header yang membantah isi halamannya sendiri lebih merusak kepercayaan
            daripada daftar yang lebih pendek. */}
        {/* World ID sudah keluar dari daftar "belum aktif": gerbangnya menyala.
            Chainlink CCIP tetap disebut belum aktif karena lane-nya memang mati.
            Header yang membantah isi halamannya sendiri lebih merusak kepercayaan
            daripada daftar yang lebih pendek. */}
        <p className="text-sm text-ink mt-2 font-medium">What is built, what is deployed, and what is not. Live today: the curve and factory contracts, the World ID launch gate, native price feeds, and an HTTP 402 quote endpoint. Not live: the mainnet launch factory, x402 settlement, Chainlink CCIP lanes, the MCP tool suite, and governance voting. Every section below says which it is.</p>
      </div>

      {/* Enterprise Architecture Stack */}
      <div className="section-block mb-4 space-y-5">
        <div className="kicker">
          <Award className="w-4 h-4 text-ok" />
          <span>PRODUCTION ARCHITECTURE &amp; PROTOCOL COMPOSITION</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">Enterprise Infrastructure Layer</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs font-medium">
          <div className="p-4 rounded-xl bg-white border border-accent/30 space-y-1.5">
            <strong className="text-accent block font-bold text-sm">0G Compute &amp; DA Turbo</strong>
            <p className="text-ink-soft">Agent inference through the 0G Compute router, plus 0G DA for anchoring launch metadata. The router reports Intel TDX attestation via dstack for every model we call — read live in the table below, not asserted here.</p>
          </div>

          <div className="p-4 rounded-xl bg-white border border-accent/30 space-y-1.5">
            <strong className="text-accent block font-bold text-sm">World ID proof of personhood</strong>
            <p className="text-ink-soft">
              Launching requires a <strong>World ID 4.0</strong> zero-knowledge proof, verified <strong>server-side</strong>{" "}
              and bound to the launching wallet by its nullifier, so one person cannot farm fresh wallets to launch
              repeatedly. The wallet signature proves address control; this proves personhood. Every proof request is signed
              by our backend with the registered RP key, so nobody else can borrow this app&apos;s identity to harvest
              verifications elsewhere. Where the gate is not configured, the studio says so plainly instead of implying
              protection it does not have.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white border border-accent/30 space-y-1.5">
            <strong className="text-accent block font-bold text-sm">Sovereign Bonding Curve</strong>
            <p className="text-ink-soft">A standalone <code className="text-accent">SovereignCurve</code> per token, opening against a virtual reserve so no liquidity deposit is needed. Each swap splits the fee three ways on-chain: depth stays in the curve, the creator is paid directly, and the rest funds agent buybacks.</p>
          </div>

          <div className="p-4 rounded-xl bg-white border border-accent/30 space-y-1.5">
            <strong className="text-accent block font-bold text-sm">The Graph Decentralized Network</strong>
            <p className="text-ink-soft">A subgraph is published on the decentralized network, but it still indexes the v1 factory. The explorer reads a server-side registry instead, so nothing on this site is served by The Graph today.</p>
          </div>

          {/* Amber di kartu ini dulu menempatkan Cloudflare x402 sederet dengan
              "Planned: cross-chain routing" di bawah, padahal yang satu berjalan dan
              yang lain belum ada. Warna peringatan kini hanya dipakai untuk yang
              memang belum berjalan. */}
          <div className="p-4 rounded-xl bg-white border border-accent/30 space-y-1.5">
            <strong className="text-accent block font-bold text-sm">Cloudflare Workers x402</strong>
            <p className="text-ink-soft">An HTTP 402 challenge served from Cloudflare&apos;s edge, quoting the price and settlement vault for an agent call. Voucher verification returns 501: settlement is not implemented.</p>
          </div>

          <div className="p-4 rounded-xl bg-white border border-accent/30 space-y-1.5">
            <strong className="text-accent block font-bold text-sm">Buyback execution</strong>
            <p className="text-ink-soft">
              Treasury buybacks execute against the token&apos;s own curve and burn the tokens they buy. There is no external
              router in the path, so a buyback cannot be sandwiched on a venue we do not control.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white border border-warn/30 space-y-1.5">
            <strong className="text-warn block font-bold text-sm">Planned: cross-chain &amp; aggregator routing</strong>
            {/* 1inch dipindahkan ke sini. Sebelumnya "1inch Fusion & AMM Routing"
                terdaftar sebagai lapisan infrastruktur yang berjalan, padahal string
                "1inch" tidak ada di kontrak, skrip, maupun kode aplikasi mana pun —
                hanya di halaman ini. World ID sudah keluar dari daftar ini karena
                kini benar-benar terpasang. */}
            <p className="text-ink-soft">
              Cross-chain treasury routing is not active: Chainlink CCIP publishes no router on 0G or Monad, so those lanes
              cannot be opened yet — the receiver contracts are deployed but idle. Aggregator routing (1inch Fusion) is
              designed for but not integrated.
            </p>
          </div>
        </div>
      </div>

      {/* Bonding Curve Pricing Mechanics */}
      <div className="section-block mb-4 space-y-5">
        <div className="kicker">
          <Layers className="w-4 h-4 text-accent" />
          <span>ON-CHAIN PRICING &amp; BONDING CURVE SPECIFICATION</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">How Token Pricing &amp; Sovereign Curves Work</h2>
        
        <div className="space-y-4 text-xs text-ink leading-relaxed font-medium">
          <p>
            Unlike traditional launchpads where an admin dictates prices or drains exit liquidity, ADEXTO enforces <strong>deterministic on-chain pricing</strong> governed entirely by the token&apos;s own bonding curve:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs pt-2">
            <div className="p-4 rounded-xl bg-white border border-accent/30 space-y-2">
              <span className="text-accent font-bold block text-sm">1. Market-Driven Price</span>
              <p className="text-ink-soft font-sans text-xs">
                Prices are determined 100% algorithmically by supply and demand. Every buy order locks native currency (0G / ETH) and releases tokens along the constant-product curve (x·y=k over a virtual reserve).
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-accent/30 space-y-2">
              <span className="text-accent font-bold block text-sm">2. Tradable From Block One</span>
              <p className="text-ink-soft font-sans text-xs">
                The factory deploys the token and its curve in one transaction, opening against a virtual reserve. Zero
                creator capital: the launch costs gas and nothing else, and 100% of supply sits in the curve.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-accent/30 space-y-2">
              <span className="text-accent font-bold block text-sm">3. 0G TEE Auto-Buyback</span>
              <p className="text-ink-soft font-sans text-xs">
                On the default 0.30% tier, 0.05% of every swap routes to the token&apos;s 0G TEE Agent treasury, which buys
                tokens back and burns them. A separate 0.10% goes to the creator, and 0.15% of depth stays in the curve —
                that retained depth is what lifts the price floor as volume accumulates.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Delapan kartu di bawah sebelumnya mengapung tanpa judul seksi, sementara
          semua seksi lain punya kicker + judul. Hierarkinya jadi timpang. */}
      <div className="mb-5 mt-2">
        <div className="kicker">Planned MCP surface</div>
        <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-ink">
          Specified, not shipped
        </h2>
        {/* Judul lama: "What each component actually does" — dan kata "actually"
            membuatnya lebih buruk, karena keempat tool di bawah TIDAK ADA. Pencarian
            untuk `signet_generate_brand`, `sentinel_verify_calldata`,
            `helm_register_cron` dan `notary_anchor_receipt` di seluruh repo hanya
            menemukan halaman ini. Tanda tangan fungsinya ditulis dalam gaya yang
            sama seperti API yang berjalan, jadi seorang pembaca akan mencoba
            memanggilnya.
            Kartunya tidak dihapus — desainnya masih menjadi arah yang dituju — tapi
            seksinya sekarang menyatakan statusnya di judul dan di spanduk. */}
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-warn/30 bg-warn/10 p-4">
          <ShieldCheck className="w-4 h-4 text-warn shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed text-ink-soft">
            <strong className="text-ink">None of the four tools below exist yet.</strong> No MCP server ships in
            this repository and the function names are design sketches, not callable endpoints. They are kept
            here because they are the intended surface, and removing them would hide where the project is
            heading — but do not build against them.
          </p>
        </div>
      </div>

      {/* Grid of MCP tools */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        {/* Signet */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-ink text-base">EVIDIQ Signet MCP</h3>
              <span className="text-xs font-mono text-ink-soft font-bold">Deterministic Branding Generator</span>
            </div>
          </div>
          <p className="text-xs text-ink leading-relaxed font-medium">
            Generates pixel-perfect SVG logos, favicon sets, and OpenGraph social cards directly in memory without GPU overhead. Stores generated hashes permanently onto 0G Storage.
          </p>
          <div className="p-3 rounded-lg bg-white border border-line font-mono text-xs text-accent font-bold">
            signet_generate_brand({`{ name: "Adexto", palette: "cyber" }`})
          </div>
        </div>

        {/* Sentinel */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-ink text-base">EVIDIQ Sentinel MCP</h3>
              <span className="text-xs font-mono text-ink-soft font-bold">On-Chain Transaction Firewall</span>
            </div>
          </div>
          <p className="text-xs text-ink leading-relaxed font-medium">
            Inspects every raw calldata payload before the agent signs it. Rejects unbounded token approvals, flash-loan vulnerabilities, and prompt injection drain attacks.
          </p>
          <div className="p-3 rounded-lg bg-white border border-line font-mono text-xs text-accent font-bold">
            sentinel_verify_calldata({`{ target: "0xCurve...", value: 0 }`})
          </div>
        </div>

        {/* Helm */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-ink text-base">EVIDIQ Helm MCP</h3>
              <span className="text-xs font-mono text-ink-soft font-bold">Decentralized Autonomous Scheduler</span>
            </div>
          </div>
          <p className="text-xs text-ink leading-relaxed font-medium">
            Provides reliable 24/7 cron intervals inside 0G TEE without relying on centralized crontabs. Automatically triggers liquidity rebalancing and treasury buybacks.
          </p>
          <div className="p-3 rounded-lg bg-white border border-line font-mono text-xs text-accent font-bold">
            helm_register_cron({`{ interval: "15m", action: "rebalance_curve" }`})
          </div>
        </div>

        {/* Aegis & Notary */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-ok/10 text-ok flex items-center justify-center border border-ok/30">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-ink text-base">EVIDIQ Aegis &amp; Notary</h3>
              <span className="text-xs font-mono text-ink-soft font-bold">EIP-191 Cryptographic Receipts</span>
            </div>
          </div>
          <p className="text-xs text-ink leading-relaxed font-medium">
            {/* `0x8a3c…ee7D` disebut "the agent's enclave key". Itu alamat DOMPET
                DEPLOYER proyek ini — sebuah EOA biasa yang kunci privatnya ada di
                mesin pengembang. Menyebutnya kunci enclave adalah pernyataan palsu
                tentang di mana kunci itu berada. */}
            Would sign each agent decision and anchor the receipt to 0G DA. Nothing is signed this way today,
            and the address this card used to attribute to secure hardware is in fact the project deployer
            wallet — an ordinary EOA whose key sits on a developer machine.
          </p>
          <div className="p-3 rounded-lg bg-white border border-line font-mono text-xs text-ok font-bold">
            notary_anchor_receipt({`{ root: "0xa793...", chain: "0g-mainnet" }`})
          </div>
        </div>
      </div>

      {/* ── ADVANCED PROTOCOL SPECIFICATIONS ────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        {/* Spec 1: Multi-chain launch model */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-ink text-base">Multi-chain launch</h3>
              <span className="text-xs font-mono text-accent font-bold">One independent market per chain</span>
            </div>
          </div>
          <p className="text-xs text-ink leading-relaxed font-medium">
            A launch can target 1–4 chains in one flow. Each selected chain receives its own{" "}
            <code className="text-accent">AdextoToken</code> and its own{" "}
            <code className="text-accent">SovereignCurve</code>, deployed by that chain&apos;s factory in a single
            transaction. Addresses differ per chain and <strong>supply is not shared</strong>: there is no bridge, so each
            market has its own depth and its own price.
          </p>
          <div className="p-2.5 rounded-lg bg-white border border-line font-mono text-[11px] text-ink-soft space-y-1">
            <div>per chain: token + bonding curve (virtual reserve, no deposit)</div>
            <div className="text-warn">
              cross-chain supply would need a messaging layer on every chain; CCIP and LayerZero have no endpoint on 0G or
              Monad today.
            </div>
          </div>
        </div>

        {/* Spec 2: ERC-8004 AI Agent Identity Standard */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-ink text-base">Agent-bound token</h3>
              <span className="text-xs font-mono text-accent font-bold">Opening-window cap &amp; agent-only buyback</span>
            </div>
          </div>
          <p className="text-xs text-ink leading-relaxed font-medium">
            Caps any single transfer at 1% of supply for the first 5 blocks, so no wallet can take the opening curve in one shot. This lives in <code className="text-accent">AdextoToken._update</code> and is unrelated to any token standard. <code className="text-accent">executeTreasuryBuyback()</code> is restricted to the immutable agent address set at launch.
          </p>
          <div className="p-2.5 rounded-lg bg-white border border-line font-mono text-[11px] text-ink-soft">
            modifier onlyAgent() &#123; require(msg.sender == agentIdentity); _ &#125;
          </div>
        </div>

        {/* Spec 3: Cloudflare Workers x402 Micropayments */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30">
              <CloudLightning className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-ink text-base">Cloudflare x402 Protocol Flow</h3>
              <span className="text-xs font-mono text-accent font-bold">Payment challenge live · settlement pending</span>
            </div>
          </div>
          <p className="text-xs text-ink leading-relaxed font-medium">
            Puts an HTTP 402 gate in front of an agent API so another machine can read the price and the settlement vault without a blockchain call. A signed EIP-712 voucher is checked for authenticity, but settlement is not built, so the gateway answers 501 rather than pretending payment occurred.
          </p>
          <div className="p-2.5 rounded-lg bg-white border border-line font-mono text-[11px] text-ink-soft">
            Authorization: x402-v1 EIP712Sig(0x1234...USDC)
          </div>
        </div>

        {/* Spec 4: Subdomain Dynamic Rewrite & On-Chain DAO */}
        <div className="card card-hover p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-ink text-base">Subdomain Rewrite &amp; DAO Specs</h3>
              <span className="text-xs font-mono text-accent font-bold">Edge Routing &amp; AdextoGovernor</span>
            </div>
          </div>
          <p className="text-xs text-ink leading-relaxed font-medium">
            Edge middleware translates <code className="text-accent">[token].adexto.xyz</code> into a per-token terminal. The Governor is deployed on all four chains with a 4,000,000-token quorum and a 100,000-token proposal threshold — but the token those numbers are denominated in does not exist yet, so no vote can be cast.
          </p>
          <div className="p-2.5 rounded-lg bg-white border border-line font-mono text-[11px] text-ink-soft">
            Quorum: 4,000,000 tokens | Period: 3 days | Governance token: not deployed
          </div>
        </div>
      </div>

      {/* 0G TEE Architecture Section */}
      {/* Seksi ini dulu berjudul "0G Private Computer (TEE) Hardware Specification"
          dan berbunyi: "The agent private keys never leave the secure hardware
          boundary, ensuring zero developer tampering and strict compliance for
          institutional VC capital", dengan kartu "Attestation Protocol: Remote
          Quote SEV-SNP".

          Tidak ada satu baris pun di repo ini yang mengambil, mengurai, atau
          memverifikasi laporan attestation SEV-SNP — sudah dicari dengan grep di
          seluruh src/, cloudflare-worker/, dan scripts/. Jalur agennya adalah
          `fetch` HTTPS biasa ke router-api.0g.ai. Menyebut "Remote Quote SEV-SNP"
          sebagai protokol attestation KAMI, di halaman berjudul spesifikasi, adalah
          klaim yang runtuh pada pertanyaan pertama.

          Juga: "Intel SGX / AMD SEV-SNP" menyebut dua teknologi yang berbeda
          sekaligus, yang menandakan tidak ada satu pun yang benar-benar diperiksa.
          Dan `teeAttestationRoot` di calldata factory sebenarnya root penyimpanan
          0G DA — dinamai seolah attestation. Nama itu tidak bisa diubah lagi tanpa
          factory baru, jadi minimal ia dijelaskan di sini. */}
      {/* Seksi ini sudah dua kali salah, ke dua arah berlawanan.
          Mula-mula ia berbunyi "The agent private keys never leave the secure
          hardware boundary… Attestation Protocol: Remote Quote SEV-SNP" tanpa satu
          pun pemeriksaan. Lalu saya menghapus klaim TEE-nya seluruhnya — juga
          salah, karena router 0G MEMANG menyatakan attestation, per model, dalam
          bentuk yang bisa dibaca mesin.
          Yang benar ada di tengah, dan sekarang DIBACA, bukan ditulis: tabel di
          bawah datang dari `GET /v1/models` di router. Perhatikan juga hardware-nya
          Intel TDX, bukan AMD SEV-SNP seperti yang situs ini klaim selama berbulan. */}
      <section className="section-block space-y-4">
        <h2 className="text-lg font-bold text-ink flex items-center gap-2">
          <Cpu className="w-5 h-5 text-accent" />
          Agent execution: read from the router, not asserted here
        </h2>

        <div
          className={`flex items-start gap-3 rounded-2xl border p-4 ${
            tee.live && tee.allAttested ? "border-ok/30 bg-ok/10" : "border-warn/30 bg-warn/10"
          }`}
        >
          {tee.live && tee.allAttested ? (
            <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
          )}
          <p className="text-xs leading-relaxed text-ink-soft">
            {!tee.live ? (
              <>
                <strong className="text-ink">The 0G router did not answer.</strong> Attestation status is
                unknown right now — this page will not present that as safe.
              </>
            ) : tee.allAttested ? (
              <>
                <strong className="text-ink">Every model this app can use reports TEE attestation.</strong>{" "}
                Read live from the router when this page rendered. Verify it yourself with{" "}
                <code className="text-ink">curl -s https://adexto.xyz/api/tee</code>.
              </>
            ) : (
              <>
                <strong className="text-ink">At least one selectable model is not reported as attested.</strong>{" "}
                See the table below.
              </>
            )}
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="table-clean min-w-[560px]">
            <thead>
              <tr>
                <th>Model</th>
                <th>Attested</th>
                <th>Tier</th>
                <th>Hardware</th>
                <th>Verifier</th>
              </tr>
            </thead>
            <tbody>
              {tee.models.map((m) => (
                <tr key={m.id}>
                  <td className="font-mono text-[11px] text-ink">{m.id}</td>
                  <td className="font-mono text-[11px]">
                    {m.attested === true ? (
                      <span className="text-ok">yes</span>
                    ) : m.attested === false ? (
                      <span className="text-danger">no</span>
                    ) : (
                      <span className="text-warn">not reported</span>
                    )}
                  </td>
                  <td className="font-mono text-[11px] text-ink-soft">{m.tier ?? "—"}</td>
                  <td className="font-mono text-[11px] text-ink-soft">{m.teeType ?? "—"}</td>
                  <td className="font-mono text-[11px] text-ink-soft">{m.verifier ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs sm:text-sm text-ink-soft leading-relaxed">
          The two tiers mean different things, and 0G draws the line themselves:{" "}
          <strong className="text-ink">TeeML</strong> is 0G&apos;s own model in 0G&apos;s own enclave, with the
          inference attested inside it. <strong className="text-ink">TeeTLS</strong> is a third party running the
          weights while 0G attests the transport, so the routing path is provable rather than the inference
          itself. All three models above are TeeML.
        </p>

        <p className="text-xs sm:text-sm text-ink-soft leading-relaxed">
          <strong className="text-ink">Where our verification stops.</strong> The table is the router&apos;s
          declaration, not a raw Intel TDX quote. There is no attestation endpoint on the router — every likely
          path returns 404 — and completion responses carry no attestation material, so ADEXTO cannot
          independently prove the enclave for a specific answer. Doing that would mean running the dstack
          verifier against a quote we cannot currently obtain. What each response does carry is the serving
          provider&apos;s on-chain address in an <code className="text-accent">x-provider</code> header, which
          names who answered even though it does not attest how.
        </p>

        <p className="text-xs sm:text-sm text-ink-soft leading-relaxed">
          One naming trap worth stating plainly: the factory parameter{" "}
          <code className="text-accent">teeAttestationRoot</code> holds the 0G DA storage root of the launch
          metadata. It is a content hash of what was uploaded, not a hardware attestation. The name is fixed in a
          deployed contract signature and cannot be corrected without a new factory.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs pt-2">
          <div className="p-3.5 rounded-lg bg-white border border-line">
            <span className="text-ink-soft block text-[11px] font-bold">Inference endpoint</span>
            <span className="text-ink font-bold text-sm">router-api.0g.ai/v1</span>
          </div>
          <div className="p-3.5 rounded-lg bg-white border border-line">
            <span className="text-ink-soft block text-[11px] font-bold">Attestation source</span>
            <span className="text-ink font-bold text-sm">router declaration</span>
          </div>
          <div className="p-3.5 rounded-lg bg-white border border-line">
            <span className="text-ink-soft block text-[11px] font-bold">Raw quote verified by us</span>
            <span className="text-warn font-bold text-sm">No</span>
          </div>
        </div>
      </section>

      {/* ── ON-CHAIN DEPLOYMENT VERIFICATION ────────────────────────── */}
      <div className="-mx-4 sm:-mx-6 lg:-mx-8 mt-10">
        <VerifiedDeploymentCard />
      </div>
    </div>
  );
}
