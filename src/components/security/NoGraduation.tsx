/**
 * "Why there is no graduation step" — kurva permanen dibandingkan model yang memindahkan reserve
 * ke pool luar, dengan yang DIHAPUS dan yang TETAP berisiko.
 *
 * Bagian "tetap berisiko" bukan hiasan kerendahan hati: tanpa itu tabel di atasnya terbaca
 * sebagai klaim bahwa risikonya nol, dan halaman ini justru dibuat untuk mencegah kelas klaim
 * itu. Setiap baris hanya menyatakan hal yang bisa diperiksa di kontrak atau di checklist bawah.
 * Teks yang dirender WAJIB bahasa Inggris.
 */

const ROWS: Array<{ topic: string; graduating: string; adexto: string }> = [
  {
    topic: "When the curve fills",
    graduating: "Trading on the curve stops and its reserves migrate into an external liquidity pool.",
    adexto: "Nothing happens. There is no threshold and no migration function, so the curve keeps quoting.",
  },
  {
    topic: "Value in motion at once",
    graduating: "The migration moves the whole reserve in one transaction: the single moment with the most value at stake.",
    adexto: "No such transaction exists.",
  },
  {
    topic: "Liquidity tokens",
    graduating: "LP tokens for the new pool have to be burned or locked, and holders rely on that having been done correctly.",
    adexto:
      "There are none. The reserve is the curve's own balance, and native leaves it only as a seller's payout or as fee claims to immutable addresses.",
  },
  {
    topic: "Who executes it",
    graduating: "A migrator contract or an operator key.",
    adexto: "Nobody. The factory and the curve have no owner — the checklist below shows how to confirm that yourself.",
  },
];

const STILL_RISKY: Array<{ title: string; body: string }> = [
  {
    title: "Other pools can exist.",
    body: "The token is a plain ERC-20. Anyone can open a pool for it on another venue, and the price there can drift away from the curve.",
  },
  {
    title: "The curve has price impact.",
    body: "A large sell moves the price down the curve, and sellers are paid from the reserve in the order they sell.",
  },
  {
    title: "A live market cannot be patched.",
    body: "The bytecode is frozen and has no owner, so a bug found later can only be fixed for markets launched after the fix.",
  },
  {
    title: "No firm has audited the contracts.",
    body: "The checks on this page are automated analysers, fuzzers and our own triage. They are evidence, not an audit.",
  },
  {
    title: "Fees depend on the factory that created the market.",
    body: "Every rate is fixed at launch and differs between factory generations. Read totalFeeBps on the curve itself rather than a number from a web page.",
  },
];

export default function NoGraduation() {
  return (
    <section className="mb-12" id="no-graduation">
      <h2 className="mb-1 text-xl font-semibold text-ink">Why there is no graduation step</h2>
      <p className="mb-5 text-xs leading-relaxed text-ink-soft">
        Most launchpads run a bonding curve only until a threshold, then move its reserves into an external liquidity
        pool. Here the curve is the market for as long as the token exists. That is a security decision rather than a
        missing feature: it removes the step where the most value moves at once. It does not remove every risk, and the
        list under the table says which ones remain.
      </p>

      <div className="overflow-hidden rounded-xl border border-line">
        <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,1.3fr)] gap-3 border-b border-line bg-cream-3/[0.04] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint sm:grid">
          <span />
          <span>Curve that graduates</span>
          <span>ADEXTO curve</span>
        </div>
        <div className="divide-y divide-line/[0.08]">
          {ROWS.map((r) => (
            <div
              key={r.topic}
              className="grid grid-cols-1 gap-1.5 px-3 py-3 text-xs leading-relaxed sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,1.3fr)] sm:gap-3"
            >
              <span className="font-bold text-ink">{r.topic}</span>
              <span className="text-ink-soft">
                <span className="font-semibold text-ink-faint sm:hidden">Curve that graduates: </span>
                {r.graduating}
              </span>
              <span className="text-ink">
                <span className="font-semibold text-accent sm:hidden">ADEXTO: </span>
                {r.adexto}
              </span>
            </div>
          ))}
        </div>
      </div>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">What stays risky</h3>
      <ul className="space-y-1.5 text-xs leading-relaxed text-ink-soft">
        {STILL_RISKY.map((r) => (
          <li key={r.title}>
            <strong className="text-ink">{r.title}</strong> {r.body}
          </li>
        ))}
      </ul>
    </section>
  );
}
