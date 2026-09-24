"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cpu,
  Layers,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { CHAIN_LIST, type ChainInfo } from "@/lib/chains";
import { ERC20_ABI } from "@/lib/dex";
import {
  AGENT_COMPUTE_MODEL,
  AGENT_COMPUTE_MODEL_LABEL,
  BETA_TOKEN_CEILING,
  COMPUTE_TIERS,
  MIN_STAKE_ADEXTO,
  STAKE_TOKEN,
  nextTier,
  stakeContractFor,
  tierForStake,
} from "@/config/agent-compute";

/**
 * Agent Compute: stake $ADEXTO, agen aktif, compute terbuka.
 *
 * KENAPA TATA LETAKNYA DIROMBAK
 *
 * Versi pertama menaruh setiap bagian di dalam kotak putih ber-border 1px dengan teks 10–11px yang
 * sama besar, plus satu `<table>` mentah untuk tingkatan. Hasilnya: delapan blok dengan bobot
 * visual identik, jadi tidak ada satu pun yang terbaca lebih dulu — dan halaman yang seluruh
 * isinya sama pentingnya terbaca seperti panel admin, bukan seperti produk.
 *
 * Yang diperbaiki adalah HIERARKINYA, bukan paletnya:
 *   - hero bergradien ungu dengan gambarnya, satu-satunya elemen berlatar gelap di halaman, jadi
 *     mata punya titik masuk
 *   - satu angka besar untuk keadaan sekarang, bukan empat angka sedang
 *   - tingkatan menjadi tangga berisi bar, bukan tabel; posisi pembaca terlihat tanpa dibaca
 *   - jumlah kotak dikurangi dengan menggabungkan yang berkaitan
 *
 * APA YANG NYATA HARI INI, DAN APA YANG BELUM
 *
 * Dibaca dari chain: saldo `$ADEXTO` di 0G mainnet. BELUM ada: kontrak `AdextoAgentStake` — ia ada
 * di source dan menunggu siaran generasi 0.12.0 (runbook §1i), jadi `stakeContractFor()`
 * mengembalikan null dan tombol stake mati. Panel menyebutkan itu apa adanya alih-alih menampilkan
 * `0 ADEXTO STAKED`, sebab "kamu belum stake" dan "belum ada tempat untuk stake" adalah dua keadaan
 * berbeda dan yang pertama menyalahkan pengguna atas sesuatu yang belum dikirim.
 */

