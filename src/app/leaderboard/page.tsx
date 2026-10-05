import type { Metadata } from "next";
import Link from "next/link";
import { Flame, Rocket, Crown, Bot, Trophy, Megaphone } from "lucide-react";
import AgentScoreBadge from "@/components/agents/AgentScoreBadge";
import { getLeaderboard, type ContestEntry, type LeaderboardMarket } from "@/lib/leaderboard";
import { LAUNCH_CHAIN_COUNT_WORD, chainFromId, chainMark } from "@/lib/chains";
import { formatUsd } from "@/lib/pricing";
import { CONTEST_TERMS } from "@/config/growth-programs";

/**
 * `/leaderboard` (P2.4): dirender server dari `getLeaderboard()`, satu hitungan per menit.
 *
 * Semua peringkat memakai definisi di `src/lib/leaderboard.ts`: wallet tim dan creator pasar tidak
 * pernah dihitung sebagai pembeli, dan trending diurutkan dari pembeli unik, bukan volume. Hadiah
 * kontes hanya disebut setelah owner mengonfirmasinya (`CONTEST_TERMS.confirmed`).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboard · ADEXTO",
  description: `ADEXTO markets ranked by unique buyers in the last 24 hours, newest launches, top creators and agent-bound markets, across ${LAUNCH_CHAIN_COUNT_WORD} chains.`,
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function ago(t: number | null, now: number): string {
  if (!t) return "—";
  const s = Math.max(0, now - t);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function until(t: number, now: number): string {
  const s = Math.max(0, t - now);
  if (s < 3600) return `${Math.ceil(s / 60)}m left`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h left`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h left`;
}

const marketHref = (m: { slug: string; chainId: number }) => `/token/${encodeURIComponent(m.slug)}?chain=${m.chainId}`;

function ChainChip({ chainId, name }: { chainId: number; name: string }) {
  const chain = chainFromId(chainId);
  const mark = chain ? chainMark(chain) : null;
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-soft">
      {/* eslint-disable-next-line @next/next/no-img-element -- logo chain statis kecil */}
      {mark ? <img src={mark} alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" /> : null}
      {name.replace(/\s+Mainnet$/i, "")}
    </span>
  );
}

function MarketCell({ m }: { m: { slug: string; chainId: number; symbol: string; image: string; name?: string } }) {
  return (
    <Link href={marketHref(m)} className="flex min-w-0 items-center gap-2.5 hover:text-accent max-lg:min-h-[40px]">
      {/* eslint-disable-next-line @next/next/no-img-element -- logo token dari registry */}
      <img src={m.image} alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-lg border border-line object-cover" />
      <span className="min-w-0">
        <span className="block font-semibold text-ink">${m.symbol}</span>
        {m.name ? <span className="block truncate text-[12px] text-ink-faint">{m.name}</span> : null}
      </span>
    </Link>
  );
}

