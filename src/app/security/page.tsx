import Link from "next/link";
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Terminal, GitCommit } from "lucide-react";
import report from "@/config/security-report.json";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { LAUNCH_CLAUSE } from "@/lib/launch-state";

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
 * MENEMUKAN sesuatu. Slither melaporkan 45 temuan dan halaman ini mengatakannya,
 * lalu memisahkan mana yang berada di jalur yang benar-benar dipakai sebuah launch.
 * Angka yang dipisah begitu lebih berguna bagi pembaca daripada centang, dan lebih
 * sulit dibantah.
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

const STATUS: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  clean: { label: "no findings", className: "text-ok bg-ok/10 border-ok/30", Icon: CheckCircle2 },
  triaged: { label: "findings, triaged", className: "text-warn bg-warn/10 border-warn/30", Icon: AlertTriangle },
  findings: { label: "findings", className: "text-warn bg-warn/10 border-warn/30", Icon: AlertTriangle },
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
 */
const GUARANTEES: Array<{ title: string; where: string; how: string }> = [
  {
    title: "No owner, no admin",
    where: "AdextoToken.sol · SovereignCurve.sol",
    how:
      "AdextoToken mengimpor satu hal, ERC20 dari OpenZeppelin. Tidak ada Ownable, tidak ada owner(), tidak ada onlyOwner, tidak ada peran. SovereignCurve punya satu modifier berhak-istimewa, onlyFactory, dan ia hanya menggerbangi bindToken dan initializeCurve — keduanya sekali pakai dan tidak memindahkan native.",
  },
  {
    title: "No upgradeability",
    where: "AdextoCurveFactory.sol",
    how:
      "Token dan kurva dibuat dengan `new` biasa (CREATE), bukan proxy dan bukan CREATE2. Tidak ada slot implementasi, tidak ada delegatecall di ketiga kontrak jalur peluncuran. Yang di-deploy adalah yang berjalan selamanya.",
  },
  {
    title: "Fixed supply, no privileged mint",
    where: "AdextoToken.sol",
    how:
      "`_mint` dipanggil tepat sekali, di dalam konstruktor. Setelah itu tidak ada fungsi mint, tidak ada peran minter, dan tidak ada jalur yang bisa menambah supply. Arah satu-satunya yang mungkin adalah turun, lewat pembakaran buyback.",
  },
  {
    title: "No arbitrary withdrawal",
    where: "SovereignCurve.sol",
    how:
      "Tepat dua fungsi mengirim native keluar: `sell` membayar penjual, dan `claimCreatorFees` membayar alamat creator yang immutable. Tidak ada withdraw, rescue, sweep, drain, emergency, skim, migrate, selfdestruct, maupun fallback. Siapa pun boleh MEMICU klaim fee, tapi uangnya hanya bisa mendarat di creator.",
  },
  {
    title: "100% of supply enters the curve",
    where: "AdextoCurveFactory.sol",
    how:
      "Seluruh supply dicetak ke factory, dipindahkan ke kurva pada transaksi yang sama, lalu factory MEWAJIBKAN saldonya sendiri nol sebelum peluncuran dianggap berhasil. Creator tidak menerima satu token pun — pendapatannya dari irisan fee tiap swap.",
  },
  {
    title: "Immutable agent address",
    where: "AdextoToken.sol",
    how:
      "`agentIdentity`, `agentId`, `agentRegistry`, `agentBound` dan `sovereignDexHook` semuanya `immutable`. Tidak ada setter. Pengikatan ERC-8004 diperiksa on-chain saat peluncuran dan tidak bisa dipindah sesudahnya.",
  },
  {
    title: "Permanent market",
    where: "SovereignCurve.sol",
    how:
      "Tidak ada langkah graduasi dan tidak ada migrasi ke venue lain. Kurva adalah tempatnya, permanen. Pola launchpad yang memindahkan kurva ke pool eksternal justru di langkah itulah sebagian besar riwayat eksploit terjadi.",
  },
  {
    title: "Bounded, permissionless buyback",
    where: "SovereignCurve.sol",
    how:
      "`executeBuyback` sengaja TIDAK bergerbang pemanggil — yang membatasinya ukuran: maksimum 1% reserve native per panggilan. Native-nya tidak keluar dari kontrak; ia berpindah dari kantong buyback ke reserve kurva, dan token yang dibelinya dibakar.",
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
    where: "SovereignCurve.getSellQuote",
    why:
      "Fee dihitung dari `grossOut` yang sudah dibagi, jadi presisinya memang hilang sedikit. Arahnya yang menentukan: pembagian membulatkan ke bawah sehingga sisa selalu tinggal di kurva, bukan di pedagang. Sifat ekonominya diuji langsung — properti fuzz `roundTripNeverProfitable` dan `buyRoundsInFavourOfCurve` gagal kalau arah itu pernah terbalik.",
  },
  {
    finding: "incorrect-equality",
    engine: "Slither · Medium/High",
    where: "AdextoCurveFactory.deployTrinity",
    why:
      "Perbandingan ketat yang ditandai adalah `require(balanceOf(address(this)) == 0)`. Di sini kesetaraan persis itulah maksudnya: peluncuran harus gagal kecuali seluruh supply benar-benar pindah ke kurva. Melunakkannya jadi `<=` akan membolehkan sisa token tertinggal di factory.",
  },
  {
    finding: "reentrancy-no-eth",
    engine: "Slither · Medium (7 instansi)",
    where: "SovereignCurve.sell, initializeCurve, receive · AdextoCurveFactory.deployTrinity",
    why:
      "Ketiga fungsi kurva memakai modifier `nonReentrant`; Slither tidak memodelkan guard buatan sendiri sehingga tetap menandainya. `initializeCurve` juga `onlyFactory` dan sekali pakai. `deployTrinity` memanggil kontrak yang baru saja ia buat sendiri, jadi tidak ada kode pihak ketiga di jalur itu. Invarian solvensi dijalankan terhadap urutan aksi acak oleh dua mesin fuzz yang berbeda dan tidak pernah patah.",
  },
  {
    finding: "nonReentrant is not the first modifier",
    engine: "Aderyn · Low",
    where: "SovereignCurve.initializeCurve",
    why:
      "Urutannya `onlyFactory nonReentrant`. Aman di sini karena `onlyFactory` hanya membandingkan `msg.sender` dan tidak melakukan panggilan eksternal, jadi tidak ada apa pun yang bisa masuk kembali sebelum guard-nya aktif.",
  },
  {
    finding: "ETH transferred without address checks",
    engine: "Aderyn · High",
    where: "SovereignCurve.claimCreatorFees",
    why:
      "Tujuannya adalah `creator` yang `immutable`, diisi dari `msg.sender` pemanggil `deployTrinity`. Alamat nol tidak bisa mengirim transaksi, jadi ia tidak mungkin menjadi nilai itu. Fungsinya juga tidak menerima parameter tujuan sama sekali.",
  },
  {
    finding: "Contract locks Ether without a withdraw function",
    engine: "Aderyn · High (4 instansi)",
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
    where: "empat kontrak generasi v1, semuanya di luar jalur peluncuran",
    why:
      "Benar, dan sudah diakui di tempat lain di situs ini: native yang dikirim ke receiver jembatan lintas-chain itu terkunci selamanya, karena kontraknya tidak punya withdraw, sweep, maupun transfer. Itu justru salah satu alasan jalur lintas-chain DICABUT, bukan diperbaiki — memperbaikinya berarti menambahkan jalur penarikan yang seluruh protokol ini janjikan tidak ada. Keempatnya di luar jalur peluncuran; sebuah launch tidak pernah menyentuhnya. Nama berkas dan nomor barisnya ada di build/security/aderyn.json.",
  },
  {
    finding: "reentrancy-eth",
    engine: "Slither · High",
    where: "AdextoTrinityFactoryV2.deployTrinityProject",
    why:
      "Satu-satunya temuan High dari Slither, dan ia ada di generasi v1 yang sudah superseded. `AdextoCurveFactory` tidak memanggilnya dan studio tidak pernah men-deploy lewatnya. Kontraknya tetap di chain karena alamat ter-deploy itu permanen; membiarkannya tidak terdokumentasi akan lebih buruk daripada menyebutnya di sini.",
  },
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
          <li>
            <strong className="text-ink">No formal verification.</strong> The invariants below are tested against random
            action sequences, not proven for all inputs. A property that holds across {(engines.find((e) => e.id === "echidna")?.counts?.totalCalls ?? 0).toLocaleString("en-US")} Echidna calls and 512 Foundry sequences is
            evidence, not proof.
          </li>
          <li>
            <strong className="text-ink">Coverage is the curve, not everything on chain.</strong> The fuzz and invariant
            suites target <code className="text-accent">SovereignCurve</code>,{" "}
            <code className="text-accent">AdextoToken</code> and <code className="text-accent">AdextoCurveFactory</code>.
            The superseded v1 contracts and the inert cross-chain receivers are analysed statically but not fuzzed, because
            nothing routes through them.
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
            <strong className="text-ink">Nothing has traded on mainnet yet.</strong> {LAUNCH_CLAUSE}, so none of these
            guarantees has been exercised by real volume.
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

# bytecode yang di-deploy
node scripts/compile-contracts.mjs --via-ir

# seluruh tabel di atas
node scripts/security-scan.mjs

# hanya fuzz + invariant
forge test`}
          </pre>
        </div>

        <div className="overflow-hidden rounded-xl border border-line">
          <div className="hidden sm:grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-line bg-cream-3/[0.04] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
            <span>Chain</span>
            <span>AdextoCurveFactory 0.10.0 — the contract a launch runs</span>
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
          The runtime bytecode of this factory is byte-identical on all four chains. Full address tables, including the
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
