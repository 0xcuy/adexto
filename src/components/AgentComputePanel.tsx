"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  KeyRound,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Terminal,
  Trash2,
  Undo2,
  Wallet,
  Zap,
} from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { CHAIN_LIST, type ChainInfo } from "@/lib/chains";
import { ERC20_ABI, describeTxError } from "@/lib/dex";
import { issueKeyMessage, revokeKeyMessage } from "@/lib/agent-compute-message";
import {
  AGENT_COMPUTE_ENDPOINT,
  AGENT_COMPUTE_MODEL,
  AGENT_COMPUTE_MODEL_FACTS,
  AGENT_COMPUTE_MODEL_LABEL,
  CLIENT_USAGE_BUFFER,
  COMPUTE_STAKES,
  HUB_COMPUTE_SHARE_BPS,
  MEASURED_INPUT_FLOOR,
  approxRequests,
  hubVolumePerRequestUsd,
  nextTier,
  tierForStake,
  type ComputeStake,
} from "@/config/agent-compute";
import { STAKE_HUB_ABI } from "@/config/stake-hubs";

/**
 * Agent Compute: centang token yang di-stake, terima kunci API per token, belanjakan jatahnya.
 *
 * DAFTAR CENTANG, SATU KUNCI PER TOKEN (owner 2026-10-01)
 *
 * Token yang bisa di-stake ada di `COMPUTE_STAKES`: $ADEXTO di 0G dan $SAI dari dua pasarnya.
 * Pengunjung mencentang token yang ingin ia stake; setiap token yang dicentang mendapat kartunya
 * sendiri — stake, tingkatan, dan kunci API-nya. Kunci tidak dibagi antar token: beda chain, beda
 * centang, beda kunci. Jadi membuka kunci $SAI tidak menyentuh kunci $ADEXTO yang sudah ada.
 *
 * APA YANG DIJUAL HALAMAN INI
 *
 * Yang dibagikan adalah POOL INFERENSI, bukan kotak chat. Pemegang stake memanggil
 * `https://compute.adexto.xyz/v1` dari kode mereka sendiri dengan kunci mereka sendiri. Jadi hal
 * paling penting di halaman ini adalah tiga baris yang bisa ditempel ke terminal: endpoint, nama
 * model, dan kuncinya.
 *
 * Token tanpa kontrak stake tetap tampil di daftar dan bisa dicentang, dan kartunya mengatakan apa
 * adanya bahwa belum ada tempat untuk stake — bukan menampilkan `0 staked`, karena "kamu belum
 * stake" dan "belum ada kontrak" adalah dua keadaan berbeda.
 *
 * SETIAP PASAR LAIN LEWAT HUB (owner 2026-10-01)
 *
 * Selain empat sumber bertingkat di `COMPUTE_STAKES`, daftar ini memuat setiap pasar hidup yang
 * di-stake di AdextoStakeHub chain-nya, dikirim server dari registry (`sources` di
 * `/api/agent/keys`), jadi pasar yang baru diluncurkan muncul di sini tanpa mengubah kode. Kunci
 * pasar hub tidak bertingkat: jatahnya terkumpul dari separuh protocol fee trading pasar itu.
 */

/** Anggaran compute sebuah pasar hub, sebagaimana server membacanya dari kurvanya. */
type HubBudgetView = {
  feesNative: number;
  nativeSymbol: string;
  priceUsd: number | null;
  budgetUsd: number | null;
  budgetTokens: number | null;
  shareBps: number;
  usdPerMillionTokens: number;
  error: string | null;
};

/** Sumber yang ditampilkan halaman: `ComputeStake`, ditambah anggaran untuk pasar hub. */
type Source = ComputeStake & { budget?: HubBudgetView | null };

/** Chain sebuah token, dari registry aplikasi. */
const chainOf = (chainId: number): ChainInfo | undefined => CHAIN_LIST.find((c) => c.chainId === chainId);

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** "SAi Arbitrum · Arbitrum One", atau hanya chain untuk $ADEXTO. */
const placeOf = (s: ComputeStake) => (s.id === "adexto" ? s.chainName : `${s.name} · ${s.chainName}`);

type KeyRecord = {
  keyPrefix: string;
  createdAt: string;
  tierLabel: string | null;
  allowance: number;
  usedInput: number;
  usedOutput: number;
  requests: number;
  active: boolean;
  disabledReason: string | null;
  stakeSource?: string | null;
  lastSweepAt: string | null;
  accrued?: number | null;
};

type TierRow = { label: string; stake: number; allowance: number };

/** Satu token untuk alamat ini, sebagaimana server membacanya, beserta kuncinya. */
type StakeRow = {
  id: string;
  chainId: number;
  symbol: string;
  name: string;
  contract: string | null;
  minStake: number;
  staked: number | null;
  error: string | null;
  tier: TierRow | null;
  key: KeyRecord | null;
  kind?: "tiered" | "hub";
  budget?: HubBudgetView | null;
};

type KeyStatus = {
  configured: boolean;
  durable: boolean;
  endpoint: string;
  model: string;
  address: string | null;
  stakes?: StakeRow[];
  sources?: Source[];
};

