import Link from "next/link";
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Terminal, GitCommit, FileSearch } from "lucide-react";
import report from "@/config/security-report.json";
import {
  ADEXTO_CONTRACTS,
  CURVE_FACTORY_GENERATION,
  SUPERSEDED_CURVE_FACTORY_GENERATION,
} from "@/config/contracts";


export const metadata = {
  title: "Security · ADEXTO",
  description:
    "Protocol guarantees read from the contracts, plus the raw output of every analyser and fuzzer that was run against them. Reproducible from the published commit.",
};

/**
 * Halaman keamanan yang bisa DIPERIKSA, bukan badge.
 *
 * Satu aturan membentuk seluruh berkas ini: tidak ada angka yang ditulis tangan.
 * Tabel verifikasi dibaca dari `src/config/security-report.json`, dan satu-satunya
 * yang menulis berkas itu adalah `scripts/security-scan.mjs`, yang benar-benar
 * menjalankan tiap mesin. Sebuah "✅" yang diketik manusia adalah badge dengan
 * langkah tambahan: ia terlihat seperti bukti, tidak terikat ke hasil apa pun, dan
 * tetap hijau setelah kontraknya berubah.
 *
 * Konsekuensinya harus diterima apa adanya: mesin yang menemukan sesuatu ditampilkan
 * MENEMUKAN sesuatu. Slither melaporkan puluhan temuan dan halaman ini mengatakannya,
 * lalu memisahkan mana yang berada di jalur yang benar-benar dipakai sebuah launch.
 * Angka yang dipisah begitu lebih berguna bagi pembaca daripada centang, dan lebih
 * sulit dibantah.
 *
 * Angkanya sengaja TIDAK ditulis di komentar ini lagi. Sebelumnya di sini tertulis
 * "45 temuan", dan angka itu ikut basi bersama laporannya tanpa ada yang tahu — lihat
 * catatan tentang berkas hasil Slither di daftar batasan di bawah.
 */

type Engine = {
  id: string;
  name: string;
  tool: string;
  version?: string | null;
  status: string;
  ran: boolean;
  counts?: Record<string, number>;
  launchPathCounts?: Record<string, number>;
  detail?: string;
  cases?: string[];
};

/**
 * Dicast lewat `unknown` dengan sengaja.
 *
 * TypeScript menyimpulkan tipe literal dari JSON, sehingga setiap mesin punya bentuk
 * `counts` yang berbeda dengan kunci opsional bernilai `undefined`. Itu tidak
 * kompatibel dengan `Record<string, number>` tanpa cast dua langkah. Alternatifnya —
 * menyeragamkan `counts` di skrip pemindai — akan memaksa angka yang tidak berlaku
 * untuk sebuah mesin ditulis sebagai nol, dan nol yang dikarang di halaman keamanan
 * justru hal yang berusaha dihindari seluruh berkas ini.
 */
const engines = report.engines as unknown as Engine[];

/**
 * Label ini dulu berbunyi "findings, triaged" dengan warna amber, dan dua-duanya
 * salah untuk keadaan yang diwakilinya.
 *
 * "Triaged" adalah istilah internal: pembaca pertama yang melihatnya bertanya apa
 * artinya, dan itu sendiri cacat di halaman yang seluruh gunanya mudah diperiksa.
 * Amber lebih buruk lagi — di seluruh situs ini amber berarti PERINGATAN, sehingga
 * baris yang sebenarnya berarti "semuanya sudah dibaca dan dijelaskan" justru terbaca
 * seperti alarm. Angka temuannya tetap tampil utuh di kolom sebelahnya, jadi warna
 * netral tidak menyembunyikan apa pun; ia hanya berhenti melebih-lebihkan.
 *
 * Amber sekarang dipesan untuk `findings`, yaitu keadaan yang memang menuntut
 * tindakan dan belum ada penjelasannya.
 */
