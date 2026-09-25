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
  BETA_TOKEN_CEILING,
  CLIENT_USAGE_BUFFER,
  COMPUTE_TIERS,
  MEASURED_INPUT_FLOOR,
  MIN_STAKE_ADEXTO,
  STAKE_TOKEN,
  approxRequests,
  nextTier,
  stakeContractFor,
  tierForStake,
} from "@/config/agent-compute";

/**
 * Agent Compute: stake $ADEXTO, terima kunci API, belanjakan jatah token.
 *
 * APA YANG DIJUAL HALAMAN INI, DAN KENAPA BENTUKNYA BEGINI
 *
 * Yang dibagikan adalah POOL INFERENSI, bukan kotak chat. Pemegang stake memanggil
 * `https://compute.adexto.xyz/v1` dari kode mereka sendiri dengan kunci mereka sendiri. Jadi hal
 * paling penting di halaman ini bukan angka stake — melainkan tiga baris yang bisa ditempel ke
 * terminal: endpoint, nama model, dan kuncinya. Versi sebelumnya tidak punya satu pun dari itu.
 *
 * APA YANG NYATA HARI INI, DAN APA YANG BELUM
 *
 * Nyata dan terukur: endpointnya melayani `0g/deepseek-v4-flash` (200, dengan
 * `x_0g_trace.provider` menunjuk penyedia 0G), dan router mencatat input serta output per kunci
 * sehingga jatah bisa ditegakkan.
 *
 * Belum: kontrak `AdextoAgentStake`. Ia ada di source dan sudah diuji tetapi belum di-deploy —
 * menunggu siaran generasi 0.12.0 (runbook §1i). Tanpa kontrak itu tidak ada angka stake yang
 * bisa dibaca, jadi tidak ada tingkatan yang bisa ditetapkan dan TIDAK ADA kunci yang boleh
 * keluar. Halaman mengatakan itu apa adanya alih-alih menampilkan `0 ADEXTO STAKED`, sebab "kamu
 * belum stake" dan "belum ada tempat untuk stake" adalah dua keadaan berbeda dan yang pertama
 * menyalahkan pengguna atas sesuatu yang belum dikirim.
 */

const ZERO_G: ChainInfo | undefined = CHAIN_LIST.find((c) => c.chainId === STAKE_TOKEN.chainId);

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

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
  lastSweepAt: string | null;
};