/** Tombol salin kecil, dipakai di beberapa tempat. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          // Clipboard ditolak (konteks tidak aman, atau izin dicabut). Nilainya tetap terlihat
          // di halaman, jadi tidak ada yang hilang selain kenyamanannya.
        }
      }}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-[11px] font-bold text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
    >
      {done ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** ABI stake untuk empat sumber bertingkat (AdextoAgentStake). Pasar hub memakai STAKE_HUB_ABI. */
const STAKE_ABI = [
  "function stake(uint256 amount)",
  "function unstakeAll()",
  "function stakedOf(address) view returns (uint256)",
  "function minStake() view returns (uint256)",
];

export default function AgentComputePanel() {
  const { address, isConnected, connectWallet, isConnecting } = useWallet();

  /** Token yang dicentang, dalam urutan daftar. `?stake=<id>` mencentang satu token saat dibuka. */
  const [checked, setChecked] = useState<string[]>([]);
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [ping, setPing] = useState<{ ok: boolean; ms: number; status: number } | null>(null);
  /**
   * Daftar sumber: empat yang bertingkat sejak render pertama, lalu setiap pasar hub begitu server
   * menjawab. Daftarnya datang dari server karena pasar hub berasal dari registry, bukan dari kode.
   */
  const [sources, setSources] = useState<Source[]>(() => [...COMPUTE_STAKES]);

  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("stake");
    // Id pasar hub baru dikenal setelah server menjawab, jadi bentuknya yang diperiksa di sini.
    if (want && /^[a-z0-9-]{3,40}$/.test(want)) setChecked([want]);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/agent/keys", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: KeyStatus | null) => {
        if (alive && j?.sources?.length) setSources(j.sources);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const sourceFor = (id: string) => sources.find((s) => s.id === id) ?? null;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      return sources.map((s) => s.id).filter((x) => next.includes(x));
    });

  /**
   * Stake dan keadaan kunci SEMUA token datang dari `/api/agent/keys`, bukan dari RPC di sini,
   * karena penegakan jatah memakai angka yang SERVER baca. Dua pembacaan yang berbeda untuk angka
   * yang sama hanya akan berselisih, dan yang terlihat di halaman akan jadi yang salah.
   */
  const readStatus = useCallback(async () => {
    if (!address) {
      setStatus(null);
      return;
    }
    setLoading(true);
    setReadError(null);
    try {
      const res = await fetch(`/api/agent/keys?address=${address}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as KeyStatus;
      setStatus(json);
      if (json.sources?.length) setSources(json.sources);
    } catch (e) {
      setReadError(`Key status unavailable: ${String((e as Error).message || e).slice(0, 90)}`);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void readStatus();
  }, [readStatus]);

  /**
   * Ping endpoint, diukur dan diberi label apa adanya: waktu bolak-balik dari SERVER ini ke health
   * check router, bukan dari peramban pengunjung dan bukan latensi inferensi.
   */
  useEffect(() => {
    let alive = true;
    const beat = async () => {
      try {
        const res = await fetch("/api/agent/ping", { cache: "no-store" });
        const j = await res.json();
        if (alive && typeof j.ms === "number") setPing({ ok: Boolean(j.ok), ms: j.ms, status: j.status ?? 0 });
      } catch {
        if (alive) setPing(null);
      }
    };
    void beat();
    const timer = setInterval(beat, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const rowFor = (id: string) => status?.stakes?.find((r) => r.id === id) ?? null;

  /**
   * `"stream": false` DITULIS EKSPLISIT. Diukur: tanpa field `stream`, router membalas
   * `text/event-stream` dan menempelkan `data: [DONE]` di belakang objek JSON-nya, sehingga
   * `JSON.parse` pada body itu gagal.
   */
  const curl = [
    `curl ${AGENT_COMPUTE_ENDPOINT}/chat/completions \\`,
    `  -H "Authorization: Bearer $ADEXTO_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"${AGENT_COMPUTE_MODEL}",`,
    `       "messages":[{"role":"user","content":"hello"}],`,
    `       "stream":false}'`,
  ].join("\n");

  return (
    <div className="pb-14">
      {/* ── hero ───────────────────────────────────────────────────────────── */}
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
            Turn your <span className="text-[#d8c4ff]">stake</span>
            <br />
            into agent compute.
          </h1>

          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/75">
            Tick the token you stake: $ADEXTO, $SAI, or any market launched on ADEXTO. Each one gets
            its own API key to call {AGENT_COMPUTE_MODEL_LABEL} from your code. OpenAI-compatible,
            served by 0G Compute.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <a
              href="#stake"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-[13px] font-bold text-[#2e0f63] transition-colors hover:bg-white/90"
            >
              <ListChecks className="h-4 w-4" /> Choose a token
            </a>
            <a
              href="#endpoint"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-5 text-[13px] font-bold text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              See the endpoint <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-8 grid max-w-2xl gap-x-6 gap-y-3 text-[12px] text-white/70 sm:grid-cols-3">
            {[
              ["Your key", "One per token, issued to your address."],
              ["Your code", "OpenAI-compatible endpoint."],
              ["Metered", "Input plus output tokens."],
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
        {/* `relative z-10` WAJIB: barisan ini naik ke atas hero lewat `-mt-8`, dan hero memakai
            `isolate`, jadi tanpa z-index hero yang menang dan memotong tepi atas kartu. */}
        <div className="relative z-10 -mt-8 grid gap-4 lg:grid-cols-[1fr_360px]">
          {/* ── daftar centang ───────────────────────────────────────────────── */}
          <div
            id="stake"
            className="scroll-mt-24 rounded-2xl border border-line bg-surface p-5 shadow-[0_8px_24px_-12px_rgba(46,15,99,0.25)]"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Stake with</div>
              <div className="text-[11px] text-ink-faint">Tick one or more. Each token has its own stake and key.</div>
            </div>

            <div role="group" aria-label="Tokens to stake" className="mt-3 space-y-2">
              {sources.map((s) => {
                const on = checked.includes(s.id);
                const row = rowFor(s.id);
                const open = Boolean(s.contract);
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(s.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      on ? "border-accent/50 bg-accent-soft" : "border-line bg-surface hover:border-line-strong"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        on ? "border-accent bg-accent text-white" : "border-line-strong bg-surface"
                      }`}
                    >
                      {on && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`font-mono text-[13px] font-bold ${on ? "text-accent" : "text-ink"}`}>${s.symbol}</span>{" "}
                      <span className="text-[12px] text-ink-soft">{placeOf(s)}</span>
                    </span>
                    <span className="shrink-0 text-right font-mono text-[11px] text-ink-faint">
                      {!open
                        ? "stake contract not deployed yet"
                        : !isConnected || !row
                          ? `min ${fmt(s.minStake)}${s.kind === "hub" ? " · fee-funded" : ""}`
                          : row.staked === null
                            ? "not readable now"
                            : `${fmt(row.staked)} staked${row.key ? (row.key.active ? " · key active" : " · key off") : ""}`}
                    </span>
                  </button>
                );
              })}
            </div>

            {readError && (
              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-danger">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                <span>{readError}</span>
              </p>
            )}

            {!isConnected ? (
              <button
                type="button"
                onClick={() => void connectWallet()}
                disabled={isConnecting}
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-bold text-white transition-colors hover:bg-accent-strong disabled:opacity-60"
              >
                {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                {isConnecting ? "Connecting…" : "Connect wallet"}
              </button>
            ) : checked.length === 0 ? (
              <p className="mt-4 rounded-xl bg-cream-2 p-3 text-[12px] leading-relaxed text-ink-soft">
                Tick a token to see your stake and its API key.
              </p>
            ) : (
              <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-ink-faint">
                <span>{loading ? "Reading your stakes…" : "Read from each token's stake contract."}</span>
                <button
                  type="button"
                  onClick={() => void readStatus()}
                  disabled={loading}
                  className="inline-flex items-center gap-1 font-bold text-ink-soft hover:text-ink disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
                </button>
              </div>
            )}
          </div>

          {/* Model + infrastruktur, satu kartu. */}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-[0_8px_24px_-12px_rgba(46,15,99,0.25)]">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Runs on</div>
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
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold text-ink">0G Compute</span>
                    {ping && (
                      <span
                        title={`HTTP ${ping.status} from /api/health, measured from the ADEXTO server. Not inference latency.`}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                          ping.ok ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
                        }`}
                      >
                        <Zap className="h-2.5 w-2.5" />
                        {ping.ok ? `${ping.ms} ms` : "unreachable"}
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[10px] text-ink-faint">
                    compute.adexto.xyz
                    {ping?.ok && <span className="text-ink-faint/70"> · origin → router</span>}
                  </div>
                </div>
              </div>
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-line pt-3 font-mono text-[11px]">
              {[
                ["Context", `${fmt(AGENT_COMPUTE_MODEL_FACTS.contextLength)} tokens`],
                ["Max output", `${fmt(AGENT_COMPUTE_MODEL_FACTS.maxCompletionTokens)} tokens`],
                ["Attestation", `TEE ${AGENT_COMPUTE_MODEL_FACTS.teeType}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-ink-faint">{k}</dt>
                  <dd className="text-ink-soft">{v}</dd>
                </div>
              ))}
            </dl>

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

        {/* ── satu kartu per token yang dicentang ──────────────────────────────── */}
        {isConnected &&
          checked.map((id) => {
            const src = sourceFor(id);
            return src ? (
              <StakeCard key={id} src={src} row={rowFor(id)} configured={Boolean(status?.configured)} refresh={readStatus} />
            ) : null;
          })}

        {/* ── endpoint ─────────────────────────────────────────────────────────── */}
        <section id="endpoint" className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Your endpoint</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
            OpenAI-compatible. Point any client that speaks{" "}
            <code className="rounded bg-cream-3 px-1 py-0.5 font-mono text-[11px]">/chat/completions</code> at it
            and send the key of any token you stake as a bearer token.
          </p>

          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex items-center gap-2 border-b border-line bg-cream-2 px-4 py-2.5">
              <Terminal className="h-3.5 w-3.5 text-ink-faint" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">Example request</span>
              <span className="ml-auto">
                <CopyButton value={curl} label="Copy the example request" />
              </span>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-ink-soft">{curl}</pre>
            <div className="space-y-2 border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ink-soft">
              <p>
                <strong className="text-ink">Streaming works.</strong> Set{" "}
                <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">&quot;stream&quot;: true</code>, and add{" "}
                <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">
                  &quot;stream_options&quot;: {"{"}&quot;include_usage&quot;: true{"}"}
                </code>{" "}
                if you want the usage totals in the last frame.
              </p>
              <p>
                Read only <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">delta.content</code>. Thinking is on
                by default, so the model sends a long run of{" "}
                <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">delta.reasoning_content</code> first — measured
                at 140 reasoning frames before the first answer token, 2.8s in. Sending{" "}
                <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">&quot;enable_thinking&quot;: false</code> removed
                them entirely and brought the first token forward to 1.7s.
              </p>
              <p>
                Keep <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">&quot;stream&quot;</code> in the body either
                way. Omit it and the reply arrives as JSON with an SSE terminator glued to the end, which no JSON parser
                accepts.
              </p>
            </div>
            <div className="space-y-2 border-t border-line px-4 py-3">
              {[
                ["Base URL", AGENT_COMPUTE_ENDPOINT],
                ["Model", AGENT_COMPUTE_MODEL],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wider text-ink-faint">{k}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">{v}</code>
                  <CopyButton value={v} label={`Copy the ${k}`} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── tangga tingkatan, semua token dalam satu tabel ───────────────────── */}
        <section id="tiers" className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Stake tiers</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
            Allowances count input plus output tokens, cumulative from the day a key is issued. Every token
            has the same allowances at its own stake sizes. The stake is guaranteed on chain; the allowance
            is protocol policy, kept off chain.
          </p>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="border-b border-line bg-cream-2 text-[10px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="px-4 py-2.5 font-bold">Tier</th>
                  <th className="px-4 py-2.5 font-bold">Allowance</th>
                  {COMPUTE_STAKES.map((s) => (
                    <th key={s.id} className="px-4 py-2.5 font-bold">
                      ${s.symbol} · {s.id === "adexto" ? s.chainName : s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPUTE_STAKES[0].tiers.map((t, i) => (
                  <tr key={t.label} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-bold text-ink">{t.label}</td>
                    <td className="px-4 py-2.5 font-mono text-ink">
                      {fmt(t.allowance / 1000)}k tokens
                      <span className="ml-1.5 text-ink-faint">≈{fmt(approxRequests(t.allowance))} requests</span>
                    </td>
                    {COMPUTE_STAKES.map((s) => (
                      <td key={s.id} className="px-4 py-2.5 font-mono text-ink-soft">
                        {s.tiers[i] ? `${fmt(s.tiers[i].stake)} ${s.symbol}` : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 rounded-2xl border border-line bg-cream-2 p-4 text-[12px] leading-relaxed text-ink-soft">
            <strong className="text-ink">Every other ADEXTO market has no tiers.</strong> It stakes in its chain&apos;s
            stake hub, from its first block, with a minimum of 0.001% of its supply. Its keys share compute funded by
            the market&apos;s own trading: {HUB_COMPUTE_SHARE_BPS / 100}% of the 0.10% protocol fee its trades pay,
            split by stake, and only fees that arrive after a key exists count toward that key. At today&apos;s model
            price, about ${hubVolumePerRequestUsd().toFixed(2)} of trading pays for one request, and a key switches on
            once one request&apos;s worth has accrued. A market nobody trades funds no compute.
          </div>
        </section>

        {/* ── cara kerja ──────────────────────────────────────────────────────── */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-ink">How it works</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { n: "01", icon: <ListChecks className="h-4 w-4" />, t: "Tick a token", d: "$ADEXTO, $SAI, or any ADEXTO market." },
              { n: "02", icon: <Layers className="h-4 w-4" />, t: "Stake it", d: "At least that token's minimum, on its own chain." },
              { n: "03", icon: <KeyRound className="h-4 w-4" />, t: "Sign for a key", d: "One key per token, bound to your address." },
              { n: "04", icon: <Cpu className="h-4 w-4" />, t: "Call the endpoint", d: "From your own code." },
            ].map((s) => (
              <div key={s.n} className="rounded-2xl border border-line bg-cream-2 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-accent shadow-sm">
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

        {/* ── batas yang jujur, dilipat (owner 2026-10-01: terlalu panjang untuk halaman ini).
            Isinya tetap di sini, satu klik di bawah, karena ia yang membuat angka di atas bisa
            dipercaya. */}
        <details className="group mt-10 rounded-2xl border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-[13px] font-bold text-ink">
            <span className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-ink-faint" /> How metering and the stake contracts work
            </span>
            <span className="text-[11px] font-normal text-ink-faint group-open:hidden">Show</span>
            <span className="hidden text-[11px] font-normal text-ink-faint group-open:inline">Hide</span>
          </summary>
          <section className="grid gap-3 px-5 pb-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-warn/30 bg-warn/[0.07] p-5">
              <div className="flex items-center gap-2 text-[13px] font-bold text-warn">
                <AlertTriangle className="h-4 w-4" /> How the meter really behaves
              </div>
              <ul className="mt-2 space-y-2 text-[12px] leading-relaxed text-ink-soft">
                <li>
                  <strong className="text-ink">
                    About {fmt(MEASURED_INPUT_FLOOR)} input tokens go out with every request
                  </strong>
                  , measured: a two-token prompt was recorded at {fmt(MEASURED_INPUT_FLOOR)} input tokens. So a{" "}
                  {fmt(COMPUTE_STAKES[0].tiers[0].allowance)} token allowance is roughly{" "}
                  {fmt(approxRequests(COMPUTE_STAKES[0].tiers[0].allowance))} requests.
                </li>
                <li>
                  <strong className="text-ink">
                    Your own client will report {fmt(CLIENT_USAGE_BUFFER)} more input tokens per request than we count
                  </strong>
                  . That gap is not an estimate and it is not in our favour: the router adds a fixed{" "}
                  {fmt(CLIENT_USAGE_BUFFER)} token buffer to the usage it returns so clients that manage their own
                  context leave headroom. We meter the recorded figure, which is the lower one.
                </li>
                <li>
                  <strong className="text-ink">Enforcement runs on a sweep, not mid-request.</strong> Usage is read from
                  the router and a key is switched off once its allowance is spent, so a key can overshoot slightly
                  before it stops.
                </li>
                <li>
                  <strong className="text-ink">The allowance is policy, not a contract.</strong> Nothing on chain
                  promises compute. When metered billing arrives, what you can do today may change.
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-line bg-surface p-5">
              <div className="text-[13px] font-bold text-ink">What the stake contracts cannot do</div>
              <ul className="mt-2 space-y-2 text-[12px] leading-relaxed text-ink-soft">
                <li>
                  <strong className="text-ink">No owner.</strong> No pause, no upgrade, no emergency withdrawal, and no
                  function that can move somebody else&apos;s stake.
                </li>
                <li>
                  <strong className="text-ink">No lock period.</strong> Unstaking works immediately. The word
                  &quot;stake&quot; here does not promise a lock, and the contracts do not implement one.
                </li>
                <li>
                  <strong className="text-ink">Exit goes to you.</strong> The recipient is not a parameter — it is always
                  the caller.
                </li>
                <li>
                  <strong className="text-ink">Unstaking closes that token&apos;s key.</strong> Drop below the token&apos;s
                  minimum and the next sweep disables its key. Stake again and it comes back.
                </li>
              </ul>
            </div>
          </section>
        </details>
      </div>
    </div>
  );
}

/**
 * Satu token yang dicentang: stake-nya di chain token itu, dan kunci API-nya sendiri.
 *
 * Saldo dibaca lewat RPC chain token itu langsung, bukan lewat provider dompet: dompet bisa sedang
 * di chain lain, dan membaca saldo lewat dompet yang salah chain melaporkan nol dengan yakin.
 */
function StakeCard({
  src,
  row,
  configured,
  refresh,
}: {
  src: Source;
  row: StakeRow | null;
  configured: boolean;
  refresh: () => Promise<void>;
}) {
  const { address, isOnChain, switchToChain } = useWallet();
  const srcChain = chainOf(src.chainId);
  const where = `$${src.symbol} on ${src.chainName}`;
  /** Pasar hub: satu kontrak untuk semua pasar di chain ini, setiap panggilan menyebut tokennya. */
  const hub = src.kind === "hub";
  const budget = row?.budget ?? src.budget ?? null;

  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<"issue" | "revoke" | "stake" | "unstake" | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  /** Rahasia yang baru diterbitkan. Hanya ada di memori tab ini; tidak pernah dibaca ulang. */
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  /** Bawaannya stake minimum token ini: angka yang dicari hampir semua orang. */
  const [stakeAmount, setStakeAmount] = useState(String(src.minStake));
  const [stakeStep, setStakeStep] = useState<string | null>(null);

  const readBalance = useCallback(async () => {
    if (!address || !srcChain) return;
    try {
      const provider = new ethers.JsonRpcProvider(srcChain.rpcUrl, srcChain.chainId, { staticNetwork: true });
      const token = new ethers.Contract(src.token, ERC20_ABI, provider);
      const raw: bigint = await token.balanceOf(address);
      setBalance(Number(ethers.formatUnits(raw, src.decimals)));
    } catch {
      setBalance(null);
    }
  }, [address, srcChain, src.token, src.decimals]);

  useEffect(() => {
    void readBalance();
  }, [readBalance]);

  const refreshAll = async () => {
    await Promise.all([refresh(), readBalance()]);
  };

  const stakeAddress = src.contract;
  const staked = row?.staked ?? null;
  const effective = staked ?? 0;
  const tier = staked === null ? null : tierForStake(effective, src.tiers);
  const upcoming = nextTier(effective, src.tiers);
  const active = Boolean(stakeAddress) && staked !== null && effective >= src.minStake;
  const record = row?.key ?? null;
  const used = record ? record.usedInput + record.usedOutput : 0;
  const remaining = record ? Math.max(0, record.allowance - used) : 0;
  /** Dibulatkan ke BAWAH: melebih-lebihkan sisa jatah adalah arah salah yang lebih mahal. */
  const leftPct = record && record.allowance > 0 ? Math.floor((remaining / record.allowance) * 100) : 0;
  const headline = stakeAddress && staked !== null ? effective : balance ?? 0;

  /**
   * Approve lalu stake, dua transaksi, dengan langkahnya dilaporkan. Approve dilewati kalau plafonnya
   * sudah cukup, dan plafonnya diminta TEPAT sebesar jumlah yang di-stake, bukan tak terbatas.
   */
  const doStake = async () => {
    if (!stakeAddress || !srcChain) return;
    setBusy("stake");
    setKeyError(null);
    setStakeStep(null);
    try {
      const whole = Number(stakeAmount);
      if (!Number.isFinite(whole) || whole <= 0) throw new Error("Enter an amount to stake.");
      if (!isOnChain(src.chainId)) {
        setStakeStep(`Switching your wallet to ${src.chainName}…`);
        await switchToChain(srcChain);
      }
      const provider = new ethers.BrowserProvider(getActiveEip1193());
      const signer = await provider.getSigner();
      const amount = ethers.parseUnits(stakeAmount.trim(), src.decimals);
      const token = new ethers.Contract(src.token, ERC20_ABI, signer);
      const current: bigint = await token.allowance(await signer.getAddress(), stakeAddress);
      if (current < amount) {
        setStakeStep(`1 of 2 — approving the ${hub ? "stake hub" : "stake contract"} to move your $${src.symbol}…`);
        const ap = await token.approve(stakeAddress, amount);
        await ap.wait();
      }
      setStakeStep(current < amount ? "2 of 2 — staking…" : "Staking…");
      const tx = hub
        ? await new ethers.Contract(stakeAddress, STAKE_HUB_ABI, signer).stake(src.token, amount)
        : await new ethers.Contract(stakeAddress, STAKE_ABI, signer).stake(amount);
      await tx.wait();
      setStakeStep(`Staked. Your ${where} key can be issued now.`);
      await refreshAll();
    } catch (e) {
      setKeyError(describeTxError(e));
      setStakeStep(null);
    } finally {
      setBusy(null);
    }
  };

  /** Menarik seluruh posisi. Tanpa lock, jadi ini selalu berhasil selama ada posisinya. */
  const doUnstake = async () => {
    if (!stakeAddress || !srcChain) return;
    setBusy("unstake");
    setKeyError(null);
    setStakeStep(null);
    try {
      if (!isOnChain(src.chainId)) {
        setStakeStep(`Switching your wallet to ${src.chainName}…`);
        await switchToChain(srcChain);
      }
      const provider = new ethers.BrowserProvider(getActiveEip1193());
      const signer = await provider.getSigner();
      setStakeStep("Unstaking…");
      const tx = hub
        ? await new ethers.Contract(stakeAddress, STAKE_HUB_ABI, signer).unstakeAll(src.token)
        : await new ethers.Contract(stakeAddress, STAKE_ABI, signer).unstakeAll();
      await tx.wait();
      setStakeStep("Unstaked. This token's key stops working at the next sweep.");
      await refreshAll();
    } catch (e) {
      setKeyError(describeTxError(e));
      setStakeStep(null);
    } finally {
      setBusy(null);
    }
  };

  /** Menandatangani lalu menerbitkan. Pesannya menyebut token ini, jadi kuncinya milik token ini. */
  const issue = async () => {
    setBusy("issue");
    setKeyError(null);
    try {
      const provider = new ethers.BrowserProvider(getActiveEip1193());
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      const message = issueKeyMessage(AGENT_COMPUTE_ENDPOINT, signerAddress, Date.now(), src.id);
      const signature = await signer.signMessage(message);
      const res = await fetch("/api/agent/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: signerAddress, message, signature, stake: src.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `status ${res.status}`);
      setFreshSecret(String(json.key));
      await refresh();
    } catch (e) {
      setKeyError((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy("revoke");
    setKeyError(null);
    try {
      const provider = new ethers.BrowserProvider(getActiveEip1193());
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      const message = revokeKeyMessage(AGENT_COMPUTE_ENDPOINT, signerAddress, Date.now(), src.id);
      const signature = await signer.signMessage(message);
      const res = await fetch("/api/agent/keys", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: signerAddress, message, signature, stake: src.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `status ${res.status}`);
      setFreshSecret(null);
      await refresh();
    } catch (e) {
      setKeyError((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-6" aria-label={where} data-testid={`compute-stake-${src.id}`}>
      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        {/* ── stake token ini ───────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-bold text-ink">
              <span className="font-mono">${src.symbol}</span>{" "}
              <span className="font-normal text-ink-soft">{placeOf(src)}</span>
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${
                active ? "bg-ok/10 text-ok" : "bg-cream-3 text-ink-faint"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${active ? "bg-ok" : "bg-ink-faint"}`} />
              {active ? "Agent active" : "Agent inactive"}
            </span>
          </div>

          {!stakeAddress && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/[0.07] p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <p className="text-[12px] leading-relaxed text-ink-soft">
                <strong className="text-warn">{src.name} has no stake contract yet.</strong> Its market trades on{" "}
                {src.chainName}, but there is nothing to stake into there yet, so no key can be issued for it.
              </p>
            </div>
          )}

          <div className="mt-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              {stakeAddress ? `${src.symbol} staked` : `${src.symbol} balance on ${src.chainName}`}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[40px] font-bold leading-none tracking-tight text-ink">
                {row === null ? "…" : fmt(headline)}
              </span>
              <span className="font-mono text-[13px] font-bold text-ink-soft">{src.symbol}</span>
            </div>
            {row?.error && (
              <p className="mt-1.5 text-[11px] text-ink-faint">The stake could not be read just now. Refresh to try again.</p>
            )}
          </div>

          {record ? (
            <div className="mt-5">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                <span>Compute left</span>
                <span className="text-accent">{record.tierLabel ?? "no tier"}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[22px] font-bold leading-none tracking-tight text-ink">{fmt(remaining)}</span>
                  <span className="font-mono text-[11px] text-ink-soft">of {fmt(record.allowance)} tokens</span>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${
                    record.active ? "bg-accent-soft text-accent" : "bg-danger/10 text-danger"
                  }`}
                >
                  {leftPct}% left
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-cream-3">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${
                    record.active ? "bg-[linear-gradient(90deg,#7c3aed,#a78bfa)]" : "bg-[linear-gradient(90deg,#b91c1c,#ef4444)]"
                  }`}
                  style={{ width: `${leftPct}%` }}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 font-mono text-[11px] text-ink-soft">
                <span>
                  {fmt(used)} used ({fmt(record.usedInput)} in · {fmt(record.usedOutput)} out)
                </span>
                <span>
                  {fmt(record.requests)} req
                  {record.requests > 0 && <> · ~{fmt(Math.round(used / record.requests))}/req</>}
                </span>
              </div>
            </div>
          ) : hub ? (
            <div className="mt-5 rounded-xl bg-cream-2 p-3 text-[12px] leading-relaxed text-ink-soft">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                <span>Compute funded by trading</span>
                <span className="text-accent">Fee-funded</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-[22px] font-bold leading-none tracking-tight text-ink">
                  {budget?.budgetTokens == null ? "…" : fmt(budget.budgetTokens)}
                </span>
                <span className="font-mono text-[11px] text-ink-soft">model tokens paid for by this market so far</span>
              </div>
              <p className="mt-2">
                {HUB_COMPUTE_SHARE_BPS / 100}% of the 0.10% protocol fee this market&apos;s trades pay becomes compute for its
                stakers, shared by stake.
                {budget && budget.feesNative > 0 && (
                  <>
                    {" "}
                    Its curve has collected {budget.feesNative.toPrecision(3)} {budget.nativeSymbol} of protocol fees.
                  </>
                )}{" "}
                Your share starts with the fees that arrive after you issue this token&apos;s key, so the key opens with
                nothing, fills as the market trades, and switches on once at least one request&apos;s worth (
                {fmt(MEASURED_INPUT_FLOOR)} tokens) has accrued.
              </p>
            </div>
          ) : active && tier ? (
            <div className="mt-5">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                <span>Compute available</span>
                <span className="text-accent">{tier.label}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[22px] font-bold leading-none tracking-tight text-ink">{fmt(tier.allowance)}</span>
                  <span className="font-mono text-[11px] text-ink-soft">tokens, input plus output</span>
                </div>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-bold text-accent">100% left</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-cream-3">
                <div className="h-full w-full rounded-full bg-[linear-gradient(90deg,#7c3aed,#a78bfa)]" />
              </div>
              <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 font-mono text-[11px] text-ink-soft">
                <span>0 used so far</span>
                <span>≈{fmt(approxRequests(tier.allowance))} requests</span>
              </div>
              <div className="mt-1 text-[11px] text-ink-faint">Metering starts when you issue this token&apos;s key.</div>
            </div>
          ) : stakeAddress ? (
            <p className="mt-5 rounded-xl bg-cream-2 p-3 text-[12px] leading-relaxed text-ink-soft">
              {upcoming ? (
                <>
                  A stake of{" "}
                  <strong className="text-ink">
                    {fmt(upcoming.tier.stake)} {src.symbol}
                  </strong>{" "}
                  opens the {upcoming.tier.label} tier
                  {balance !== null && (
                    <>
                      {" "}
                      — you hold{" "}
                      <strong className="text-ink">
                        {fmt(balance)} {src.symbol}
                      </strong>{" "}
                      on {src.chainName}
                    </>
                  )}
                  .
                </>
              ) : (
                <>No allowance is open yet.</>
              )}
            </p>
          ) : null}

          {stakeAddress && (
            <div className="mt-5 rounded-xl border border-line bg-cream-2 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">Amount to stake</span>
                <div className="flex items-center gap-1">
                  {src.tiers.map((t) => {
                    const picked = Number(stakeAmount) === t.stake;
                    return (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => setStakeAmount(String(t.stake))}
                        aria-pressed={picked}
                        className={`rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ${
                          picked ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-surface text-ink-soft hover:text-ink"
                        }`}
                        title={`${t.label} — ${fmt(t.stake)} ${src.symbol}`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                  {balance !== null && balance > 0 && (
                    <button
                      type="button"
                      onClick={() => setStakeAmount(String(Math.floor(balance)))}
                      aria-pressed={Number(stakeAmount) === Math.floor(balance)}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ${
                        Number(stakeAmount) === Math.floor(balance)
                          ? "border-accent/40 bg-accent-soft text-accent"
                          : "border-line bg-surface text-ink-soft hover:text-ink"
                      }`}
                      title={`Everything you hold — ${fmt(Math.floor(balance))} ${src.symbol}`}
                    >
                      Max
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-[26px] font-bold tracking-tight text-ink placeholder:text-ink-faint/60 focus:outline-none"
                  placeholder="0"
                  aria-label={`Amount of ${src.symbol} to stake`}
                />
                <span className="shrink-0 font-mono text-[12px] font-bold text-ink-soft">{src.symbol}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="text-ink-faint">
                  {(() => {
                    const want = Number(stakeAmount);
                    if (!Number.isFinite(want) || want <= 0) return "Enter an amount.";
                    if (want < src.minStake && effective + want < src.minStake) {
                      return `Below the ${fmt(src.minStake)} minimum — the contract will reject it.`;
                    }
                    if (hub) return "Opens this market's agent, and compute funded by its trading.";
                    const t = tierForStake(effective + want, src.tiers);
                    return t
                      ? `Opens ${t.label}: ${fmt(t.allowance)} tokens ≈ ${fmt(approxRequests(t.allowance))} requests.`
                      : "No tier at this size.";
                  })()}
                </span>
                {balance !== null && (
                  <span className="font-mono text-ink-faint">
                    {fmt(balance)} {src.symbol} in wallet ·{" "}
                    <Link href={src.buyHref} className="font-bold text-accent hover:underline">
                      Buy ${src.symbol}
                    </Link>
                  </span>
                )}
              </div>
            </div>
          )}

          {stakeStep && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-soft">
              {busy === "stake" || busy === "unstake" ? (
                <Loader2 className="mt-px h-3 w-3 shrink-0 animate-spin text-accent" />
              ) : (
                <CheckCircle2 className="mt-px h-3 w-3 shrink-0 text-ok" />
              )}
              <span>{stakeStep}</span>
            </p>
          )}

          {stakeAddress ? (
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={doStake}
                disabled={busy !== null || !Number.isFinite(Number(stakeAmount)) || Number(stakeAmount) <= 0}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-bold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "stake" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {busy === "stake" ? "Staking…" : `Stake $${src.symbol}`}
              </button>
              {effective > 0 && (
                <button
                  type="button"
                  onClick={doUnstake}
                  disabled={busy !== null}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-[13px] font-bold text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                >
                  {busy === "unstake" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                  Unstake all
                </button>
              )}
            </div>
          ) : (
            <Link
              href={src.buyHref}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[12px] font-bold text-ink-soft hover:text-ink"
            >
              <ShoppingCart className="h-3.5 w-3.5" /> Trade ${src.symbol} on {src.chainName}
            </Link>
          )}
        </div>

        {/* ── kunci token ini ───────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            <span className="text-[13px] font-bold text-ink">Your API key</span>
            <span className="ml-auto font-mono text-[11px] text-ink-faint">{where}</span>
          </div>

          {freshSecret && (
            <div className="mt-3 rounded-xl border border-ok/40 bg-ok/[0.07] p-3">
              <div className="text-[11px] font-bold text-ok">Copy this now. It is shown once.</div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-ink">{freshSecret}</code>
                <CopyButton value={freshSecret} label="Copy your new API key" />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
                The server does not keep it, so it cannot be shown again. Lose it and you revoke and reissue.
              </p>
            </div>
          )}

          {record ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-[12px] text-ink">{record.keyPrefix}…</code>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                    record.active ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${record.active ? "bg-ok" : "bg-danger"}`} />
                  {record.active ? "Active" : "Disabled"}
                </span>
              </div>
              {record.disabledReason && (
                <p className="flex items-start gap-1.5 rounded-xl bg-danger/[0.07] p-2.5 text-[11px] leading-relaxed text-ink-soft">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-danger" />
                  <span>{record.disabledReason}</span>
                </p>
              )}
              <dl className="space-y-1.5 font-mono text-[11px]">
                {[
                  ["Opened by", `your ${where} stake`],
                  ...(hub ? [["Funded by", `${HUB_COMPUTE_SHARE_BPS / 100}% of this market's protocol fee`]] : []),
                  [hub ? "Accrued" : "Allowance", `${fmt(record.allowance)} tokens`],
                  ["Remaining", `${fmt(remaining)} tokens · ${leftPct}%`],
                  ["Requests", fmt(record.requests)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-ink-faint">{k}</dt>
                    <dd className={k === "Remaining" ? "font-bold text-ink" : "text-ink-soft"}>{v}</dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                onClick={revoke}
                disabled={busy !== null}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-danger/40 bg-surface text-[12px] font-bold text-danger transition-colors hover:bg-danger/[0.06] disabled:opacity-50"
              >
                {busy === "revoke" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Revoke this key
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-[12px] leading-relaxed text-ink-soft">
                {!stakeAddress
                  ? `A key for ${where} opens once its stake contract exists.`
                  : !configured
                    ? "Key issuance is not configured on this server yet."
                    : !active
                      ? `Stake at least ${fmt(src.minStake)} ${src.symbol} on ${src.chainName} to open this key.`
                      : hub
                        ? `Your ${where} stake opens a key whose allowance grows with this market's trading. Sign one message to issue it, bound to your address.`
                        : `Your ${where} stake opens ${tier?.label ?? "a tier"}. Sign one message to issue the key, bound to your address.`}
              </p>
              <button
                type="button"
                onClick={issue}
                disabled={!active || busy !== null || !configured}
                className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-bold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "issue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Create API key
              </button>
            </div>
          )}

          {keyError && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-danger">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span>{keyError}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