const ZERO_G: ChainInfo | undefined = CHAIN_LIST.find((c) => c.chainId === STAKE_TOKEN.chainId);

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export default function AgentComputePanel() {
  const { address, isConnected, connectWallet, isConnecting } = useWallet();

  const [balance, setBalance] = useState<number | null>(null);
  const [staked, setStaked] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const stakeAddress = stakeContractFor(STAKE_TOKEN.chainId);

  /**
   * Dibaca lewat RPC 0G langsung, bukan lewat provider dompet.
   *
   * Dompet bisa berada di chain lain sementara halaman ini selalu bicara tentang 0G mainnet.
   * Memakai provider dompet akan membaca saldo di chain yang salah dan melaporkan nol dengan
   * yakin — kelas kesalahan yang paling sulit terlihat, karena ia tidak melempar apa pun.
   */
  const read = useCallback(async () => {
    if (!address || !ZERO_G) return;
    setLoading(true);
    setReadError(null);
    try {
      const provider = new ethers.JsonRpcProvider(ZERO_G.rpcUrl, ZERO_G.chainId, { staticNetwork: true });
      const token = new ethers.Contract(STAKE_TOKEN.address, ERC20_ABI, provider);
      const raw: bigint = await token.balanceOf(address);
      setBalance(Number(ethers.formatUnits(raw, STAKE_TOKEN.decimals)));

      if (stakeAddress) {
        const stake = new ethers.Contract(
          stakeAddress,
          ["function stakedOf(address) view returns (uint256)"],
          provider
        );
        const pos: bigint = await stake.stakedOf(address);
        setStaked(Number(ethers.formatUnits(pos, STAKE_TOKEN.decimals)));
      } else {
        setStaked(null);
      }
    } catch (e) {
      setReadError((e as Error).message.slice(0, 120));
    } finally {
      setLoading(false);
    }
  }, [address, stakeAddress]);

  useEffect(() => {
    void read();
  }, [read]);

  const effective = staked ?? 0;
  const tier = tierForStake(effective);
  const upcoming = nextTier(effective);
  const active = Boolean(stakeAddress) && effective >= MIN_STAKE_ADEXTO;
  const quota = tier?.tokens ?? 0;
  const headline = stakeAddress ? effective : balance ?? 0;

  return (
    <div className="pb-14">
      {/* ── hero ─────────────────────────────────────────────────────────────
          Satu-satunya elemen berlatar gelap di halaman. Gambarnya dipasang dengan
          `mix-blend-mode: luminosity` seperti cover dek campaign: ia mengambil warna dari
          gradien di belakangnya dan hanya menyumbang terang-gelap, jadi latar krem gambarnya
          tidak menabrak ungu. */}
      <section className="relative isolate overflow-hidden bg-[linear-gradient(135deg,#2e0f63_0%,#5b21b6_45%,#7c3aed_100%)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-0 w-[58%] bg-[url('/agent-compute/hero.jpg')] bg-cover bg-[position:60%_center] opacity-[0.55] mix-blend-luminosity [mask-image:linear-gradient(to_right,transparent,rgba(0,0,0,0.9)_42%,#000_72%)]"
        />
        <div className="relative z-10 mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-white/90 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            Agent compute
          </div>

          <h1 className="mt-4 max-w-2xl text-[34px] font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl">
            Turn your <span className="text-[#d8c4ff]">$ADEXTO</span>
            <br />
            into agent compute.
          </h1>

          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/75">
            Stake $ADEXTO to activate an autonomous agent and open its compute allowance. Inference
            runs on the 0G Compute Router.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <Link
              href={`/token/adexto?chain=${STAKE_TOKEN.chainId}&tf=60`}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-[13px] font-bold text-[#2e0f63] transition-colors hover:bg-white/90"
            >
              <ShoppingCart className="h-4 w-4" /> Buy $ADEXTO
            </Link>
            <a
              href="#tiers"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-5 text-[13px] font-bold text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              See the tiers <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          {/* Tiga sifat, dibuat ringan: teks putih transparan tanpa kotak, supaya tidak menyaingi
              judulnya sendiri. */}
          <div className="mt-8 grid max-w-2xl gap-x-6 gap-y-3 text-[12px] text-white/70 sm:grid-cols-3">
            {[
              ["Simple", "Buy, stake, activate."],
              ["AI compute", "Runs on 0G Compute."],
              ["Real utility", "The token does something."],
            ].map(([t, d]) => (
              <div key={t} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#c4a6ff]" />
                <span>
                  <strong className="text-white">{t}</strong> — {d}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* ── status: satu angka besar ────────────────────────────────────────
            `relative z-10` WAJIB di sini, bukan hiasan. Barisan ini naik ke atas hero lewat
            `-mt-8`, dan hero memakai `isolate` sehingga ia stacking context sendiri — tanpa
            z-index di sini, hero yang menang dan memotong tepi atas kartu, menutupi judul
            kartu kedua. Ketahuan dari potret, bukan dari kode. */}
        <div className="relative z-10 -mt-8 grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_24px_-12px_rgba(46,15,99,0.25)]">
            {!stakeAddress && (
              <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/[0.07] p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                <p className="text-[12px] leading-relaxed text-ink-soft">
                  <strong className="text-warn">Staking is not live yet.</strong> The stake contract is
                  written and tested but not deployed — it ships with the next contract generation.
                  Nothing below stands in for a position you hold: there is no contract to hold one in.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
                  {stakeAddress ? "ADEXTO staked" : "ADEXTO balance on 0G"}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-[40px] font-bold leading-none tracking-tight text-ink">
                    {!isConnected ? "—" : loading ? "…" : fmt(headline)}
                  </span>
                  <span className="font-mono text-[13px] font-bold text-ink-soft">ADEXTO</span>
                </div>
                {isConnected && !stakeAddress && (
                  <div className="mt-1.5 text-[11px] text-ink-faint">
                    Your wallet balance, read from 0G mainnet. Not a stake.
                  </div>
                )}
              </div>

              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${
                  active ? "bg-ok/10 text-ok" : "bg-cream-3 text-ink-faint"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${active ? "bg-ok" : "bg-ink-faint"}`} />
                {active ? "Agent active" : "Agent inactive"}
              </span>
            </div>

            {readError && (
              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-danger">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                <span>Could not read from 0G: {readError}</span>
              </p>
            )}

            {/* Kuota hanya digambar kalau memang ada stake yang membukanya. */}
            {active && tier ? (
              <div className="mt-5">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                  <span>Beta compute allowance</span>
                  <span className="text-accent">{tier.label}</span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-cream-3">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#7c3aed,#a78bfa)]"
                    style={{ width: `${Math.min(100, (quota / BETA_TOKEN_CEILING) * 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between font-mono text-[11px] text-ink-soft">
                  <span>
                    {fmt(quota)} / {fmt(BETA_TOKEN_CEILING)} AI tokens
                  </span>
                  <span>{Math.round((quota / BETA_TOKEN_CEILING) * 100)}%</span>
                </div>
              </div>
            ) : (
              <p className="mt-5 rounded-xl bg-cream-2 p-3 text-[12px] leading-relaxed text-ink-soft">
                {!isConnected ? (
                  <>Connect a wallet to read your balance on 0G mainnet.</>
                ) : upcoming ? (
                  <>
                    A stake of <strong className="text-ink">{fmt(upcoming.tier.stake)} ADEXTO</strong>{" "}
                    opens the {upcoming.tier.label} tier
                    {balance !== null && (
                      <>
                        {" "}
                        — you hold <strong className="text-ink">{fmt(balance)}</strong> on 0G
                      </>
                    )}
                    .
                  </>
                ) : (
                  <>No allowance is open yet.</>
                )}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {isConnected ? (
                <>
                  <button
                    type="button"
                    disabled
                    title="The stake contract is not deployed yet. It ships with the next contract generation."
                    className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Play className="h-4 w-4" /> Stake and activate
                  </button>
                  <button
                    type="button"
                    onClick={read}
                    disabled={loading}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 text-[13px] font-bold text-ink transition-colors hover:border-line-strong disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Refresh
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void connectWallet()}
                  disabled={isConnecting}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-bold text-white transition-colors hover:bg-accent-strong disabled:opacity-60"
                >
                  {isConnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wallet className="h-4 w-4" />
                  )}
                  {isConnecting ? "Connecting…" : "Connect wallet"}
                </button>
              )}
            </div>
          </div>

          {/* Model + infrastruktur, digabung jadi satu kartu alih-alih dua. */}
          <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_24px_-12px_rgba(46,15,99,0.25)]">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              Runs on
            </div>
            <div className="mt-3 space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-ink">{AGENT_COMPUTE_MODEL_LABEL}</div>
                  <div className="truncate font-mono text-[10px] text-ink-faint">{AGENT_COMPUTE_MODEL}</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Cpu className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-ink">0G Compute</div>
                  <div className="truncate font-mono text-[10px] text-ink-faint">router-api.0g.ai</div>
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-line pt-3">
              <div className="flex items-start gap-2">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <p className="text-[11px] leading-relaxed text-ink-soft">
                  <strong className="text-ink">No owner, no lock.</strong> Unstaking works immediately
                  and always pays the caller. Nobody can pause, upgrade or move your stake.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── tangga tingkatan ──────────────────────────────────────────────── */}
        <section id="tiers" className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Stake tiers</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
            The stake is guaranteed on chain. The allowance is not — it is protocol policy, kept off
            chain so it can be corrected without touching a contract that holds your tokens.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {COMPUTE_TIERS.map((t) => {
              const reached = active && effective >= t.stake;
              return (
                <div
                  key={t.label}
                  className={`relative overflow-hidden rounded-2xl border p-4 transition-colors ${
                    reached ? "border-accent/40 bg-accent-soft" : "border-line bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[13px] font-bold ${reached ? "text-accent" : "text-ink"}`}
                    >
                      {t.label}
                    </span>
                    {reached && <CheckCircle2 className="h-4 w-4 text-ok" />}
                  </div>

                  <div className="mt-3 font-mono text-[22px] font-bold leading-none text-ink">
                    {fmt(t.tokens / 1000)}
                    <span className="ml-1 text-[12px] font-bold text-ink-soft">k tokens</span>
                  </div>

                  {/* Bar menunjukkan porsi plafon beta, jadi perbandingan antar tingkatan
                      terlihat tanpa membaca angkanya. */}
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream-3">
                    <div
                      className={`h-full rounded-full ${reached ? "bg-accent" : "bg-line-strong"}`}
                      style={{ width: `${(t.tokens / BETA_TOKEN_CEILING) * 100}%` }}
                    />
                  </div>

                  <div className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-ink-soft">
                    <Layers className="h-3 w-3" />
                    {fmt(t.stake)} ADEXTO
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── cara kerja ────────────────────────────────────────────────────── */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-ink">How it works</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { n: "01", icon: <ShoppingCart className="h-4 w-4" />, t: "Buy $ADEXTO", d: "On 0G mainnet, from its curve." },
              { n: "02", icon: <Layers className="h-4 w-4" />, t: "Stake it", d: `At least ${fmt(MIN_STAKE_ADEXTO)} to activate.` },
              { n: "03", icon: <Bot className="h-4 w-4" />, t: "Activate", d: "Your agent goes live." },
              { n: "04", icon: <Cpu className="h-4 w-4" />, t: "Use AI", d: `Up to ${fmt(BETA_TOKEN_CEILING)} beta tokens.` },
            ].map((s) => (
              <div key={s.n} className="rounded-2xl border border-line bg-cream-2 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-accent shadow-sm">
                    {s.icon}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-ink-faint">{s.n}</span>
                </div>
                <div className="mt-3 text-[14px] font-bold text-ink">{s.t}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">{s.d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── batas yang jujur ──────────────────────────────────────────────── */}
        <section className="mt-10 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-warn/30 bg-warn/[0.07] p-5">
            <div className="flex items-center gap-2 text-[13px] font-bold text-warn">
              <AlertTriangle className="h-4 w-4" /> This is a beta allowance
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
              There is no meter billing usage against your stake and no payment flowing — it is one
              shared ceiling of {fmt(BETA_TOKEN_CEILING)} AI tokens for early participants. When the
              metered version arrives, what you can do today may change, and saying so now is cheaper
              than explaining it later.
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-white p-5">
            <div className="text-[13px] font-bold text-ink">What the contract cannot do</div>
            <ul className="mt-2 space-y-2 text-[12px] leading-relaxed text-ink-soft">
              <li>
                <strong className="text-ink">No owner.</strong> No pause, no upgrade, no emergency
                withdrawal, and no function that can move somebody else&apos;s stake.
              </li>
              <li>
                <strong className="text-ink">No lock period.</strong> Unstaking works immediately. The
                word &quot;stake&quot; here does not promise a lock, and the contract does not implement
                one.
              </li>
              <li>
                <strong className="text-ink">Exit goes to you.</strong> The recipient is not a
                parameter — it is always the caller.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
