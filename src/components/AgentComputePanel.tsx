"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  Cpu,
  Layers,
  Loader2,
  Play,
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
 * APA YANG NYATA DI HALAMAN INI HARI INI, DAN APA YANG BELUM
 *
 * Yang dibaca dari chain sungguhan: saldo `$ADEXTO` dompet di 0G mainnet, dan posisi stake kalau
 * kontraknya sudah ada. Yang BELUM ada: kontrak `AdextoAgentStake` itu sendiri — ia ada di source
 * dan menunggu siaran generasi 0.12.0 (runbook §1i), jadi `stakeContractFor()` mengembalikan null
 * dan tombol stake mati.
 *
 * Panel ini menyebutkan itu apa adanya alih-alih menampilkan `0 ADEXTO STAKED` seolah posisinya
 * kosong. Bedanya penting: "kamu belum stake" dan "belum ada tempat untuk stake" adalah dua
 * keadaan berbeda, dan yang pertama menyalahkan pengguna atas sesuatu yang belum kami kirim.
 *
 * KENAPA ANGKA KUOTA TIDAK DISEBUT JAMINAN
 *
 * Kuota compute hidup di `src/config/agent-compute.ts`, off-chain, supaya bisa dikoreksi tanpa
 * menyentuh kontrak yang memegang uang orang. Konsekuensinya jujur: yang dijamin on-chain adalah
 * stake-nya, bukan kuotanya. Kalimat di panel mengatakan itu.
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        {/* ── kiri: apa ini ───────────────────────────────────────────────── */}
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-accent">
            <Sparkles className="h-3.5 w-3.5" />
            Agent compute
          </div>

          <h1 className="text-3xl font-semibold leading-tight text-ink sm:text-4xl">
            Turn your <span className="text-accent">$ADEXTO</span> into
            <br />
            agent compute.
          </h1>

          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
            Stake $ADEXTO to activate an autonomous agent and open its compute allowance. Inference runs
            on the 0G Compute Router.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { icon: <Layers className="h-4 w-4" />, t: "Simple", d: "Buy, stake, activate." },
              { icon: <Cpu className="h-4 w-4" />, t: "AI compute", d: "Runs on 0G Compute." },
              { icon: <Boxes className="h-4 w-4" />, t: "Real utility", d: "The token does something." },
            ].map((c) => (
              <div key={c.t} className="rounded-xl border border-line bg-white p-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  {c.icon}
                </span>
                <div className="mt-2 text-[13px] font-bold text-ink">{c.t}</div>
                <div className="text-[11px] text-ink-soft">{c.d}</div>
              </div>
            ))}
          </div>

          {/* Tingkatan. Angkanya dari config, jadi halaman dan kebijakan tidak bisa berbeda. */}
          <div className="mt-6 rounded-xl border border-line bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
              <Layers className="h-3.5 w-3.5 text-accent" /> Stake tiers
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-faint">
                  <th className="pb-2 font-bold">Tier</th>
                  <th className="pb-2 font-bold">Stake</th>
                  <th className="pb-2 text-right font-bold">Beta AI tokens</th>
                </tr>
              </thead>
              <tbody>
                {COMPUTE_TIERS.map((t) => {
                  const reached = effective >= t.stake && active;
                  return (
                    <tr key={t.label} className="border-t border-line/70">
                      <td className={`py-2 font-bold ${reached ? "text-accent" : "text-ink"}`}>
                        <span className="inline-flex items-center gap-1.5">
                          {reached && <CheckCircle2 className="h-3.5 w-3.5 text-ok" />}
                          {t.label}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-ink-soft">{fmt(t.stake)} ADEXTO</td>
                      <td className="py-2 text-right font-mono text-ink-soft">{fmt(t.tokens)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">
              The stake is guaranteed on chain. The allowance is not — it is protocol policy that can
              change, kept off chain so it can be corrected without touching a contract that holds your
              tokens.
            </p>
          </div>

          {/* Cara kerja */}
          <div className="mt-6 rounded-xl border border-line bg-cream-2 p-4">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
              <Sparkles className="h-3.5 w-3.5 text-accent" /> How it works
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { n: 1, icon: <ShoppingCart className="h-4 w-4" />, t: "Buy $ADEXTO", d: "On 0G mainnet." },
                { n: 2, icon: <Layers className="h-4 w-4" />, t: "Stake it", d: `At least ${fmt(MIN_STAKE_ADEXTO)}.` },
                { n: 3, icon: <Bot className="h-4 w-4" />, t: "Activate", d: "Your agent goes live." },
                { n: 4, icon: <Cpu className="h-4 w-4" />, t: "Use AI", d: `Up to ${fmt(BETA_TOKEN_CEILING)} tokens.` },
              ].map((s, i) => (
                <div key={s.n} className="relative rounded-xl border border-line bg-white p-3">
                  <span className="absolute right-2 top-2 font-mono text-[10px] font-bold text-ink-faint">
                    {s.n}
                  </span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    {s.icon}
                  </span>
                  <div className="mt-2 text-[12px] font-bold text-ink">{s.t}</div>
                  <div className="text-[10px] text-ink-soft">{s.d}</div>
                  {i < 3 && (
                    <ArrowRight className="absolute -right-[13px] top-1/2 hidden h-3 w-3 -translate-y-1/2 text-ink-faint sm:block" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── kanan: keadaan sebenarnya ───────────────────────────────────── */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(32,24,16,0.05)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                <span className="text-[13px] font-bold text-ink">Agent compute</span>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  active
                    ? "bg-ok/10 text-ok"
                    : "bg-cream-3 text-ink-faint"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-ok" : "bg-ink-faint"}`} />
                {active ? "Active" : "Inactive"}
              </span>
            </div>

            {/* Keadaan yang paling penting untuk tidak dipalsukan. */}
            {!stakeAddress && (
              <div className="mt-3 rounded-xl border border-warn/30 bg-warn/[0.07] p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                  <div className="text-[11px] leading-relaxed text-ink-soft">
                    <strong className="text-warn">Staking is not live yet.</strong> The stake contract is
                    written and tested but not deployed — it ships with the next contract generation.
                    Nothing below is a placeholder for a position you hold: there is no contract to hold
                    one in.
                  </div>
                </div>
              </div>
            )}

            {!isConnected ? (
              <div className="mt-4">
                <p className="text-[12px] text-ink-soft">
                  Connect a wallet to read your $ADEXTO balance on 0G mainnet.
                </p>
                {/* `connectWallet` dibungkus, bukan diteruskan langsung sebagai handler: ia menerima
                    `rdns?: string`, jadi memasangnya apa adanya akan mengirim objek MouseEvent
                    sebagai pilihan dompet. */}
                <button
                  type="button"
                  onClick={() => void connectWallet()}
                  disabled={isConnecting}
                  className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-bold text-white transition-colors hover:bg-accent-strong disabled:opacity-60"
                >
                  {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                  {isConnecting ? "Connecting…" : "Connect wallet"}
                </button>
              </div>
            ) : (
              <>
                <div className="mt-4 rounded-xl border border-line bg-cream-2 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                    {stakeAddress ? "ADEXTO staked" : "ADEXTO balance on 0G"}
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-bold text-ink">
                      {loading ? "…" : fmt(stakeAddress ? effective : balance ?? 0)}
                    </span>
                    <span className="font-mono text-[11px] text-ink-soft">ADEXTO</span>
                  </div>
                  {!stakeAddress && (
                    <div className="mt-1 text-[10px] text-ink-faint">
                      Your wallet balance, read from 0G mainnet. Not a stake.
                    </div>
                  )}
                  {readError && (
                    <div className="mt-2 flex items-start gap-1.5 text-[10px] text-danger">
                      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                      <span>Could not read from 0G: {readError}</span>
                    </div>
                  )}
                </div>

                {/* Kuota hanya ditampilkan kalau memang ada stake yang membukanya. */}
                {active && tier ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                      <span>Beta compute allowance</span>
                      <span className="font-mono text-accent">{tier.label}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-cream-3">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.min(100, (quota / BETA_TOKEN_CEILING) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-soft">
                      <span>
                        {fmt(quota)} / {fmt(BETA_TOKEN_CEILING)} AI tokens
                      </span>
                      <span>{Math.round((quota / BETA_TOKEN_CEILING) * 100)}%</span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-line bg-cream-2 p-3 text-[11px] leading-relaxed text-ink-soft">
                    {upcoming ? (
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
                  </div>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-line bg-cream-2 p-2.5">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">Model</div>
                    <div className="mt-0.5 text-[12px] font-bold text-ink">{AGENT_COMPUTE_MODEL_LABEL}</div>
                    <div className="font-mono text-[9px] text-ink-faint">{AGENT_COMPUTE_MODEL}</div>
                  </div>
                  <div className="rounded-xl border border-line bg-cream-2 p-2.5">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">
                      Infrastructure
                    </div>
                    <div className="mt-0.5 text-[12px] font-bold text-ink">0G Compute</div>
                    <div className="font-mono text-[9px] text-ink-faint">router-api.0g.ai</div>
                  </div>
                </div>

                {/* Tombol mati sampai ada kontraknya, dengan alasan yang terbaca. */}
                <button
                  type="button"
                  disabled
                  title="The stake contract is not deployed yet. It ships with the next contract generation."
                  className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play className="h-4 w-4" />
                  Stake and activate
                </button>

                <div className="mt-2 flex gap-2">
                  <Link
                    href={`/token/adexto?chain=${STAKE_TOKEN.chainId}&tf=60`}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-white text-[12px] font-bold text-ink transition-colors hover:border-line-strong"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" /> Buy $ADEXTO
                  </Link>
                  <button
                    type="button"
                    onClick={read}
                    disabled={loading}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-line bg-white px-3 text-[12px] font-bold text-ink transition-colors hover:border-line-strong disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refresh"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Beta dinyatakan sebagai beta, termasuk apa yang terjadi di plafonnya. */}
          <div className="rounded-2xl border border-line bg-cream-2 p-4">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warn/15 text-warn">
                <AlertTriangle className="h-3 w-3" />
              </span>
              <div className="text-[11px] leading-relaxed text-ink-soft">
                <strong className="text-ink">This is a beta allowance.</strong> There is no meter billing
                usage against your stake and no payment flowing — it is one shared ceiling of{" "}
                {fmt(BETA_TOKEN_CEILING)} AI tokens for early participants. When the metered version
                arrives, what you can do today may change, and saying so now is cheaper than explaining
                it later.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              What the contract can and cannot do
            </div>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ink-soft">
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
                <strong className="text-ink">Exit goes to you.</strong> The recipient is not a parameter —
                it is always the caller.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