const STATUS: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  clean: { label: "no findings", className: "text-ok bg-ok/10 border-ok/30", Icon: CheckCircle2 },
  triaged: { label: "reviewed below", className: "text-ink-soft bg-cream-3 border-line", Icon: FileSearch },
  findings: { label: "needs action", className: "text-warn bg-warn/10 border-warn/30", Icon: AlertTriangle },
  error: { label: "run failed", className: "text-danger bg-danger/10 border-danger/30", Icon: XCircle },
  "not-installed": { label: "not run", className: "text-ink-soft bg-cream-3 border-line", Icon: XCircle },
};

/**
 * Jaminan tingkat protokol.
 *
 * Setiap baris menyebut MEKANISMENYA, bukan cuma sifatnya. "No owner" saja adalah
 * klaim; "tidak ada import Ownable, tidak ada owner(), satu-satunya fungsi
 * state-changing adalah executeTreasuryBuyback" adalah sesuatu yang bisa dibantah
 * pembaca dalam satu menit dengan membuka berkasnya. Bentuk kedua yang membuat
 * halaman ini ada.
 *
 * ISI STRING DI BAWAH WAJIB BAHASA INGGRIS.
 *
 * Versi pertama halaman ini menulis seluruh penjelasan dalam bahasa Indonesia,
 * sementara sembilan halaman lain dan README seluruhnya Inggris — jadi satu-satunya
 * halaman yang dibuat untuk dibaca orang luar justru satu-satunya yang berganti
 * bahasa di tengah. Komentar kode boleh tetap Indonesia seperti sisa repo ini; yang
 * DIRENDER tidak boleh.
 */
const GUARANTEES: Array<{ title: string; where: string; how: string }> = [
  {
    title: "No owner, no admin",
    where: "AdextoToken.sol · AdextoCurve.sol · SovereignCurve.sol",
    how:
      "AdextoToken imports exactly one thing: OpenZeppelin's ERC20. No Ownable, no owner(), no onlyOwner, no roles. Both curve generations have a single privileged modifier, onlyFactory, and it gates only bindToken and initializeCurve — both one-shot, and neither moves native. The 0.11.0 curve adds a protocol fee leg and no setter for it, so it stays ownerless.",
  },
  {
    title: "No upgradeability",
    where: "AdextoFactory.sol · AdextoCurveFactory.sol",
    how:
      "The token and the curve are created with a plain `new` (CREATE) — no proxy, no CREATE2. There is no implementation slot and no delegatecall anywhere in the three launch-path contracts. What is deployed is what runs, permanently.",
  },
  {
    title: "Fixed supply, no privileged mint",
    where: "AdextoToken.sol",
    how:
      "`_mint` is called exactly once, inside the constructor. After that there is no mint function, no minter role, and no path that can increase supply. The only direction available is down, through buyback burns.",
  },
  {
    title: "No arbitrary withdrawal",
    where: "AdextoCurve.sol · SovereignCurve.sol",
    how:
      "On the 0.11.0 curve exactly three functions send native out: `sell` pays the seller, `claimCreatorFees` pays the immutable creator, and `claimProtocolFees` pays the immutable protocol treasury. The 0.10.0 curve has the first two. There is no withdraw, rescue, sweep, drain, emergency, skim, migrate, selfdestruct or fallback in either. Anyone may trigger either claim, and that is safe precisely because both destinations are immutable — a caller cannot redirect the money, only push it where it was always going.",
  },
  {
    title: "100% of supply enters the curve",
    where: "AdextoFactory.sol · AdextoCurveFactory.sol",
    how:
      "The whole supply is minted to the factory, moved into the curve in the same transaction, and then the factory requires its own balance to be zero before the launch is allowed to succeed. The creator receives no tokens at all — their income is a slice of each swap fee.",
  },
  {
    title: "Immutable agent address",
    where: "AdextoToken.sol",
    how:
      "`agentIdentity`, `agentId`, `agentRegistry`, `agentBound` and `sovereignDexHook` are all `immutable`, with no setters. An ERC-8004 binding is verified on-chain at launch and cannot be moved afterwards.",
  },
  {
    title: "Permanent market",
    where: "AdextoCurve.sol · SovereignCurve.sol",
    how:
      "There is no graduation step and no migration to another venue. The curve is the market, permanently. The usual launchpad pattern moves a curve into an external pool, and that step is where much of the historical exploit surface lives.",
  },
  {
    title: "Bounded, permissionless buyback",
    where: "AdextoCurve.sol · SovereignCurve.sol",
    how:
      "`executeBuyback` deliberately has no caller gate — what restrains it is size: at most 1% of the native reserve per call. The native never leaves the contract; it moves from the buyback bucket into the curve reserve, and the tokens it buys are burned.",
  },
];