type KeyStatus = {
  configured: boolean;
  durable: boolean;
  endpoint: string;
  model: string;
  stakeContract: string | null;
  minStake: number;
  address: string | null;
  staked: number | null;
  stakeError?: string | null;
  tier: { label: string; stake: number; allowance: number } | null;
  key: KeyRecord | null;
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
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-2 text-[11px] font-bold text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
    >
      {done ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** ABI stake, hanya yang dipakai halaman ini. */
const STAKE_ABI = [
  "function stake(uint256 amount)",
  "function unstakeAll()",
  "function stakedOf(address) view returns (uint256)",
  "function minStake() view returns (uint256)",
];

export default function AgentComputePanel() {
  const { address, isConnected, connectWallet, isConnecting, isOnChain, switchToChain } = useWallet();

  const [balance, setBalance] = useState<number | null>(null);
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const [busy, setBusy] = useState<"issue" | "revoke" | "stake" | "unstake" | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  /** Rahasia yang baru diterbitkan. Hanya ada di memori tab ini; tidak pernah dibaca ulang. */
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  /**
   * Jumlah yang akan di-stake.
   *
   * Sebelum ini tidak ada kolom sama sekali — tombolnya mati dengan keterangan "kontrak belum
   * di-deploy", dan keterangan itu bertahan setelah kontraknya di-chain. Jadi halaman punya tombol
   * stake yang tidak pernah bisa stake, dan tidak ada tempat untuk mengetik angkanya.
   *
   * Bawaannya stake minimum, bukan kosong: angka itu yang dicari hampir semua orang yang membuka
   * halaman ini, dan mengisinya lebih dulu menghapus satu langkah tanpa memutuskan apa pun untuk
   * pengguna — kolomnya tetap bisa diubah.
   */
  const [stakeAmount, setStakeAmount] = useState(String(MIN_STAKE_ADEXTO));
  const [stakeStep, setStakeStep] = useState<string | null>(null);

  const [ping, setPing] = useState<{ ok: boolean; ms: number; status: number } | null>(null);

  const stakeAddress = stakeContractFor(STAKE_TOKEN.chainId);

  /**
   * Saldo dibaca lewat RPC 0G langsung, bukan lewat provider dompet.
   *
   * Dompet bisa berada di chain lain sementara halaman ini selalu bicara tentang 0G mainnet.
   * Memakai provider dompet akan membaca saldo di chain yang salah dan melaporkan nol dengan
   * yakin — kelas kesalahan yang paling sulit terlihat, karena ia tidak melempar apa pun.
   *
   * Stake dan keadaan kunci datang dari `/api/agent/keys`, bukan dari RPC di sini, karena
   * penegakan jatah memakai angka yang SERVER baca. Dua pembacaan yang berbeda untuk angka yang
   * sama hanya akan berselisih, dan yang terlihat di halaman akan jadi yang salah.
   */
  const read = useCallback(async () => {
    if (!address || !ZERO_G) return;
    setLoading(true);
    setReadError(null);
    try {
      const [bal, stat] = await Promise.allSettled([
        (async () => {
          const provider = new ethers.JsonRpcProvider(ZERO_G.rpcUrl, ZERO_G.chainId, {
            staticNetwork: true,
          });
          const token = new ethers.Contract(STAKE_TOKEN.address, ERC20_ABI, provider);
          const raw: bigint = await token.balanceOf(address);
          return Number(ethers.formatUnits(raw, STAKE_TOKEN.decimals));
        })(),
        (async () => {
          const res = await fetch(`/api/agent/keys?address=${address}`, { cache: "no-store" });
          if (!res.ok) throw new Error(`status ${res.status}`);
          return (await res.json()) as KeyStatus;
        })(),
      ]);

      if (bal.status === "fulfilled") setBalance(bal.value);
      else setReadError(String(bal.reason).slice(0, 120));

      if (stat.status === "fulfilled") setStatus(stat.value);
      else setReadError((prev) => prev || `Key status unavailable: ${String(stat.reason).slice(0, 90)}`);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void read();
  }, [read]);

  /**
   * Ping endpoint, diukur dan diberi label apa adanya.
   *
   * Yang diukur adalah waktu bolak-balik dari SERVER ini ke health check router, bukan dari
   * peramban pengunjung dan bukan latensi inferensi. Ketiganya angka yang berbeda, dan menampilkan
   * satu lalu menyiratkan yang lain adalah cara paling murah membuat indikator yang menyesatkan.
   * Labelnya di UI menyebut mana yang mana.
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

  const staked = status?.staked ?? null;
  const effective = staked ?? 0;
  const tier = staked === null ? null : tierForStake(effective);
  const upcoming = nextTier(effective);
  const active = Boolean(stakeAddress) && staked !== null && effective >= MIN_STAKE_ADEXTO;
  const record = status?.key ?? null;
  const used = record ? record.usedInput + record.usedOutput : 0;
  const headline = stakeAddress && staked !== null ? effective : balance ?? 0;

  const zeroG = ZERO_G;

  /**
   * Approve lalu stake, dua transaksi, dengan langkahnya dilaporkan.
   *
   * ERC-20 menuntut approve terpisah, dan approve dilewati kalau plafonnya sudah cukup — mengirim
   * approve yang tidak perlu membakar gas dan membuat pengguna menandatangani dua kali untuk satu
   * niat. Plafonnya diminta TEPAT sebesar jumlah yang di-stake, bukan tak terbatas: kontraknya
   * tanpa pemilik dan tidak bisa di-upgrade, tapi plafon tak terbatas tetap kebiasaan yang tidak
   * perlu diajarkan ke pengguna.
   */
  const doStake = async () => {
    if (!stakeAddress || !zeroG) return;
    setBusy("stake");
    setKeyError(null);
    setStakeStep(null);
    try {
      const whole = Number(stakeAmount);
      if (!Number.isFinite(whole) || whole <= 0) throw new Error("Enter an amount to stake.");

      // Dompet harus di 0G. Tanpa ini transaksinya terkirim ke chain lain dan gagal dengan galat
      // yang tidak menyebutkan chain sama sekali.
      if (!isOnChain(STAKE_TOKEN.chainId)) {
        setStakeStep("Switching your wallet to 0G…");
        await switchToChain(zeroG);
      }

      const provider = new ethers.BrowserProvider(getActiveEip1193());
      const signer = await provider.getSigner();
      const amount = ethers.parseUnits(stakeAmount.trim(), STAKE_TOKEN.decimals);

      const token = new ethers.Contract(STAKE_TOKEN.address, ERC20_ABI, signer);
      const current: bigint = await token.allowance(await signer.getAddress(), stakeAddress);
      if (current < amount) {
        setStakeStep("1 of 2 — approving the stake contract to move your $ADEXTO…");
        const ap = await token.approve(stakeAddress, amount);
        await ap.wait();
      }

      setStakeStep(
        current < amount ? "2 of 2 — staking…" : "Staking…"
      );
      const stake = new ethers.Contract(stakeAddress, STAKE_ABI, signer);
      const tx = await stake.stake(amount);
      await tx.wait();

      setStakeStep("Staked. Your agent is active.");
      await read();
    } catch (e) {
      setKeyError(describeTxError(e));
      setStakeStep(null);
    } finally {
      setBusy(null);
    }
  };

  /** Menarik seluruh posisi. Tanpa lock, jadi ini selalu berhasil selama ada posisinya. */
  const doUnstake = async () => {
    if (!stakeAddress || !zeroG) return;
    setBusy("unstake");
    setKeyError(null);
    setStakeStep(null);
    try {
      if (!isOnChain(STAKE_TOKEN.chainId)) {
        setStakeStep("Switching your wallet to 0G…");
        await switchToChain(zeroG);
      }
      const provider = new ethers.BrowserProvider(getActiveEip1193());
      const signer = await provider.getSigner();
      setStakeStep("Unstaking…");
      const stake = new ethers.Contract(stakeAddress, STAKE_ABI, signer);
      const tx = await stake.unstakeAll();
      await tx.wait();
      setStakeStep("Unstaked. Your key stops working at the next sweep.");
      await read();
    } catch (e) {
      setKeyError(describeTxError(e));
      setStakeStep(null);
    } finally {
      setBusy(null);
    }
  };

  /** Menandatangani lalu menerbitkan. Rahasia hanya dikembalikan sekali, jadi ia ditahan di state. */
  const issue = async () => {
    setBusy("issue");
    setKeyError(null);
    try {
      const provider = new ethers.BrowserProvider(getActiveEip1193());
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      const message = issueKeyMessage(AGENT_COMPUTE_ENDPOINT, signerAddress);
      const signature = await signer.signMessage(message);

      const res = await fetch("/api/agent/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: signerAddress, message, signature }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `status ${res.status}`);
      setFreshSecret(String(json.key));
      await read();
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
      const message = revokeKeyMessage(AGENT_COMPUTE_ENDPOINT, signerAddress);
      const signature = await signer.signMessage(message);

      const res = await fetch("/api/agent/keys", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: signerAddress, message, signature }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `status ${res.status}`);
      setFreshSecret(null);
      await read();
    } catch (e) {
      setKeyError((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  /**
   * `"stream": false` DITULIS EKSPLISIT, dan menghilangkannya adalah bug yang sempat kami
   * sajikan di halaman ini.
   *
   * Diukur: tanpa field `stream`, router membalas `content-type: text/event-stream` dan
   * menempelkan `data: [DONE]` di belakang objek JSON-nya, sehingga `JSON.parse` pada body
   * itu GAGAL — jadi contoh yang kami tampilkan tidak bisa dipakai oleh SDK mana pun yang
   * mem-parse respons. Dengan `"stream": false` balasannya `application/json` yang bersih.
   *
   * Contohnya dipecah per baris supaya tetap bisa ditempel apa adanya ke shell.
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
            Stake $ADEXTO, get your own API key, and call {AGENT_COMPUTE_MODEL_LABEL} from your code.
            OpenAI-compatible, served by 0G Compute.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <Link
              href={`/token/adexto?chain=${STAKE_TOKEN.chainId}&tf=60`}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-[13px] font-bold text-[#2e0f63] transition-colors hover:bg-white/90"
            >
              <ShoppingCart className="h-4 w-4" /> Buy $ADEXTO
            </Link>
            <a
              href="#endpoint"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-5 text-[13px] font-bold text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              See the endpoint <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          {/* Tiga sifat, dibuat ringan: teks putih transparan tanpa kotak, supaya tidak menyaingi
              judulnya sendiri. */}
          <div className="mt-8 grid max-w-2xl gap-x-6 gap-y-3 text-[12px] text-white/70 sm:grid-cols-3">
            {[
              ["Your key", "Issued to your address."],
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
                  Until it does there is no stake to read, so no tier can be assigned and no key can be
                  issued. Nothing below stands in for a position you hold.
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
                <span>{readError}</span>
              </p>
            )}

            {/* Jatah digambar dari pemakaian NYATA kalau kuncinya ada, dan dari tingkatan kalau
                belum. Dua keadaan itu tidak boleh terlihat sama: yang satu mengukur, yang lain
                menjanjikan. */}
            {record ? (
              <div className="mt-5">
                {/* SISA yang jadi angka utama, bukan yang terpakai.
                    Keduanya informasi yang sama secara aritmetika, tapi bukan pertanyaan yang
                    sama: orang yang membuka halaman ini ingin tahu berapa yang MASIH BISA
                    dipakai, dan memaksa mereka mengurangi sendiri dari plafon adalah pekerjaan
                    yang seharusnya dilakukan halaman. Yang terpakai tetap ada di bawah. */}
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                  <span>Compute left</span>
                  <span className="text-accent">{record.tierLabel ?? "no tier"}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-[22px] font-bold leading-none tracking-tight text-ink">
                    {fmt(Math.max(0, record.allowance - used))}
                  </span>
                  <span className="font-mono text-[11px] text-ink-soft">
                    of {fmt(record.allowance)} tokens
                  </span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-cream-3">
                  <div
                    className={`h-full rounded-full ${
                      record.active
                        ? "bg-[linear-gradient(90deg,#7c3aed,#a78bfa)]"
                        : "bg-[linear-gradient(90deg,#b91c1c,#ef4444)]"
                    }`}
                    style={{
                      width: `${record.allowance > 0 ? Math.min(100, (used / record.allowance) * 100) : 100}%`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 font-mono text-[11px] text-ink-soft">
                  <span>
                    {fmt(used)} used ({fmt(record.usedInput)} in · {fmt(record.usedOutput)} out)
                  </span>
                  <span>
                    {fmt(record.requests)} req
                    {record.requests > 0 && (
                      <> · ~{fmt(Math.round(used / record.requests))}/req</>
                    )}
                  </span>
                </div>
                {/* Sisa permintaan diperkirakan dari pemakaian NYATA kunci ini, bukan dari
                    lantai terukur global — begitu ada riwayat, rata-rata sendiri lebih dekat
                    ke kenyataan daripada angka rata-rata orang lain. */}
                {record.requests > 0 && (
                  <div className="mt-1 font-mono text-[11px] text-ink-faint">
                    ≈{fmt(Math.floor(Math.max(0, record.allowance - used) / Math.max(1, Math.round(used / record.requests))))}{" "}
                    more requests at your current average
                  </div>
                )}
              </div>
            ) : active && tier ? (
              <div className="mt-5">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                  <span>Allowance this stake opens</span>
                  <span className="text-accent">{tier.label}</span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-cream-3">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#7c3aed,#a78bfa)]"
                    style={{ width: `${Math.min(100, (tier.allowance / BETA_TOKEN_CEILING) * 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between font-mono text-[11px] text-ink-soft">
                  <span>{fmt(tier.allowance)} tokens, input plus output</span>
                  <span>≈{fmt(approxRequests(tier.allowance))} requests</span>
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
                        {/* Satuannya DISEBUT. Tanpa "ADEXTO", "you hold 11,491 on 0G" terbaca
                            sebagai 11.491 0G — aset yang berbeda, dan di halaman yang sisanya
                            bicara tentang harga 0G itu bukan salah baca yang jauh. */}
                        — you hold <strong className="text-ink">{fmt(balance)} ADEXTO</strong> on 0G
                      </>
                    )}
                    .
                  </>
                ) : (
                  <>No allowance is open yet.</>
                )}
              </p>
            )}

            {/* ── kolom jumlah stake ──────────────────────────────────────────
                Hanya digambar kalau ADA kontrak untuk stake. Sebelumnya tombolnya selalu ada
                dan selalu mati, yang mengiklankan aksi yang tidak pernah bisa dijalankan. */}
            {isConnected && stakeAddress && (
              <div className="mt-5 rounded-xl border border-line bg-cream-2 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                    Amount to stake
                  </span>
                  {/* Keempat tombol memakai NAMA TINGKATAN, bukan "Min" untuk yang pertama.
                      Yang pertama memang stake minimum, tapi menamainya berbeda dari tiga
                      lainnya membuat satu deretan terbaca seperti dua jenis kontrol, dan
                      menyembunyikan bahwa jumlah minimum itu justru tingkatan Starter.

                      SOROTANNYA MENGIKUTI KOLOM, bukan dipaku ke satu tombol. Sebelum ini `Max`
                      memakai gaya accent secara hardcoded, jadi ia terlihat terpilih selamanya —
                      kolom berisi 25.000 sementara `Max` menyala ungu. Satu kontrol yang selalu
                      terlihat aktif lebih buruk daripada tidak ada sorotan sama sekali, karena ia
                      memberi tahu keadaan yang salah dengan penuh keyakinan. */}
                  <div className="flex items-center gap-1">
                    {COMPUTE_TIERS.map((t) => {
                      const picked = Number(stakeAmount) === t.stake;
                      return (
                        <button
                          key={t.label}
                          type="button"
                          onClick={() => setStakeAmount(String(t.stake))}
                          aria-pressed={picked}
                          // Tingkatan yang tidak terjangkau saldo tetap bisa diklik: ia memberi tahu
                          // berapa yang dibutuhkan, dan menyembunyikannya hanya menyembunyikan
                          // informasi yang justru dicari orang.
                          className={`rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ${
                            picked
                              ? "border-accent/40 bg-accent-soft text-accent"
                              : "border-line bg-white text-ink-soft hover:text-ink"
                          }`}
                          title={`${t.label} — ${fmt(t.stake)} ADEXTO`}
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
                            : "border-line bg-white text-ink-soft hover:text-ink"
                        }`}
                        title={`Everything you hold — ${fmt(Math.floor(balance))} ADEXTO`}
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
                    aria-label="Amount of ADEXTO to stake"
                  />
                  <span className="shrink-0 font-mono text-[12px] font-bold text-ink-soft">ADEXTO</span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-ink-faint">
                    {(() => {
                      const want = Number(stakeAmount);
                      if (!Number.isFinite(want) || want <= 0) return "Enter an amount.";
                      if (want < MIN_STAKE_ADEXTO && effective + want < MIN_STAKE_ADEXTO) {
                        return `Below the ${fmt(MIN_STAKE_ADEXTO)} minimum — the contract will reject it.`;
                      }
                      const t = tierForStake(effective + want);
                      return t
                        ? `Opens ${t.label}: ${fmt(t.allowance)} tokens ≈ ${fmt(approxRequests(t.allowance))} requests.`
                        : "No tier at this size.";
                    })()}
                  </span>
                  {balance !== null && (
                    <span className="font-mono text-ink-faint">
                      {fmt(balance)} ADEXTO in wallet
                    </span>
                  )}
                </div>

                {balance !== null && Number(stakeAmount) > balance && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warn">
                    <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                    <span>
                      You hold {fmt(balance)} ADEXTO on 0G.{" "}
                      <Link
                        href={`/token/adexto?chain=${STAKE_TOKEN.chainId}&tf=60`}
                        className="font-bold underline"
                      >
                        Buy more
                      </Link>{" "}
                      — on the buy screen you can type the ADEXTO amount you want and it works out
                      the 0G.
                    </span>
                  </p>
                )}
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

            <div className="mt-5 flex flex-wrap gap-2">
              {isConnected ? (
                <>
                  <button
                    type="button"
                    onClick={doStake}
                    disabled={
                      !stakeAddress ||
                      busy !== null ||
                      !Number.isFinite(Number(stakeAmount)) ||
                      Number(stakeAmount) <= 0
                    }
                    title={
                      stakeAddress
                        ? undefined
                        : "The stake contract is not deployed on 0G yet."
                    }
                    className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-bold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy === "stake" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {busy === "stake" ? "Staking…" : "Stake and activate"}
                  </button>
                  {effective > 0 && (
                    <button
                      type="button"
                      onClick={doUnstake}
                      disabled={busy !== null}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 text-[13px] font-bold text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                    >
                      {busy === "unstake" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Undo2 className="h-4 w-4" />
                      )}
                      Unstake all
                    </button>
                  )}
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
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold text-ink">0G Compute</span>
                    {/* Label menyebut yang diukur: origin → router, bukan latensi model dan bukan
                        latensi peramban pembaca. Angka tanpa keterangan itu akan dibaca sebagai
                        kecepatan model. */}
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

        {/* ── endpoint dan kunci ────────────────────────────────────────────── */}
        <section id="endpoint" className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Your endpoint</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
            OpenAI-compatible. Point any client that speaks{" "}
            <code className="rounded bg-cream-3 px-1 py-0.5 font-mono text-[11px]">
              /chat/completions
            </code>{" "}
            at it and send your key as a bearer token.
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_400px]">
            <div className="overflow-hidden rounded-2xl border border-line bg-white">
              <div className="flex items-center gap-2 border-b border-line bg-cream-2 px-4 py-2.5">
                <Terminal className="h-3.5 w-3.5 text-ink-faint" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                  Example request
                </span>
                <span className="ml-auto">
                  <CopyButton value={curl} label="Copy the example request" />
                </span>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-ink-soft">
                {curl}
              </pre>
              {/* Catatan streaming, dengan angka yang diukur bukan dikira-kira. Tanpa ini
                  klien streaming yang naif terlihat rusak selama hampir tiga detik, karena
                  model mengirim ratusan frame `reasoning_content` sebelum kalimat pertamanya. */}
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
                  Read only <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">delta.content</code>. Thinking is
                  on by default, so the model sends a long run of{" "}
                  <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">delta.reasoning_content</code> first —
                  measured at 140 reasoning frames before the first answer token, 2.8s in. Sending{" "}
                  <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">&quot;enable_thinking&quot;: false</code>{" "}
                  removed them entirely and brought the first token forward to 1.7s.
                </p>
                <p>
                  Keep <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">&quot;stream&quot;</code> in the body
                  either way. Omit it and the reply arrives as JSON with an SSE terminator glued to
                  the end, which no JSON parser accepts.
                </p>
              </div>

              <div className="space-y-2 border-t border-line px-4 py-3">
                {[
                  ["Base URL", AGENT_COMPUTE_ENDPOINT],
                  ["Model", AGENT_COMPUTE_MODEL],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                      {k}
                    </span>
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">{v}</code>
                    <CopyButton value={v} label={`Copy the ${k}`} />
                  </div>
                ))}
              </div>
            </div>

            {/* ── kunci ───────────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-line bg-white p-5">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-accent" />
                <span className="text-[13px] font-bold text-ink">Your API key</span>
              </div>

              {freshSecret && (
                <div className="mt-3 rounded-xl border border-ok/40 bg-ok/[0.07] p-3">
                  <div className="text-[11px] font-bold text-ok">
                    Copy this now. It is shown once.
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-ink">
                      {freshSecret}
                    </code>
                    <CopyButton value={freshSecret} label="Copy your new API key" />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
                    The server does not keep it, so it cannot be shown again. Lose it and you revoke
                    and reissue.
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
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${record.active ? "bg-ok" : "bg-danger"}`}
                      />
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
                      ["Input", `${fmt(record.usedInput)} tokens`],
                      ["Output", `${fmt(record.usedOutput)} tokens`],
                      ["Allowance", `${fmt(record.allowance)} tokens`],
                      // Sisa ditampilkan sebagai barisnya sendiri, bukan diserahkan ke pembaca
                      // untuk dihitung dari dua baris di atasnya.
                      ["Remaining", `${fmt(Math.max(0, record.allowance - used))} tokens`],
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
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-danger/40 bg-white text-[12px] font-bold text-danger transition-colors hover:bg-danger/[0.06] disabled:opacity-50"
                  >
                    {busy === "revoke" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Revoke key
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="text-[12px] leading-relaxed text-ink-soft">
                    {/* Urutannya disengaja: sebutkan penghalang yang PALING mendasar dulu.
                        Kontrak stake yang belum ada mengalahkan konfigurasi server, karena
                        memperbaiki konfigurasi tidak akan mengubah apa pun selama tidak ada
                        stake yang bisa dibaca. */}
                    {!isConnected
                      ? "Connect a wallet to see whether your stake opens a key."
                      : !stakeAddress
                        ? "Keys unlock when the stake contract ships. There is no stake to read until then."
                        : status && !status.configured
                          ? "Key issuance is not configured on this server yet."
                          : !active
                            ? `A stake of at least ${fmt(MIN_STAKE_ADEXTO)} ADEXTO is required.`
                            : "Sign a message with your wallet to issue a key bound to your address."}
                  </p>
                  <button
                    type="button"
                    onClick={issue}
                    disabled={!isConnected || !active || busy !== null || !status?.configured}
                    className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-bold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy === "issue" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
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

        {/* ── tangga tingkatan ──────────────────────────────────────────────── */}
        <section id="tiers" className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Stake tiers</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
            Allowances count input plus output tokens, cumulative from the day your key is issued.
            The stake is guaranteed on chain; the allowance is protocol policy, kept off chain so it
            can be corrected without touching a contract that holds your tokens.
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
                    {fmt(t.allowance / 1000)}
                    <span className="ml-1 text-[12px] font-bold text-ink-soft">k tokens</span>
                  </div>

                  {/* Bar menunjukkan porsi plafon beta, jadi perbandingan antar tingkatan
                      terlihat tanpa membaca angkanya. */}
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream-3">
                    <div
                      className={`h-full rounded-full ${reached ? "bg-accent" : "bg-line-strong"}`}
                      style={{ width: `${(t.allowance / BETA_TOKEN_CEILING) * 100}%` }}
                    />
                  </div>

                  <div className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-ink-soft">
                    <Layers className="h-3 w-3" />
                    {fmt(t.stake)} ADEXTO
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-ink-faint">
                    ≈{fmt(approxRequests(t.allowance))} requests
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
              { n: "03", icon: <KeyRound className="h-4 w-4" />, t: "Sign for a key", d: "Bound to your address." },
              { n: "04", icon: <Cpu className="h-4 w-4" />, t: "Call the endpoint", d: "From your own code." },
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
              <AlertTriangle className="h-4 w-4" /> How the meter really behaves
            </div>
            <ul className="mt-2 space-y-2 text-[12px] leading-relaxed text-ink-soft">
              <li>
                <strong className="text-ink">
                  About {fmt(MEASURED_INPUT_FLOOR)} input tokens go out with every request
                </strong>
                , measured: a two-token prompt was recorded at {fmt(MEASURED_INPUT_FLOOR)} input
                tokens. So a {fmt(COMPUTE_TIERS[0].allowance)} token allowance is roughly{" "}
                {fmt(approxRequests(COMPUTE_TIERS[0].allowance))} requests.
              </li>
              <li>
                <strong className="text-ink">
                  Your own client will report {fmt(CLIENT_USAGE_BUFFER)} more input tokens per
                  request than we count
                </strong>
                . That gap is not an estimate and it is not in our favour: the router adds a fixed{" "}
                {fmt(CLIENT_USAGE_BUFFER)} token buffer to the usage it returns so clients that
                manage their own context leave headroom. We meter the recorded figure, which is the
                lower one.
              </li>
              <li>
                <strong className="text-ink">Enforcement runs on a sweep, not mid-request.</strong>{" "}
                Usage is read from the router and your key is switched off once the allowance is
                spent, so a key can overshoot slightly before it stops.
              </li>
              <li>
                <strong className="text-ink">The allowance is policy, not a contract.</strong> Nothing
                on chain promises compute. When metered billing arrives, what you can do today may
                change.
              </li>
            </ul>
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
              <li>
                <strong className="text-ink">Unstaking closes the key.</strong> Drop below{" "}
                {fmt(MIN_STAKE_ADEXTO)} ADEXTO and the next sweep disables it. Stake again and it comes
                back.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
