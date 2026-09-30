import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Terminal, GitCommit, FileSearch } from "lucide-react";
import report from "@/config/security-report.json";
import deployments from "@/config/factory-deployments.json";
import NoGraduation from "@/components/security/NoGraduation";
import VerifyChecklist from "@/components/security/VerifyChecklist";


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
    where: "AdextoToken.sol · AdextoCurve.sol · AdextoFactory.sol",
    how:
      "AdextoToken imports exactly one thing: OpenZeppelin's ERC20. No Ownable, no owner(), no onlyOwner, no roles. The curve has a single privileged modifier, onlyFactory, and it gates only bindToken and initializeCurve — both one-shot, and neither moves native. The protocol fee leg has no setter, so the curve stays ownerless. The same holds for the 0.11.0 curves behind the six earlier markets.",
  },
  {
    title: "No upgradeability",
    where: "AdextoFactory.sol",
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
    where: "AdextoCurve.sol",
    how:
      "Exactly three functions send native out: `sell` pays the seller, `claimCreatorFees` pays the immutable creator, and `claimProtocolFees` pays the immutable protocol treasury. There is no withdraw, rescue, sweep, drain, emergency, skim, migrate, selfdestruct or fallback, in v1 or in the 0.11.0 curves. Anyone may trigger either claim, and that is safe precisely because both destinations are immutable — a caller cannot redirect the money, only push it where it was always going.",
  },
  {
    title: "100% of supply enters the curve",
    where: "AdextoFactory.sol",
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
    title: "A launch window that ends by itself",
    where: "AdextoToken.sol",
    how:
      "For 180 seconds after launch, no wallet may hold more than 1% of supply, so one address cannot take the opening of a market. The limit is on the receiving wallet's balance, not on a single transfer, so splitting a buy into many transactions does not get around it. It is measured in seconds rather than blocks because block times differ by chain. Three recipients are exempt: the curve (so holders can sell), address(0) (so buyback burns work) and the factory (which seeds the curve). There is no switch to extend it or turn it off.",
  },
  {
    title: "Permanent market",
    where: "AdextoCurve.sol",
    how:
      "There is no graduation step and no migration to another venue. The curve is the market, permanently. The usual launchpad pattern moves a curve into an external pool, and that step is where much of the historical exploit surface lives.",
  },
  /**
   * KLAIM INI DIPERSEMPIT SETELAH SEBUAH LAPORAN.
   *
   * Isinya dulu: "what restrains it is size: at most 1% of the native reserve per call" —
   * dan berhenti di situ, sehingga terbaca sebagai batas atas total. Sebuah laporan
   * (GHSA-g589-wjqq-86f2, temuan 1) menunjukkan plafon per panggilan tidak membatasi
   * BERAPA KALI satu transaksi memanggilnya, dan karena tiap panggilan menaikkan reserve,
   * plafon 1% itu ikut naik selama loop berjalan. Terukur: 101,32 native keluar dalam 3
   * panggilan.
   *
   * Cooldown sudah ditambahkan di `contracts/AdextoCurve.sol`, tetapi kalimat di sini tidak
   * boleh menyiratkan pasar yang SUDAH hidup ikut terlindungi: bytecode-nya beku dan tanpa
   * pemilik, jadi tidak ada jalur upgrade. Itulah sebabnya kartu ini sekarang menyebut
   * keduanya secara terpisah, bukan satu klaim yang berlaku untuk semuanya.
   */
  {
    title: "Bounded, permissionless buyback",
    where: "AdextoCurve.sol",
    how:
      "`executeBuyback` deliberately has no caller gate. The native never leaves the contract; it moves from the buyback bucket into the curve reserve, and the tokens it buys are burned. Nothing calls it on a schedule: anyone may, and our x402 gateway does after a delivery once the bucket covers three times the gas. Every v1 curve carries two limits: at most 1% of the native reserve per call, and a one-hour cooldown between calls. The cooldown was added after a report showed the per-call cap alone did not stop a single transaction from looping until the bucket was empty. The six 0.11.0 markets carry only the per-call cap, because their bytecode is frozen and has no owner.",
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
     * Diperiksa di build/security/slither.json, bukan diasumsikan: 3 instance di
     * SovereignCurve.sol dan 4 di AdextoCurve.sol (pemindaian 2026-09-30; dulu 9 dan 12
     * sebelum kontrak v1 dan harness lain dikeluarkan dari tree). Menyebut hanya yang lama akan
     * membuat tabel ini terlihat tidak mencakup kontrak yang justru sedang hidup —
     * bentuk penyembunyian yang paling tidak disengaja dan paling mudah terjadi
     * setiap kali ada generasi baru.
     */
    where: "AdextoCurve.getSellQuote (4 instances)",
    why:
      "Fees are computed from `grossOut`, which is itself the result of a division, so a little precision is genuinely lost. The direction is what settles it: the division floors, so the remainder always stays with the curve rather than the trader. The economic consequence is tested directly — the fuzz properties `roundTripNeverProfitable` and `buyRoundsInFavourOfCurve` fail if that direction ever inverts.",
  },
  {
    finding: "incorrect-equality",
    engine: "Slither · Medium",
    where: "AdextoFactory.deployTrinity",
    why:
      "The strict comparison being flagged is `require(balanceOf(address(this)) == 0)`. Exact equality is the point here: the launch must fail unless the entire supply actually moved into the curve. Relaxing it to `<=` would permit leftover tokens to sit in the factory.",
  },
  /**
   * Disegarkan 2026-09-30 terhadap pemindaian yang sedang diterbitkan, dan dicocokkan dengan
   * slither.json/aderyn.json yang dijalankan ulang pada tree ini. Tiga baris lama dicabut karena
   * TIDAK ADA lagi di keluaran mesin mana pun: "nonReentrant is not the first modifier" (Aderyn
   * Low), "ETH transferred without address checks" (Aderyn High), dan "Contract locks Ether
   * without a withdraw function" (Aderyn High, empat kontrak v1 yang sudah dihapus dari tree).
   * Pengakuan soal receiver v1 yang mengunci native tetap ada di audit/README.md. Tabel ini
   * mengikuti keluaran mesin, bukan kebalikannya.
   */
  {
    finding: "reentrancy-no-eth",
    engine: "Slither · Medium (2 instances)",
    where: "AdextoCurve.sell and receive",
    why:
      "`sell` carries the `nonReentrant` modifier and `receive` takes the same `_locked` guard inline; Slither does not model a hand-written guard, so it flags them anyway. The only external callee on those paths is the market's own token, whose `_update` calls nothing external: it adds one balance comparison during the launch window and otherwise defers to the standard ERC-20 update. The solvency invariant — which includes `protocolOwed` as a term — was driven against random action sequences by two different fuzzing engines, Foundry and Echidna, and never broke.",
  },
  {
    finding: "Reentrancy: state change after external call",
    engine: "Aderyn · High (4 instances)",
    where: "AdextoCurve.sell (3) · AdextoFactory.deployTrinity (1)",
    why:
      "In `sell`, the external calls are `balanceOf`, `allowance` and `transferFrom` on the market's own token, under the same guard as the row above. In `deployTrinity`, the call is `ownerOf` on the ERC-8004 Identity Registry, made only when a launch binds an agent. That registry is an upgradeable contract run by a third party, but the interface declares `ownerOf` as `view`, so it is compiled to STATICCALL: any state change, event or value transfer inside it reverts, and it cannot re-enter `deployTrinity`. What a hostile registry could still do is make a binding launch revert or report the wrong owner; that question is listed for reviewers in the audit scope.",
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
  /**
   * Temuan Low dan Informational di jalur peluncuran v1 (pemindaian 2b16426: 6 Low, 4
   * Informational). Ditulis di sini supaya judul bagian "every finding that touches the launch
   * path" benar untuk SEMUA tingkat, bukan hanya Medium ke atas. Sama dengan tabel triage di
   * audit/README.md.
   */
  {
    finding: "timestamp",
    engine: "Slither · Low",
    where: "AdextoToken._update · AdextoCurve.executeBuyback",
    why:
      "The launch window (180 s) and the buyback cooldown (1 h) are measured in seconds on purpose. A block producer can shift `block.timestamp` by seconds, which moves the edge of a window by the same seconds and nothing more.",
  },
  {
    finding: "reentrancy-events / reentrancy-benign",
    engine: "Slither · Low (3 instances)",
    where: "AdextoCurve._buy and sell · AdextoFactory.deployTrinity",
    why:
      "Events are emitted after the external calls to the token, which calls nothing back. The curve functions are `nonReentrant`, and `deployTrinity` writes the ticker before its calls, so a re-entrant launch of the same ticker fails.",
  },
  {
    finding: "missing-zero-check",
    engine: "Slither · Low (2 instances)",
    where: "AdextoCurve.sell recipient",
    why:
      "`to == address(0)` is replaced by `msg.sender` on the line that sets the recipient, so a zero recipient can never be paid.",
  },
  {
    finding: "low-level-calls · missing-inheritance",
    engine: "Slither · Informational (4 instances)",
    where: "AdextoCurve.sell, claimCreatorFees, claimProtocolFees · AdextoToken",
    why:
      "The three native payouts use `call` and each checks the returned `success`; both claim destinations are immutable. `AdextoToken` does not formally inherit the one-function burn interface the curve declares locally, which names exactly what the curve calls.",
  },
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
  /** Commit yang contracts/-nya sama dengan yang dipindai DAN yang di-deploy. Lihat factory-deployments.json. */
  const sourceShort = deployments.sourceCommit.slice(0, 12);
  const repoBase = "https://github.com/0xcuy/adexto";

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      {/* Header */}
      <div className="border-b-2 border-line pb-6 mb-10">
        <div className="kicker mb-3">SECURITY</div>
        <h1 className="font-display text-3xl font-light tracking-tight text-ink sm:text-4xl">
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
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-ink-soft">
            <GitCommit className="h-3.5 w-3.5 text-accent" />
            commit <a href={`${repoBase}/commit/${report.commit}`} className="font-bold text-accent hover:underline">{commitShort}</a>
          </span>
          <span className="rounded-lg border border-line bg-surface px-2.5 py-1 text-ink-soft">
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
            <div key={g.title} className="rounded-xl border border-line bg-surface p-4">
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

      {/* ── 2b. Kenapa tidak ada graduation ──────────────────────────────────
          Memperluas kartu "Permanent market" di atas: apa yang dihapus desain ini,
          dan daftar yang TETAP berisiko supaya tabelnya tidak terbaca sebagai nol risiko. */}
      <NoGraduation />

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
            <div key={`${t.engine}-${t.finding}`} className="rounded-xl border border-line bg-surface p-4">
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
          {/* Dua catatan lama dicabut (2026-10-01): "High turun ke nol karena penghapusan" dan
              "total naik karena pemindai rusak". Keduanya menjelaskan pergerakan angka pemindaian
              LAMA atas tree yang masih memuat kontrak pra-rilis. Pemindaian yang diterbitkan kini
              berjalan pada checkout bersih yang hanya memuat sumber v1, jadi angkanya tidak bisa
              dibandingkan dengan yang lama — dan itu yang dinyatakan di bawah. */}
          <li>
            <strong className="text-ink">The numbers describe ADEXTO v1 only.</strong> The scan runs on a clean checkout
            whose <code className="text-accent">contracts/</code> folder holds the v1 sources and nothing else, so its
            counts are not comparable with scans published before v1, which covered pre-release contracts that are no
            longer in the tree. The 0.11.0 contracts behind the six earlier markets were compiled from commit{" "}
            <code className="text-accent">98ffb1c</code>; they are not part of this scan.
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
            <strong className="text-ink">Coverage is the v1 source, not everything on chain.</strong> The fuzz and
            invariant suites target <code className="text-accent">AdextoCurve</code>,{" "}
            <code className="text-accent">AdextoFactory</code> and <code className="text-accent">AdextoToken</code>,
            including the launch window, plus <code className="text-accent">AdextoAgentStake</code>. The 0.11.0 curves
            share the curve design but not the launch window or the buyback cooldown, and are not fuzzed from this tree.
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
                bukan dari orang luar" — dan itu justru pernyataan yang lebih berguna.

                Revisi kedua (2026-09-30) juga sudah basi: "$ADEXTO's curve has taken no swaps at
                all" salah — `swapCount()` kurva $ADEXTO 27, volume ~1,18 0G. Diperiksa lewat
                indeks pasar: dari 56 fill di enam pasar terdaftar, 55 dibuat atau diterima
                deployer (uji sendiri dan pengiriman x402 lewat relayer kami); satu pengiriman
                x402 ke alamat lain. Karena itu kalimatnya tanpa angka: angka di halaman statis
                ini akan basi lagi, sedangkan "hampir semuanya milik kami" tetap bisa diperiksa. */}
            <strong className="text-ink">Almost nothing has traded through these guarantees from outside.</strong>{" "}
            Nearly every fill on the listed markets so far is ours: the deployer&apos;s own test trades, and x402 deliveries
            through our relayer to the deployer&apos;s address. So these guarantees have barely been exercised by anyone
            else.
          </li>
        </ul>
      </section>

      {/* ── 5. Verify it yourself ─────────────────────────────────────────── */}
      <section className="mb-4" id="verify">
        <h2 className="mb-1 text-xl font-semibold text-ink">Verify it yourself</h2>
        <p className="mb-4 text-xs leading-relaxed text-ink-soft">
          The factory bytecode on each chain can be rebuilt from the published source at commit{" "}
          <code className="text-accent">{sourceShort}</code>, and step 5 below compares the two. That is the part that
          makes the rest checkable: if the compiled output matches what is deployed, then the guarantees you read in the
          source are the guarantees running on chain.
        </p>

        <div className="mb-4 rounded-xl border border-line bg-surface p-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-ink">
            <Terminal className="h-3.5 w-3.5 text-accent" /> Reproduce
          </div>
          <pre className="overflow-x-auto rounded-lg bg-cream-3 p-3 font-mono text-[10.5px] leading-relaxed text-ink">
{`git clone ${repoBase}.git && cd adexto
git checkout ${sourceShort}
npm install

# the bytecode that gets deployed
node scripts/compile-contracts.mjs --via-ir

# every row in the table above
node scripts/security-scan.mjs

# fuzz + invariants only
forge test`}
          </pre>
          {/* Dua kasus, dipilih oleh `report.dirty`. Laporan lama berjalan di working tree kotor di
              atas fa4200b, jadi yang harus di-checkout adalah sourceCommit (contractHashes cocok
              8/8), bukan commit di header. Sejak laporan 2026-09-30 pemindaian berjalan di checkout
              bersih, dan kedelapan berkas kontraknya identik dengan sourceCommit. */}
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            {report.dirty ? (
              <>
                The scan ran on a working tree with uncommitted changes, as the header says. Its{" "}
                <code className="text-accent">contracts/</code> folder matches commit{" "}
                <code className="text-accent">{sourceShort}</code> file for file (the report records a sha256 for each
                contract file), so that is the commit to check out rather than{" "}
                <code className="text-accent">{commitShort}</code>.
              </>
            ) : (
              <>
                The scan ran on a clean checkout of <code className="text-accent">{commitShort}</code>. Its contract
                files are identical to <code className="text-accent">{sourceShort}</code>, the commit the deployed
                factory was compiled from (the report records a sha256 for each), so checking out{" "}
                <code className="text-accent">{sourceShort}</code> rebuilds the deployed bytecode and the scanned
                source at once.
              </>
            )}
          </p>
        </div>

        <VerifyChecklist />
      </section>
    </div>
  );
}