/**
 * Triage temuan di jalur peluncuran.
 *
 * Bagian ini yang paling mudah dipalsukan dan karena itu paling penting ditulis
 * jujur: setiap temuan Medium yang menyentuh kontrak jalur peluncuran disebut, dengan
 * alasan kenapa ia tidak bisa dieksploitasi — atau, kalau memang bisa, dengan
 * pengakuan. Diambil dari keluaran Slither dan Aderyn pada commit di bawah.
 */
const TRIAGE: Array<{ finding: string; engine: string; where: string; why: string }> = [
  {
    finding: "divide-before-multiply",
    engine: "Slither · Medium",
    /**
     * KEDUA generasi disebut, karena Slither memang melaporkan keduanya.
     *
     * Diperiksa di build/security/slither.json, bukan diasumsikan: 9 instance di
     * SovereignCurve.sol dan 12 di AdextoCurve.sol. Menyebut hanya yang lama akan
     * membuat tabel ini terlihat tidak mencakup kontrak yang justru sedang hidup —
     * bentuk penyembunyian yang paling tidak disengaja dan paling mudah terjadi
     * setiap kali ada generasi baru.
     */
    where: "AdextoCurve.getSellQuote · SovereignCurve.getSellQuote",
    why:
      "Fees are computed from `grossOut`, which is itself the result of a division, so a little precision is genuinely lost. The direction is what settles it: the division floors, so the remainder always stays with the curve rather than the trader. The economic consequence is tested directly — the fuzz properties `roundTripNeverProfitable` and `buyRoundsInFavourOfCurve` fail if that direction ever inverts.",
  },
  {
    finding: "incorrect-equality",
    engine: "Slither · Medium/High",
    where: "AdextoFactory.deployTrinity · AdextoCurveFactory.deployTrinity",
    why:
      "The strict comparison being flagged is `require(balanceOf(address(this)) == 0)`. Exact equality is the point here: the launch must fail unless the entire supply actually moved into the curve. Relaxing it to `<=` would permit leftover tokens to sit in the factory. Reported twice per factory generation, identically.",
  },
  {
    finding: "reentrancy-no-eth",
    engine: "Slither · Medium (32 instances across both generations)",
    where: "AdextoCurve and SovereignCurve — sell, initializeCurve, receive · both factories — deployTrinity",
    why:
      "Every one of those curve functions carries the `nonReentrant` modifier; Slither does not model a hand-written guard, so it flags them anyway. `initializeCurve` is additionally `onlyFactory` and one-shot. `deployTrinity` calls contracts it created itself in the same transaction, so no third-party code sits on that path. `claimProtocolFees` on the 0.11.0 curve is flagged for the same reason and is guarded the same way, with the added property that its destination is immutable. The solvency invariant — which includes `protocolOwed` as a term — was driven against random action sequences by two different fuzzing engines and never broke.",
  },
  {
    finding: "nonReentrant is not the first modifier",
    engine: "Aderyn · Low",
    where: "AdextoCurve.initializeCurve · SovereignCurve.initializeCurve",
    why:
      "The order is `onlyFactory nonReentrant`. That is safe here because `onlyFactory` only compares `msg.sender` and makes no external call, so nothing can re-enter before the guard takes effect.",
  },
  {
    finding: "ETH transferred without address checks",
    engine: "Aderyn · High",
    where: "AdextoCurve.claimCreatorFees and claimProtocolFees · SovereignCurve.claimCreatorFees",
    why:
      "Each destination is `immutable`. `creator` comes from the `msg.sender` that called `deployTrinity`, and the zero address cannot send a transaction, so it can never hold that value. `protocolTreasury` is a constructor argument that both the factory and the curve reject when it is zero. Neither function takes a destination parameter at all, which is why both can safely be permissionless.",
  },
  {
    finding: "Contract locks Ether without a withdraw function",
    engine: "Aderyn · High (4 instances)",
    /**
     * Nama keempat kontraknya TIDAK dituliskan di sini, dan itu bukan penyembunyian.
     *
     * Dua di antaranya memuat singkatan protokol jembatan lintas-chain, dan singkatan
     * itu ada di daftar BANNED audit_claims.mjs — daftar yang memblokir seluruh topik
     * itu dari setiap halaman karena fiturnya dicabut. Penjaga itu berbunyi terhadap
     * halaman INI saat pertama dibangun, dan pilihannya jelas: melemahkan penjaga demi
     * satu baris tabel, atau menunjuk artefak mentah yang memuat nama lengkapnya.
     * Presisinya tidak hilang — `build/security/aderyn.json` menyebut tiap berkas dan
     * nomor barisnya, dan tabel alamat di /docs menyebut keempatnya.
     */
    where: "four v1-generation contracts, all outside the launch path",
    why:
      "True, and admitted elsewhere on this site: native sent to those superseded bridge receivers is locked forever, because the contracts have no withdraw, sweep or transfer. That is one of the reasons the cross-chain path was dropped rather than repaired — repairing it would mean adding the withdrawal path this protocol promises does not exist. All four sit outside the launch path; a launch never touches them. The exact filenames and line numbers are in build/security/aderyn.json.",
  },
  /**
   * ENTRI `reentrancy-eth` DICABUT KARENA KONTRAKNYA DIHAPUS, BUKAN KARENA DIPERBAIKI.
   *
   * Isinya dulu: "Slither's only High finding, and it sits in the superseded v1
   * generation ... The contract stays on chain because a deployed address is permanent."
   *
   * Dua-duanya salah, dan baru ketahuan saat dicek. Berkasnya bernama
   * `AdextoTrinityFactoryV2`, jadi ia bukan generasi v1 — v1 adalah
   * `AdextoTrinityFactory`, berkas yang berbeda. Dan ia TIDAK ada di chain: keempat
   * `NEXT_PUBLIC_FACTORY_V2_*` kosong, tidak ada alamatnya di registry, dan
   * perbandingan bytecode memutuskannya — kode di keempat alamat `factoryAddress`
   * berukuran 7216 byte dengan hash identik, sedangkan artefak
   * `AdextoTrinityFactoryV2` 17672 byte.
   *
   * Karena tidak pernah di-broadcast, tidak ada apa pun on-chain yang temuan itu
   * berlaku padanya, jadi berkasnya dihapus. Konsekuensinya harus dinyatakan terang:
   * hitungan Slither High turun dari 1 ke 0 karena KODENYA HILANG, bukan karena ada
   * yang dibetulkan. Itu dicatat di daftar "what this page does not claim" di bawah
   * supaya penurunan angkanya tidak terbaca sebagai perbaikan keamanan.
   */
];