function Section({ icon, title, note, children, id }: { icon: React.ReactNode; title: string; note?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="glass-panel scroll-mt-24 overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-panel)]">
      <div className="flex flex-col gap-1 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="flex items-center gap-2 text-[13px]/snug font-semibold text-ink">
          {icon} {title}
        </h2>
        {note ? <p className="text-[12px] text-ink-faint">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

const th = "px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint";
const td = "px-4 py-2.5 align-middle";

/**
 * Ponsel (< 640 px, U2.4): setiap tabel di halaman ini juga dirender sebagai daftar kartu, dan tabelnya baru tampil
 * mulai 640 px. Tabel delapan kolom di 320–412 px dulu hanya bisa digeser ke samping, dan tabel empat kolom memeras
 * nama pasar. Halaman ini dirender server tanpa state, jadi dua bentuk ini hanya HTML; yang tersembunyi
 * `display: none`, jadi juga tidak dibaca pembaca layar. Pengecualian: pasar ber-agent memakai satu daftar grid
 * untuk semua lebar, karena `AgentScoreBadge` mengambil skornya sendiri dan dua salinan berarti dua permintaan.
 */
function PhoneList({ children }: { children: React.ReactNode }) {
  return <ol className="divide-y divide-line sm:hidden">{children}</ol>;
}

function PhoneRow({
  rank,
  main,
  meta,
  value,
  valueLabel,
}: {
  rank?: number;
  main: React.ReactNode;
  meta?: React.ReactNode;
  value: React.ReactNode;
  valueLabel: string;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-[12px]/snug">
      {rank !== undefined ? (
        <span className="w-4 shrink-0 text-[12px] text-ink-faint" data-numeric>
          {rank}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {main}
        {meta ? <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-ink-soft">{meta}</div> : null}
      </div>
      <div className="shrink-0 text-right">
        <span className="block text-[14px] font-semibold text-ink" data-numeric>
          {value}
        </span>
        <span className="block text-[12px] text-ink-faint">{valueLabel}</span>
      </div>
    </li>
  );
}

function usd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v === 0) return "$0";
  return formatUsd(v, { compact: v >= 1000 });
}

export default async function LeaderboardPage() {
  let data;
  try {
    data = await getLeaderboard();
  } catch {
    data = null;
  }
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <p className="kicker mb-2">Leaderboard</p>
        <h1 className="font-display text-[28px] font-light leading-[1.1] tracking-tight text-ink sm:text-[36px]">Who is actually buying</h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-ink-soft">
          Markets ranked by unique buyers, not volume: one wallet buying a hundred times still counts once. ADEXTO team
          wallets and each market&apos;s own creator never count as buyers. Read from every swap on chain, across five
          chains.{" "}
          <Link href="/rewards" className="whitespace-nowrap font-semibold text-accent hover:underline">
            Refer traders →
          </Link>
        </p>
      </div>

      {!data ? (
        <p className="rounded-card border border-line bg-surface p-4 text-[13px]/snug text-ink-soft">The leaderboard could not be computed right now. Try again in a minute.</p>
      ) : (
        <>
          {data.promoted.length > 0 && (
            <Section icon={<Megaphone className="h-4 w-4 text-warn" aria-hidden />} title="Promoted" note="Paid placement for 24 hours. Not a ranking or an endorsement.">
              <ul
                className={`grid grid-cols-1 gap-px bg-line ${
                  data.promoted.length >= 3 ? "sm:grid-cols-3" : data.promoted.length === 2 ? "sm:grid-cols-2" : ""
                }`}
              >
                {data.promoted.map((m) => (
                  <li key={`${m.chainId}-${m.token}`} className="flex items-center justify-between gap-3 bg-surface px-4 py-3">
                    <MarketCell m={m} />
                    <span className="flex flex-col items-end gap-1 text-[12px]">
                      <span className="rounded-md border border-warn/40 bg-warn/10 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-warn">Promoted</span>
                      <ChainChip chainId={m.chainId} name={m.chainName} />
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            id="trending"
            icon={<Flame className="h-4 w-4 text-accent" aria-hidden />}
            title="Trending"
            note="Ranked by unique buyers in the last 24 hours, then by volume."
          >
            <TrendingTable rows={data.trending} now={now} />
          </Section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section id="newest" icon={<Rocket className="h-4 w-4 text-accent" aria-hidden />} title="Newest launches">
              <PhoneList>
                {data.newest.map((m) => (
                  <PhoneRow
                    key={`${m.chainId}-${m.token}`}
                    main={<MarketCell m={m} />}
                    meta={
                      <>
                        <ChainChip chainId={m.chainId} name={m.chainName} />
                        <span>launched {ago(m.deployedAt, now)}</span>
                      </>
                    }
                    value={m.buyers24h}
                    valueLabel="buyers 24h"
                  />
                ))}
              </PhoneList>
              <table className="hidden w-full text-left text-[12px]/snug sm:table">
                <thead>
                  <tr>
                    <th className={th}>Market</th>
                    <th className={th}>Chain</th>
                    <th className={th}>Launched</th>
                    <th className={`${th} text-right`}>Buyers 24h</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.newest.map((m) => (
                    <tr key={`${m.chainId}-${m.token}`}>
                      <td className={td}>
                        <MarketCell m={m} />
                      </td>
                      <td className={td}>
                        <ChainChip chainId={m.chainId} name={m.chainName} />
                      </td>
                      <td className={`${td} text-ink-soft`}>{ago(m.deployedAt, now)}</td>
                      <td className={`${td} text-right font-semibold text-ink`} data-numeric>
                        {m.buyers24h}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section id="creators" icon={<Crown className="h-4 w-4 text-accent" aria-hidden />} title="Top creators" note="Creator fees earned, paid plus unclaimed, read from each curve.">
              <PhoneList>
                {data.creators.map((c) => (
                  <PhoneRow
                    key={c.address}
                    main={
                      <span className="flex flex-wrap items-center gap-x-2">
                        <Link href={`/creator?address=${c.address}`} className="inline-flex min-h-[40px] items-center font-mono text-ink hover:text-accent">
                          {short(c.address)}
                        </Link>
                        {c.isTeam && (
                          <span className="rounded border border-line px-1 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">ADEXTO team</span>
                        )}
                      </span>
                    }
                    meta={
                      <span className="min-w-0">
                        {c.markets} · {c.symbols.map((s) => `$${s}`).join(" ")}
                      </span>
                    }
                    value={usd(c.revenueUsd)}
                    valueLabel="earned"
                  />
                ))}
              </PhoneList>
              <table className="hidden w-full text-left text-[12px]/snug sm:table">
                <thead>
                  <tr>
                    <th className={th}>Creator</th>
                    <th className={th}>Markets</th>
                    <th className={`${th} text-right`}>Earned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.creators.map((c) => (
                    <tr key={c.address}>
                      <td className={td}>
                        <Link
                          href={`/creator?address=${c.address}`}
                          className="inline-flex items-center whitespace-nowrap font-mono text-ink hover:text-accent max-lg:min-h-[40px]"
                        >
                          {short(c.address)}
                        </Link>
                        {c.isTeam && (
                          <span className="ml-2 rounded border border-line px-1 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">ADEXTO team</span>
                        )}
                      </td>
                      <td className={`${td} text-ink-soft`}>
                        {c.markets} · {c.symbols.map((s) => `$${s}`).join(" ")}
                      </td>
                      <td className={`${td} text-right font-semibold text-ink`} data-numeric>
                        {usd(c.revenueUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </div>

          <Section
            id="agents"
            icon={<Bot className="h-4 w-4 text-accent" aria-hidden />}
            title="Agent-bound markets"
            note="Tokens bound at launch to an ERC-8004 agent identity."
          >
            {data.agentBound.length === 0 ? (
              <p className="px-4 py-4 text-[12px]/snug text-ink-soft">No market is bound to an agent identity yet.</p>
            ) : (
              /* Satu daftar grid untuk semua lebar (lihat catatan PhoneList): di ponsel kartu dua baris, mulai 640 px
                 empat kolom dengan kepala kolom seperti tabel sebelumnya. Skor tetap dari AgentScoreBadge (UI-1). */
              <div className="text-[12px]/snug">
                <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)] border-b border-line sm:grid" aria-hidden="true">
                  <span className={th}>Market</span>
                  <span className={th}>Chain</span>
                  <span className={th}>Agent Score</span>
                  <span className={`${th} text-right`}>Buyers 24h</span>
                </div>
                <ul className="divide-y divide-line">
                  {data.agentBound.map((m) => (
                    <li
                      key={`${m.chainId}-${m.token}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)] sm:gap-x-0 sm:px-0"
                    >
                      <div className="min-w-0 sm:px-4">
                        <MarketCell m={m} />
                      </div>
                      <div className="text-right font-semibold text-ink sm:order-last sm:px-4" data-numeric>
                        {m.buyers24h}
                        <span className="block text-[12px] font-normal text-ink-faint sm:hidden">buyers 24h</span>
                      </div>
                      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] sm:contents">
                        <span className="sm:px-4">
                          <ChainChip chainId={m.chainId} name={m.chainName} />
                        </span>
                        <span className="sm:px-4">
                          {/* 32 px di bawah lg lewat prop `className` milik komponennya (tanpa mengedit berkas UI-1):
                              pil 23 px ini dinilai rapat oleh audit saat lewat di dekat tab bar bawah (ERROR tap<24
                              di 320–393 px). */}
                          <AgentScoreBadge chainId={m.chainId} token={m.token} className="max-lg:min-h-[32px]" />
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="border-t border-line px-4 py-2 text-[12px] text-ink-faint">
              The full agent directory is on{" "}
              <Link href="/agents/markets" className="font-semibold text-accent hover:underline">
                Agent markets
              </Link>
              .
            </p>
          </Section>

          <Section
            id="contest"
            icon={<Trophy className="h-4 w-4 text-accent" aria-hidden />}
            title={CONTEST_TERMS.confirmed ? "Weekly launch contest" : "Launch of the week"}
            note={`Week of ${data.contest.week} (UTC) · ${until(data.contest.weekEndsAt, now)}`}
          >
            <div className="space-y-1 px-4 py-3 text-[12px] leading-relaxed text-ink-soft">
              <p>
                Every launch made this week is scored on its net unique buyers in its first {CONTEST_TERMS.scoringWindowHours}{" "}
                hours: wallets that bought more of the token than they sold in that window. The creator and ADEXTO team
                wallets never count, and launches by ADEXTO team wallets are not eligible.
              </p>
              {CONTEST_TERMS.confirmed && (
                <p className="font-semibold text-ink">
                  Prize: ${CONTEST_TERMS.prizeUsdMin}–{CONTEST_TERMS.prizeUsdMax} in USDC each week for {CONTEST_TERMS.weeks} weeks, sent from the
                  ADEXTO treasury to the winning creator.
                </p>
              )}
            </div>
            <ContestTable entries={data.contest.entries} now={now} empty="No eligible launch this week yet." />
            {data.contest.previous.length > 0 && (
              <>
                <p className="border-t border-line px-4 pt-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                  Week of {data.contest.previousWeek}
                </p>
                <ContestTable entries={data.contest.previous.slice(0, 3)} now={now} empty="" />
              </>
            )}
            {/* Tautan berdiri sendiri (bukan di dalam kalimat), jadi di bawah lg ia butuh area ketuk sendiri: dulu
                setinggi teks (14 px) dan rapat dengan baris kontes di atasnya, ERROR tap<24 di 320 px. */}
            <p className="border-t border-line px-4 py-1 text-[12px] text-ink-soft lg:py-2">
              <Link href="/studio" className="inline-flex min-h-[40px] items-center font-semibold text-accent hover:underline lg:min-h-0">
                Launch in the Studio →
              </Link>
            </p>
          </Section>

          <p className="text-[12px] leading-relaxed text-ink-faint">
            Computed {ago(data.computedAt, now)} from each market&apos;s swap index. A market marked “indexing” has not been scanned up
            to the chain head yet, so its numbers can only rise. USD values use the current native price.
          </p>
        </>
      )}
    </div>
  );
}

function TrendingTable({ rows, now }: { rows: LeaderboardMarket[]; now: number }) {
  return (
    <>
    <PhoneList>
      {rows.map((m, i) => (
        <PhoneRow
          key={`${m.chainId}-${m.token}`}
          rank={i + 1}
          main={<MarketCell m={m} />}
          meta={
            <>
              <ChainChip chainId={m.chainId} name={m.chainName} />
              <span data-numeric>
                {m.trades24h} trade{m.trades24h === 1 ? "" : "s"} · {usd(m.volume24hUsd)}
              </span>
              <span className="text-ink-faint">{ago(m.lastTradeAt, now)}</span>
            </>
          }
          value={
            <>
              {m.buyers24h}
              {m.partial && <span className="ml-1 text-[12px] font-normal text-ink-faint">indexing</span>}
            </>
          }
          valueLabel="buyers 24h"
        />
      ))}
    </PhoneList>
    <div className="hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[720px] text-left text-[12px]/snug">
        <thead>
          <tr>
            <th className={th}>#</th>
            <th className={th}>Market</th>
            <th className={th}>Chain</th>
            <th className={`${th} text-right`}>Buyers 24h</th>
            <th className={`${th} text-right`}>Trades 24h</th>
            <th className={`${th} text-right`}>Volume 24h</th>
            <th className={`${th} text-right`}>Price</th>
            <th className={`${th} text-right`}>Last trade</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((m, i) => (
            <tr key={`${m.chainId}-${m.token}`}>
              <td className={`${td} text-ink-faint`}>{i + 1}</td>
              <td className={td}>
                <MarketCell m={m} />
              </td>
              <td className={td}>
                <ChainChip chainId={m.chainId} name={m.chainName} />
              </td>
              <td className={`${td} text-right text-[14px] font-semibold text-ink`} data-numeric>
                {m.buyers24h}
                {m.partial && <span className="ml-1 text-[12px] font-normal text-ink-faint">indexing</span>}
              </td>
              <td className={`${td} text-right text-ink-soft`} data-numeric>
                {m.trades24h}
              </td>
              <td className={`${td} text-right text-ink-soft`} data-numeric>
                {usd(m.volume24hUsd)}
              </td>
              <td className={`${td} text-right text-ink-soft`} data-numeric>
                {m.priceUsd !== null ? formatUsd(m.priceUsd) : "—"}
              </td>
              <td className={`${td} text-right text-ink-faint`}>{ago(m.lastTradeAt, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {rows.every((m) => m.buyers24h === 0) && (
      <p className="border-t border-line px-4 py-2 text-[12px] text-ink-soft">No wallet outside the team and the creators has bought in the last 24 hours.</p>
    )}
    </>
  );
}

function ContestTable({ entries, now, empty }: { entries: ContestEntry[]; now: number; empty: string }) {
  if (entries.length === 0) return empty ? <p className="px-4 pb-3 text-[12px]/snug text-ink-soft">{empty}</p> : null;
  return (
    <>
    <PhoneList>
      {entries.map((e, i) => (
        <PhoneRow
          key={`${e.chainId}-${e.token}`}
          rank={i + 1}
          main={<MarketCell m={e} />}
          meta={
            <>
              <ChainChip chainId={e.chainId} name={e.chainName} />
              {e.creator ? <span className="font-mono">{short(e.creator)}</span> : null}
              <span className="text-ink-faint">{e.open ? until(e.windowEndsAt, now) : "final"}</span>
            </>
          }
          value={e.score}
          valueLabel="net buyers"
        />
      ))}
    </PhoneList>
    <table className="hidden w-full text-left text-[12px]/snug sm:table">
      <thead>
        <tr>
          <th className={th}>#</th>
          <th className={th}>Market</th>
          <th className={th}>Chain</th>
          <th className={th}>Creator</th>
          <th className={`${th} text-right`}>Net buyers</th>
          <th className={`${th} text-right`}>Window</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {entries.map((e, i) => (
          <tr key={`${e.chainId}-${e.token}`}>
            <td className={`${td} text-ink-faint`}>{i + 1}</td>
            <td className={td}>
              <MarketCell m={e} />
            </td>
            <td className={td}>
              <ChainChip chainId={e.chainId} name={e.chainName} />
            </td>
            <td className={`${td} font-mono text-ink-soft`}>{e.creator ? short(e.creator) : "—"}</td>
            <td className={`${td} text-right text-[14px] font-semibold text-ink`} data-numeric>
              {e.score}
            </td>
            <td className={`${td} text-right text-ink-faint`}>{e.open ? until(e.windowEndsAt, now) : "final"}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}
