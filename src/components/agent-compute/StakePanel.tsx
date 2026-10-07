"use client";
/**
 * Isi laci stake untuk SATU token: angka-angkanya, stake/unstake, kunci API, dan cara memakainya.
 *
 * Logika transaksinya dipindah utuh dari `StakeCard` lama di `AgentComputePanel.tsx` (7 Okt):
 *   - stake = approve SEJUMLAH yang di-stake (dilewati bila plafonnya cukup), lalu stake; hub
 *     menyebut tokennya di setiap panggilan, AdextoAgentStake tidak;
 *   - unstake = `unstakeAll`, selalu ke pemanggil, tanpa lock;
 *   - kunci = satu tanda tangan EIP-191 yang menyebut token ini, rahasia tampil SEKALI.
 * Yang berubah hanya bentuknya: satu kolom berurutan (1 Stake → 2 Kunci → 3 Pakai) yang muat di
 * laci 480 px maupun lembar ponsel 320 px, dan angka pasar (total stake, staker, compute yang
 * dibiayai) ditampilkan SEBELUM dompet tersambung, supaya pengunjung bisa memutuskan dulu.
 *
 * Saldo dompet dibaca lewat RPC chain token itu langsung, bukan lewat provider dompet: dompet bisa
 * sedang di chain lain, dan membaca saldo lewat dompet yang salah chain melaporkan nol dengan yakin.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { AlertTriangle, Check, CheckCircle2, Copy, KeyRound, Loader2, Play, ShoppingCart, Trash2, Undo2, Wallet } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { CHAIN_LIST, readProvider } from "@/lib/chains";
import { ERC20_ABI, describeTxError } from "@/lib/dex";
import { issueKeyMessage, revokeKeyMessage } from "@/lib/agent-compute-message";
import { AGENT_COMPUTE_ENDPOINT, AGENT_COMPUTE_MODEL, MEASURED_INPUT_FLOOR, approxRequests, nextTier, tierForStake } from "@/config/agent-compute";
import { STAKE_HUB_ABI } from "@/config/stake-hubs";
import CopyField from "@/components/ui/CopyField";
import { fmt, fmtShort, type SourceView, type WalletRow } from "@/components/agent-compute/types";

/** ABI stake untuk empat sumber bertingkat (AdextoAgentStake). Pasar hub memakai STAKE_HUB_ABI. */
const STAKE_ABI = ["function stake(uint256 amount)", "function unstakeAll()"];