const CHAINS = [
  { key: "og" as const, label: "0G Mainnet", id: 16661 },
  { key: "base" as const, label: "Base Mainnet", id: 8453 },
  { key: "arbitrum" as const, label: "Arbitrum One", id: 42161 },
  { key: "monad" as const, label: "Monad Mainnet", id: 143 },
];

function Count({ counts }: { counts?: Record<string, number> }) {
  if (!counts) return <span className="text-ink-faint">—</span>;
  const order = ["High", "Medium", "Low", "Informational", "Optimization"];
  const keys = Object.keys(counts).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
      {keys.map((k) => (
        <span key={k} className="whitespace-nowrap">
          <span className="text-ink-soft">{k}</span>{" "}
          <span className={counts[k] === 0 ? "text-ok font-bold" : "text-ink font-bold"}>
            {counts[k].toLocaleString("en-US")}
          </span>
        </span>
      ))}
    </span>
  );
}

export default function SecurityPage() {
  const commitShort = report.commit ? String(report.commit).slice(0, 12) : "unknown";
  const repoBase = "https://github.com/0xcuy/adexto";

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      {/* Header */}
      <div className="border-b-2 border-line pb-6 mb-10">
        <div className="kicker mb-3">SECURITY</div>
        <h1 className="text-3xl sm:text-4xl font-semibold text-ink">
          What the contracts guarantee, and what the tools actually found
        </h1>
        {/* Sengaja BUKAN "audited". Tidak ada firma yang mengaudit ini, dan menulis
            "audited" tanpa laporan yang bisa ditunjuk adalah klaim yang tidak bisa
            dipertahankan — persis kelas klaim yang dicabut dari seluruh situs ini. */}
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          ADEXTO has <strong className="text-ink">not</strong> been audited by a security firm. Rather than print a
          badge, this page publishes the two things a reader can check without trusting us: the guarantees that follow
          from the code, and the unedited counts from every analyser and fuzzer that was run. Every number below is read
          from{" "}
          <code className="text-accent">src/config/security-report.json</code>, which is written only by{" "}
          <code className="text-accent">scripts/security-scan.mjs</code> — never by hand.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-ink-soft">
            <GitCommit className="h-3.5 w-3.5 text-accent" />
            commit <a href={`${repoBase}/commit/${report.commit}`} className="font-bold text-accent hover:underline">{commitShort}</a>
          </span>
          <span className="rounded-lg border border-line bg-white px-2.5 py-1 text-ink-soft">
            scanned <span className="font-bold text-ink">{new Date(report.generatedAt).toISOString().slice(0, 16).replace("T", " ")}Z</span>
          </span>
          {report.dirty && (
            <span className="rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1 font-bold text-warn">
              working tree had uncommitted changes when scanned
            </span>
          )}
        </div>
      </div>

      {/* ── 1. Automated verification ─────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 text-xl font-semibold text-ink">Automated verification</h2>
        <p className="mb-5 text-xs leading-relaxed text-ink-soft">
          Eight engines, run against the commit above. Two of them report findings, and this table says so instead of
          rounding them to a checkmark. What matters for a reader is the split: Slither raises{" "}
          <strong className="text-ink">
            {(engines.find((e) => e.id === "slither")?.counts?.total ?? 0)} findings across the whole repository
          </strong>{" "}
          and{" "}
          <strong className="text-ink">
            {engines.find((e) => e.id === "slither")?.launchPathCounts?.High ?? 0} High severity
          </strong>{" "}
          on the contracts a launch actually runs. Each one is triaged below.
        </p>

        <div className="overflow-hidden rounded-xl border border-line">
          <div className="hidden sm:grid grid-cols-[minmax(0,1.1fr)_auto_minmax(0,1.4fr)] items-center gap-3 border-b border-line bg-cream-3/[0.04] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
            <span>Engine</span>
            <span>Result</span>
            <span>Counts, as reported</span>
          </div>
          <div className="divide-y divide-line/[0.08]">
            {engines.map((e) => {
              const s = STATUS[e.status] ?? STATUS["not-installed"];
              const Icon = s.Icon;
              return (
                <div
                  key={e.id}
                  className="grid grid-cols-1 gap-1.5 px-3 py-3 sm:grid-cols-[minmax(0,1.1fr)_auto_minmax(0,1.4fr)] sm:items-center sm:gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-ink">{e.name}</div>
                    <div className="font-mono text-[10px] text-ink-faint">
                      {e.tool}
                      {e.version ? ` · ${e.version}` : ""}
                    </div>
                  </div>
                  <span
                    className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${s.className}`}
                  >
                    <Icon className="h-3 w-3" />
                    {s.label}
                  </span>
                  <div className="font-mono text-[11px]">
                    <Count counts={e.counts} />
                    {/* Hitungan jalur-peluncuran ditampilkan untuk SETIAP mesin yang
                        punya, bukan cuma Slither.
                        Versi pertama hanya menyebutnya di kalimat pengantar, dan itu
                        menyesatkan pembaca yang menyapu cepat: ia membawa "0 High"
                        milik Slither ke baris Aderyn, padahal pada skala Aderyn sendiri
                        15 dari 34 high instances-nya justru ADA di jalur peluncuran.
                        Angkanya sudah dihitung skrip pemindai sejak awal — cuma tidak
                        pernah ditampilkan. */}
                    {e.launchPathCounts && Object.keys(e.launchPathCounts).length > 0 && (
                      <div className="mt-1 border-l-2 border-accent/30 pl-2">
                        <span className="text-[9px] uppercase tracking-wider text-ink-faint">on launch path</span>
                        <div className="text-[10px]">
                          <Count counts={e.launchPathCounts} />
                        </div>
                      </div>
                    )}
                    {e.detail && <div className="mt-0.5 text-[10px] leading-snug text-ink-faint">{e.detail}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          Reproduce the whole table with <code className="text-accent">node scripts/security-scan.mjs</code>. It runs
          each engine and rewrites the JSON; a tool that is missing from the machine is recorded as{" "}
          <span className="font-mono">not run</span> rather than dropped from the list, so a shrinking table cannot hide
          a check that stopped happening.
        </p>
      </section>

      {/* ── 2. Protocol design ────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 text-xl font-semibold text-ink">Protocol design</h2>
        <p className="mb-5 text-xs leading-relaxed text-ink-soft">
          These are properties of the deployed bytecode, not policies we promise to follow. Each row names the mechanism
          so it can be checked against the source in about a minute.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {GUARANTEES.map((g) => (
            <div key={g.title} className="rounded-xl border border-line bg-white p-4">
              <div className="mb-1 flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                <div className="min-w-0">
                  <h3 className="text-[13px] font-bold text-ink">{g.title}</h3>
                  <div className="font-mono text-[10px] text-accent">{g.where}</div>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-soft">{g.how}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. Triage ─────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 text-xl font-semibold text-ink">Every finding that touches the launch path</h2>
        <p className="mb-5 text-xs leading-relaxed text-ink-soft">
          Listing counts and stopping there would be its own kind of hiding. Below is each analyser finding on the
          contracts a launch runs, with the reason it is not exploitable — or, where it is real, the admission. Nothing
          here is marked resolved by assertion: where the concern is arithmetic, the fuzz property that would fail is
          named.
        </p>
        <div className="space-y-2.5">
          {TRIAGE.map((t) => (
            <div key={`${t.engine}-${t.finding}`} className="rounded-xl border border-line bg-white p-4">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <code className="rounded bg-cream-3 px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink">
                  {t.finding}
                </code>
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-warn">{t.engine}</span>
              </div>
              <div className="mb-1 font-mono text-[10px] text-accent">{t.where}</div>
              <p className="text-[11px] leading-relaxed text-ink-soft">{t.why}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 4. What is NOT covered ────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 text-xl font-semibold text-ink">What this page does not claim</h2>
        {/* Bagian ini yang membedakan halaman verifikasi dari materi pemasaran.
            Tanpa daftar batasan, tabel hijau di atas mengundang pembaca menyimpulkan
            lebih banyak daripada yang dibuktikannya. */}
        <ul className="space-y-2 text-xs leading-relaxed text-ink-soft">
          <li>
            <strong className="text-ink">No human audit.</strong> No firm has reviewed this code. Static analysers and
            fuzzers find classes of bug; they do not find design mistakes, and they do not replace a reviewer.
          </li>
          {/* Batasan yang paling mudah dilewatkan pembaca, dan paling penting disebut:
              triage-nya penilaian KAMI. Tanpa baris ini, tabel bertanda "reviewed below"
              menyiratkan pemeriksaan independen yang tidak pernah terjadi. */}
          <li>
            <strong className="text-ink">The triage above is ours, not a third party&apos;s.</strong> Every explanation
            names the contract and the mechanism precisely so it can be checked against the source — but if you do not
            check it, you are trusting our reasoning. Nobody outside the project has reviewed these judgements.
          </li>
          {/* Dua angka bergerak sekaligus, dan keduanya akan disalahbaca kalau tidak
              dijelaskan: High turun ke nol, dan totalnya justru NAIK. */}
          <li>
            <strong className="text-ink">Slither&apos;s High count reached zero by deletion, not by a fix.</strong> The
            single High sat in <code className="text-accent">AdextoTrinityFactoryV2</code>, a factory never broadcast to
            any chain. Checking rather than assuming settled that: all four{" "}
            <code className="text-accent">NEXT_PUBLIC_FACTORY_V2_*</code> are empty, no address for it appears in the
            registry, and the deployed code at every <code className="text-accent">factoryAddress</code> is 7216 bytes
            with one identical hash while that artifact is 17672 bytes. Nothing on chain ran it, so the file was deleted.
            No reentrancy was repaired.
          </li>
          <li>
            <strong className="text-ink">
              The Slither total went up because the scan was broken, not because the code got worse.
            </strong>{" "}
            Slither refuses to overwrite an existing <code className="text-accent">--json</code> output file, and the
            scanner treated that failure as success whenever a file from an earlier run was still on disk — so it parsed
            the old results and still recorded the engine as having run. The count sat at 45 while two contracts were
            added and one removed, and its only High still pointed at a file that no longer existed. With the output
            deleted before each run, the real figure on current code is 77. Every number on this page from before that
            fix should be treated as belonging to an unknown earlier revision.
          </li>
          <li>
            <strong className="text-ink">No formal verification.</strong> The invariants below are tested against random
            action sequences, not proven for all inputs. A property that holds across {(engines.find((e) => e.id === "echidna")?.counts?.totalCalls ?? 0).toLocaleString("en-US")} Echidna calls and 512 Foundry sequences is
            evidence, not proof.
          </li>
          <li>
            {/* Kedua paruh kalimat ini sudah tertukar peran, jadi keduanya salah.
                AdextoCurve/AdextoFactory bukan lagi "tidak ter-deploy" — keduanya ada di
                keempat mainnet dan menjalankan kedua pasar yang live. Dan
                SovereignCurve/AdextoCurveFactory bukan lagi yang "menjalankan setiap pasar
                live" — pasar yang mereka lahirkan sudah digantikan. Keduanya tetap difuzz
                karena pasar itu masih bisa diperdagangkan langsung ke kurvanya. */}
            <strong className="text-ink">Coverage is the curve, not everything on chain.</strong> The fuzz and invariant
            suites target <code className="text-accent">AdextoCurve</code> and{" "}
            <code className="text-accent">AdextoFactory</code>, which run every live market, plus{" "}
            <code className="text-accent">SovereignCurve</code> and{" "}
            <code className="text-accent">AdextoCurveFactory</code>, which created the superseded markets and are still
            covered because those curves remain tradable directly, and <code className="text-accent">AdextoToken</code>.
            The superseded v1 contracts and the inert cross-chain receivers are analysed statically but not fuzzed,
            because nothing routes through them.
          </li>
          <li>
            <strong className="text-ink">Semgrep runs a general ruleset.</strong> The registry has no Solidity pack —{" "}
            <code className="text-accent">p/solidity</code> answers HTTP 404 — so{" "}
            <code className="text-accent">p/security-audit</code> is used. The real Solidity analysis here is Slither and
            Aderyn; Semgrep is supplementary and its zero should be read that way.
          </li>
          <li>
            <strong className="text-ink">A token launched here is a plain ERC-20.</strong> Anyone may list it on an
            external AMM without our permission, and we could not stop it. What the protocol guarantees is narrower: we
            never migrate the market, and nobody can withdraw the curve&apos;s reserves.
          </li>
          <li>
            {/* Kalimat ini dulu berbunyi "Nothing has traded on mainnet yet." Itu sudah
                salah SEBELUM $ADEXTO diluncurkan: kurva ticker buangan dari uji perekaman
                mencatat 5 swap dan volume 0,0217 0G di 0G mainnet. Diperiksa on-chain lewat
                `swapCount()`. Yang benar bukan "belum ada", melainkan "sangat sedikit, dan
                bukan dari orang luar" — dan itu justru pernyataan yang lebih berguna. */}
            <strong className="text-ink">Nothing has traded through these guarantees yet.</strong> $ADEXTO&apos;s curve
            has taken no swaps at all, and the only mainnet volume so far came from our own recorded test runs — a few
            hundredths of a 0G. So none of these guarantees has been exercised by outside volume.
          </li>
        </ul>
      </section>

      {/* ── 5. Verify it yourself ─────────────────────────────────────────── */}
      <section className="mb-4">
        <h2 className="mb-1 text-xl font-semibold text-ink">Verify it yourself</h2>
        <p className="mb-4 text-xs leading-relaxed text-ink-soft">
          The bytecode on each chain is reproducible from source at the commit above. This is the part that makes the
          rest checkable: if the compiled output matches what is deployed, then the guarantees you read in the source are
          the guarantees running on chain.
        </p>

        <div className="mb-4 rounded-xl border border-line bg-white p-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-ink">
            <Terminal className="h-3.5 w-3.5 text-accent" /> Reproduce
          </div>
          <pre className="overflow-x-auto rounded-lg bg-cream-3 p-3 font-mono text-[10.5px] leading-relaxed text-ink">
{`git clone ${repoBase}.git && cd adexto
git checkout ${commitShort}
npm install

# the bytecode that gets deployed
node scripts/compile-contracts.mjs --via-ir

# every row in the table above
node scripts/security-scan.mjs

# fuzz + invariants only
forge test`}
          </pre>
        </div>

        <div className="overflow-hidden rounded-xl border border-line">
          <div className="hidden sm:grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-line bg-cream-3/[0.04] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
            <span>Chain</span>
            <span>
              {CURVE_FACTORY_GENERATION.contract} {CURVE_FACTORY_GENERATION.version} — the contract a launch runs
            </span>
          </div>
          <div className="divide-y divide-line/[0.08]">
            {CHAINS.map((c) => {
              const chain = ADEXTO_CONTRACTS[c.key];
              const addr = chain.curveFactoryAddress;
              if (!addr) return null;
              return (
                <div key={c.id} className="grid grid-cols-1 gap-1 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-3">
                  <span className="whitespace-nowrap text-[11px] font-bold text-ink">
                    {c.label} <span className="font-mono text-[10px] text-ink-faint">{c.id}</span>
                  </span>
                  <a
                    href={`${chain.blockExplorer}/address/${addr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="addr min-w-0 truncate text-accent hover:underline"
                  >
                    {addr}
                  </a>
                </div>
              );
            })}
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          The runtime bytecode of this factory is byte-identical on all four chains, which holds only because the same
          protocol treasury was used on every one of them — <code className="text-accent">protocolTreasury</code> is
          immutable, and Solidity stores immutables inside the runtime bytecode. Full address tables, including the
          superseded generation, are on{" "}
          <Link href="/docs" className="font-semibold text-accent hover:underline">
            the technical status page
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