function StepHead({ n, title, done, note }: { n: number; title: string; done?: boolean; note?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
          done ? "bg-ok/15 text-ok" : "bg-accent-soft text-accent"
        }`}
      >
        {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : n}
      </span>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {done && <span className="sr-only">(done)</span>}
      {note && <span className="text-[12px] text-ink-faint">{note}</span>}
    </div>
  );
}

function SecretBox({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-ok/40 bg-ok/[0.07] p-3" role="status">
      <p className="text-[12px] font-semibold text-ok">Copy this key now. It is shown once.</p>
      <div className="mt-2 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">{secret}</code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(secret);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            } catch {
              // Clipboard ditolak: kuncinya tetap terlihat dan bisa dipilih manual.
            }
          }}
          aria-label="Copy your new API key"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink-soft hover:text-ink"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-ok" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
        ADEXTO does not keep it, so it cannot be shown again. If you lose it, revoke it and create a new one.
      </p>
    </div>
  );
}

export default function StakePanel({
  src,
  row,
  configured,
  refresh,
  onShowExamples,
}: {
  src: SourceView;
  /** null: dompet belum tersambung, atau barisnya belum terbaca. */
  row: WalletRow | null;
  configured: boolean;
  refresh: () => Promise<void>;
  onShowExamples: () => void;
}) {
  const { address, isConnected, connectWallet, isConnecting, isOnChain, switchToChain } = useWallet();
  const srcChain = CHAIN_LIST.find((c) => c.chainId === src.chainId);
  const where = `$${src.symbol} on ${src.chainName}`;
  const hub = src.kind === "hub";

  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<"issue" | "revoke" | "stake" | "unstake" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Rahasia yang baru diterbitkan. Hanya ada di memori tab ini; tidak pernah dibaca ulang. */
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  /** Bawaannya stake minimum token ini: angka yang dicari hampir semua orang. */
  const [stakeAmount, setStakeAmount] = useState(String(src.minStake));
  const [stakeStep, setStakeStep] = useState<string | null>(null);

  useEffect(() => {
    setStakeAmount(String(src.minStake));
    setFreshSecret(null);
    setError(null);
    setStakeStep(null);
  }, [src.id, src.minStake]);

  const readBalance = useCallback(async () => {
    if (!address || !srcChain) {
      setBalance(null);
      return;
    }
    try {
      const token = new ethers.Contract(src.token, ERC20_ABI, readProvider(srcChain));
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
  const staked = isConnected ? (row?.staked ?? null) : null;
  const effective = staked ?? 0;
  const tier = staked === null ? null : tierForStake(effective, src.tiers);
  const upcoming = nextTier(effective, src.tiers);
  const active = Boolean(stakeAddress) && staked !== null && effective >= src.minStake;
  const record = isConnected ? (row?.key ?? null) : null;
  const used = record ? record.usedInput + record.usedOutput : 0;
  const remaining = record ? Math.max(0, record.allowance - used) : 0;
  /** Dibulatkan ke BAWAH: melebih-lebihkan sisa jatah adalah arah salah yang lebih mahal. */
  const leftPct = record && record.allowance > 0 ? Math.floor((remaining / record.allowance) * 100) : 0;
  const topAllowance = src.tiers.length ? src.tiers[src.tiers.length - 1].allowance : null;

  /**
   * Alasan tombol Stake tidak boleh ditekan, atau null. Hanya hal yang PASTI ditolak: jumlah kosong,
   * posisi akhir di bawah minimum (kontrak menolaknya), dan saldo yang terbaca kurang. Saldo yang tidak
   * terbaca tidak memblokir apa pun; dompet yang akan memutuskan.
   */
  const wantAmount = Number(stakeAmount);
  const blocker: string | null =
    !Number.isFinite(wantAmount) || wantAmount <= 0
      ? "Enter an amount."
      : effective + wantAmount < src.minStake
        ? `Below the ${fmt(src.minStake)} ${src.symbol} minimum: the contract would reject it.`
        : balance !== null && wantAmount > balance
          ? `This wallet holds ${fmt(balance)} ${src.symbol} on ${src.chainName}, less than this amount.`
          : null;

  const doStake = async () => {
    if (!stakeAddress || !srcChain) return;
    setBusy("stake");
    setError(null);
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
        setStakeStep(`1 of 2: approving the ${hub ? "stake hub" : "stake contract"} to move exactly this much $${src.symbol}…`);
        const ap = await token.approve(stakeAddress, amount);
        await ap.wait();
      }
      setStakeStep(current < amount ? "2 of 2: staking…" : "Staking…");
      const tx = hub
        ? await new ethers.Contract(stakeAddress, STAKE_HUB_ABI, signer).stake(src.token, amount)
        : await new ethers.Contract(stakeAddress, STAKE_ABI, signer).stake(amount);
      await tx.wait();
      setStakeStep(`Staked. You can create your ${where} key now.`);
      await refreshAll();
    } catch (e) {
      setError(describeTxError(e));
      setStakeStep(null);
    } finally {
      setBusy(null);
    }
  };

  const doUnstake = async () => {
    if (!stakeAddress || !srcChain) return;
    setBusy("unstake");
    setError(null);
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
      setError(describeTxError(e));
      setStakeStep(null);
    } finally {
      setBusy(null);
    }
  };

  const signed = async (method: "POST" | "DELETE") => {
    const provider = new ethers.BrowserProvider(getActiveEip1193());
    const signer = await provider.getSigner();
    const signerAddress = await signer.getAddress();
    const build = method === "POST" ? issueKeyMessage : revokeKeyMessage;
    const message = build(AGENT_COMPUTE_ENDPOINT, signerAddress, Date.now(), src.id);
    const signature = await signer.signMessage(message);
    const res = await fetch("/api/agent/keys", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: signerAddress, message, signature, stake: src.id }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || `status ${res.status}`);
    return json;
  };

  const issue = async () => {
    setBusy("issue");
    setError(null);
    try {
      const json = await signed("POST");
      setFreshSecret(String(json.key));
      await refresh();
    } catch (e) {
      setError((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy("revoke");
    setError(null);
    try {
      await signed("DELETE");
      setFreshSecret(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  // Satu angka per sel, supaya grid dua kolom tidak membungkus di lembar ponsel 320 px.
  const facts: Array<[string, string]> = [
    ["Minimum to stake", `${fmt(src.minStake)} ${src.symbol}`],
    [
      hub ? "Compute funded so far" : "Allowance by tier",
      hub
        ? src.budgetTokens === null
          ? "…"
          : `${fmtShort(src.budgetTokens)} model tokens`
        : topAllowance
          ? `${fmtShort(src.tiers[0].allowance)} to ${fmtShort(topAllowance)} tokens`
          : "—",
    ],
    ["Staked by everyone", src.totalStaked === null ? "…" : `${fmtShort(src.totalStaked)} ${src.symbol}`],
    ["Wallets staking", src.stakers === null ? "…" : fmt(src.stakers)],
  ];
  if (isConnected) {
    facts.push(["Your stake", staked === null ? (row?.error ? "not readable now" : "…") : `${fmt(effective)} ${src.symbol}`]);
    facts.push(["In your wallet", balance === null ? "…" : `${fmt(balance)} ${src.symbol}`]);
  }

  return (
    <div className="space-y-6" data-testid={`compute-stake-${src.id}`}>
      {/* ── angka token ini ─────────────────────────────────────────────── */}
      <div className="rounded-card border border-line bg-surface p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{k}</dt>
              <dd className="mt-0.5 break-words font-mono text-[13px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-ink-soft">
          {hub
            ? `Keys on ${src.name} share the compute its own trading pays for: half of the 0.10% protocol fee, split by stake. A market nobody trades funds no compute.`
            : `${src.name} has fixed tiers: the size of your stake decides your allowance.`}{" "}
          No lock and no reward: you can unstake at any time.
        </p>
      </div>

      {!stakeAddress && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/[0.07] p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <p className="text-[13px] leading-relaxed text-ink-soft">
            <strong className="text-warn">{src.name} has no stake contract yet.</strong> Its market trades on {src.chainName}, but
            there is nothing to stake into there yet, so no key can be issued for it.
          </p>
        </div>
      )}

      {!isConnected ? (
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-[14px] leading-relaxed text-ink-soft">
            Connect the wallet that holds your ${src.symbol} to stake it and create a key. Connecting only reads your
            address; nothing moves until you confirm a transaction.
          </p>
          <button
            type="button"
            onClick={() => void connectWallet()}
            disabled={isConnecting}
            className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[14px] font-semibold text-white transition-colors hover:bg-accent-strong disabled:opacity-60"
          >
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wallet className="h-4 w-4" aria-hidden="true" />}
            {isConnecting ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
      ) : (
        <>
          {/* ── 1 · stake ─────────────────────────────────────────────────── */}
          {stakeAddress && (
            <section aria-label="Stake" className="space-y-3">
              <StepHead n={1} title="Stake" done={active} note={active ? "Active. You can add more or unstake." : undefined} />
              <div className="rounded-card border border-line bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`stake-amount-${src.id}`} className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Amount to stake
                  </label>
                  <div className="flex flex-wrap items-center gap-1">
                    {(src.tiers.length ? src.tiers : [{ label: "Minimum", stake: src.minStake, allowance: 0 }]).map((t) => {
                      const picked = Number(stakeAmount) === t.stake;
                      return (
                        <button
                          key={t.label}
                          type="button"
                          onClick={() => setStakeAmount(String(t.stake))}
                          aria-pressed={picked}
                          title={`${t.label}: ${fmt(t.stake)} ${src.symbol}`}
                          className={`h-8 rounded-lg border px-2 text-[12px] font-semibold transition-colors ${
                            picked ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-cream-2 text-ink-soft hover:text-ink"
                          }`}
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
                        title={`Everything you hold: ${fmt(Math.floor(balance))} ${src.symbol}`}
                        className={`h-8 rounded-lg border px-2 text-[12px] font-semibold transition-colors ${
                          Number(stakeAmount) === Math.floor(balance)
                            ? "border-accent/40 bg-accent-soft text-accent"
                            : "border-line bg-cream-2 text-ink-soft hover:text-ink"
                        }`}
                      >
                        Max
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    id={`stake-amount-${src.id}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent font-mono text-[24px] font-semibold tracking-tight text-ink placeholder:text-ink-faint/60 focus:outline-none"
                    placeholder="0"
                  />
                  <span className="shrink-0 font-mono text-[13px] font-semibold text-ink-soft">{src.symbol}</span>
                </div>
                <p className={`mt-1.5 text-[12px] leading-relaxed ${blocker ? "text-warn" : "text-ink-faint"}`} aria-live="polite">
                  {blocker ??
                    (hub
                      ? "Opens this market's agent, and a share of the compute its trading pays for."
                      : (() => {
                          const t = tierForStake(effective + wantAmount, src.tiers);
                          return t
                            ? `Opens ${t.label}: ${fmt(t.allowance)} tokens, about ${fmt(approxRequests(t.allowance))} requests.`
                            : "No tier at this size.";
                        })())}{" "}
                  <Link href={src.buyHref} className="font-semibold text-accent hover:underline">
                    Buy ${src.symbol}
                  </Link>
                </p>
              </div>

              {stakeStep && (
                <p className="flex items-start gap-1.5 text-[12px] text-ink-soft" role="status">
                  {busy === "stake" || busy === "unstake" ? (
                    <Loader2 className="mt-px h-3.5 w-3.5 shrink-0 animate-spin text-accent" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-ok" aria-hidden="true" />
                  )}
                  <span>{stakeStep}</span>
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={doStake}
                  disabled={busy !== null || blocker !== null}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-[14px] font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === "stake" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                  {busy === "stake" ? "Staking…" : `Stake $${src.symbol}`}
                </button>
                {effective > 0 && (
                  <button
                    type="button"
                    onClick={doUnstake}
                    disabled={busy !== null}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-[14px] font-semibold text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                  >
                    {busy === "unstake" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Undo2 className="h-4 w-4" aria-hidden="true" />}
                    Unstake all
                  </button>
                )}
              </div>
            </section>
          )}

          {!stakeAddress && (
            <Link
              href={src.buyHref}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[14px] font-semibold text-ink-soft hover:text-ink"
            >
              <ShoppingCart className="h-4 w-4" aria-hidden="true" /> Trade ${src.symbol} on {src.chainName}
            </Link>
          )}

          {/* ── 2 · kunci ─────────────────────────────────────────────────── */}
          <section aria-label="API key" className="space-y-3">
            <StepHead n={2} title="API key" done={Boolean(record?.active)} />
            {freshSecret && <SecretBox secret={freshSecret} />}
            {record ? (
              <div className="space-y-3 rounded-card border border-line bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-[13px] text-ink">{record.keyPrefix}…</code>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      record.active ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
                    }`}
                  >
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${record.active ? "bg-ok" : "bg-warn"}`} />
                    {record.active ? "Active" : "Off"}
                  </span>
                </div>
                {record.disabledReason && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-warn/[0.07] p-2.5 text-[12px] leading-relaxed text-ink-soft">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
                    <span>{record.disabledReason}</span>
                  </p>
                )}
                <div>
                  <div className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="text-ink-faint">{hub ? "Accrued compute left" : `${record.tierLabel ?? "No tier"} allowance left`}</span>
                    <span className="font-mono text-ink">
                      {fmt(remaining)} of {fmt(record.allowance)} · {leftPct}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-cream-3">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ${record.active ? "bg-accent" : "bg-warn"}`}
                      style={{ width: `${leftPct}%` }}
                    />
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] text-ink-faint">
                    {fmt(used)} used ({fmt(record.usedInput)} in · {fmt(record.usedOutput)} out) · {fmt(record.requests)} requests
                  </p>
                </div>
                <button
                  type="button"
                  onClick={revoke}
                  disabled={busy !== null}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-danger/40 bg-surface text-[13px] font-semibold text-danger transition-colors hover:bg-danger/[0.06] disabled:opacity-50"
                >
                  {busy === "revoke" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  Revoke this key
                </button>
              </div>
            ) : (
              <div className="rounded-card border border-line bg-surface p-3">
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  {!stakeAddress
                    ? `A key for ${where} opens once its stake contract exists.`
                    : !configured
                      ? "Key issuance is not configured on this server yet."
                      : !active
                        ? `Stake at least ${fmt(src.minStake)} ${src.symbol} first. The key belongs to your address and to this token.`
                        : hub
                          ? `Sign one message to create your ${where} key. It starts empty and fills as this market trades, and it switches on once one request's worth (${fmt(MEASURED_INPUT_FLOOR)} tokens) has accrued.`
                          : `Your stake opens ${tier?.label ?? "a tier"}. Sign one message to create the key. Metering starts when you do.`}
                  {!active && upcoming && !hub && stakeAddress && (
                    <> The first tier, {upcoming.tier.label}, needs {fmt(upcoming.tier.stake)} {src.symbol}.</>
                  )}
                </p>
                <button
                  type="button"
                  onClick={issue}
                  disabled={!active || busy !== null || !configured}
                  className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[14px] font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === "issue" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
                  Create API key
                </button>
              </div>
            )}
          </section>

          {error && (
            <p className="flex items-start gap-1.5 text-[13px] text-danger" role="alert">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
        </>
      )}

      {/* ── 3 · pakai ─────────────────────────────────────────────────── */}
      <section aria-label="Use it" className="space-y-3">
        <StepHead n={3} title="Use it" />
        <CopyField value={AGENT_COMPUTE_ENDPOINT} label="Base URL" />
        <CopyField value={AGENT_COMPUTE_MODEL} label="Model" />
        <button
          type="button"
          onClick={onShowExamples}
          className="inline-flex min-h-[40px] items-center text-left text-[13px] font-semibold text-accent hover:underline"
        >
          See code examples for cURL, Python and TypeScript
        </button>
      </section>
    </div>
  );
}
