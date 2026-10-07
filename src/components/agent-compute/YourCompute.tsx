"use client";
/**
 * "Your compute": HANYA token yang di-stake dompet ini atau yang punya kuncinya, dari
 * `/api/agent/keys?address=` (Multicall3 di server). Dulu bagian ini adalah daftar centang setiap
 * sumber; sekarang ia tetap pendek berapa pun jumlah pasarnya, karena satu dompet jarang memegang
 * lebih dari beberapa posisi.
 */
import { AlertTriangle, KeyRound, Loader2, RefreshCw, Wallet } from "lucide-react";
import ChainChip from "@/components/ui/ChainChip";
import Skeleton from "@/components/ui/Skeleton";
import { fmt, type SourceView, type WalletRow, type WalletStatus } from "@/components/agent-compute/types";

function planOf(r: WalletRow): string {
  if (r.kind === "hub") return "Fee-funded";
  return r.tier?.label ?? r.key?.tierLabel ?? "Below minimum";
}

function Usage({ r }: { r: WalletRow }) {
  const k = r.key;
  if (!k) {
    return <span className="text-ink-faint">{r.kind === "hub" ? "Accrues as the market trades" : r.tier ? `${fmt(r.tier.allowance)} tokens once you create a key` : "No allowance yet"}</span>;
  }
  const used = k.usedInput + k.usedOutput;
  const pct = k.allowance > 0 ? Math.min(100, Math.floor((used / k.allowance) * 100)) : 0;
  return (
    <span className="block min-w-[160px]">
      <span className="block h-1.5 overflow-hidden rounded-full bg-cream-3">
        <span className={`block h-full rounded-full ${k.active ? "bg-accent" : "bg-warn"}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="mt-1 block font-mono text-[11px] text-ink-faint">
        {fmt(used)} of {fmt(k.allowance)} tokens used
      </span>
    </span>
  );
}

function KeyState({ r }: { r: WalletRow }) {
  if (!r.key) return <span className="text-ink-faint">No key yet</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          r.key.active ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
        }`}
      >
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${r.key.active ? "bg-ok" : "bg-warn"}`} />
        {r.key.active ? "Active" : "Off"}
      </span>
      {!r.key.active && r.key.disabledReason && <span className="max-w-[260px] text-[11px] leading-snug text-ink-faint">{r.key.disabledReason}</span>}
    </span>
  );
}

export default function YourCompute({
  isConnected,
  isConnecting,
  connect,
  status,
  loading,
  error,
  refresh,
  onOpen,
}: {
  isConnected: boolean;
  isConnecting: boolean;
  connect: () => void;
  status: WalletStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  onOpen: (s: SourceView, opener: HTMLElement) => void;
}) {
  const rows = status?.stakes ?? [];
  return (
    <section aria-labelledby="mine" className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="mine" className="scroll-mt-24 font-display text-[22px] font-semibold tracking-tight text-ink sm:text-[26px]">
            Your compute
          </h2>
          <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-soft sm:text-[15px]">
            The tokens this wallet stakes, and the key each one opens.
          </p>
        </div>
        {isConnected && (
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> Refresh
          </button>
        )}
      </div>

      <div className="mt-4">
        {!isConnected ? (
          <div className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-3 text-[14px] leading-relaxed text-ink-soft">
              <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              Connect a wallet to see what it stakes and the keys it holds. Connecting only reads your address.
            </p>
            <button
              type="button"
              onClick={connect}
              disabled={isConnecting}
              className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-strong disabled:opacity-60 sm:w-auto"
            >
              {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wallet className="h-4 w-4" aria-hidden="true" />}
              {isConnecting ? "Connecting…" : "Connect wallet"}
            </button>
          </div>
        ) : error && !status ? (
          <div className="rounded-card border border-line bg-surface p-5 text-[14px] text-ink-soft">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              {error}
            </p>
            <button type="button" onClick={refresh} className="mt-3 inline-flex h-10 items-center rounded-xl border border-line-strong bg-cream-2 px-4 text-[13px] font-semibold text-ink">
              Retry
            </button>
          </div>
        ) : !status ? (
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">Reading your stakes…</span>
            <Skeleton shape="rect" className="h-[60px] w-full" />
            <Skeleton shape="rect" className="h-[60px] w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-5 text-[14px] leading-relaxed text-ink-soft">
            This wallet stakes nothing yet and holds no key.{" "}
            <a href="#choose" className="font-semibold text-accent hover:underline">
              Choose a token below
            </a>{" "}
            to start.
          </div>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-card border border-line bg-surface md:block">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-line bg-cream-2 text-[11px] uppercase tracking-wider text-ink-faint">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Token</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Plan</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Staked</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Allowance</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Key</th>
                    <th scope="col" className="px-4 py-2.5">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-line align-middle last:border-0">
                      <th scope="row" className="px-4 py-3 font-normal">
                        <span className="flex items-center gap-2">
                          <span className="font-semibold text-ink">${r.source.symbol}</span>
                          <ChainChip chain={r.source.chainId} size="sm" variant="plain" />
                        </span>
                      </th>
                      <td className="px-4 py-3">
                        <span className="inline-flex h-[22px] items-center rounded-md bg-accent-soft px-2 text-[11px] font-semibold text-accent">{planOf(r)}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">{r.staked === null ? "—" : fmt(r.staked)}</td>
                      <td className="px-4 py-3 text-[12px]">
                        <Usage r={r} />
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        <KeyState r={r} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => onOpen(r.source, e.currentTarget)}
                          aria-label={`Manage $${r.source.symbol} on ${r.source.chainName}`}
                          className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-cream-2 px-3 text-[13px] font-semibold text-ink hover:border-accent/50 hover:text-accent"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-2 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="rounded-card border border-line bg-surface p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2">
                        <span className="text-[15px] font-semibold text-ink">${r.source.symbol}</span>
                        <ChainChip chain={r.source.chainId} size="sm" variant="plain" />
                      </p>
                      <p className="mt-0.5 text-[12px] text-ink-faint">
                        {planOf(r)} · {r.staked === null ? "stake not readable now" : `${fmt(r.staked)} staked`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => onOpen(r.source, e.currentTarget)}
                      aria-label={`Manage $${r.source.symbol} on ${r.source.chainName}`}
                      className="inline-flex h-10 shrink-0 items-center rounded-lg border border-line-strong bg-cream-2 px-3.5 text-[13px] font-semibold text-ink"
                    >
                      Manage
                    </button>
                  </div>
                  <div className="mt-2.5 flex flex-col gap-2 border-t border-line pt-2.5 text-[12px]">
                    <Usage r={r} />
                    <KeyState r={r} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {status && (status.unreadable ?? 0) > 0 && (
          <p className="mt-2 text-[12px] text-ink-faint">
            {fmt(status.unreadable ?? 0)} stake contract{status.unreadable === 1 ? "" : "s"} could not be read just now, so a
            position there may be missing. Refresh to try again.
          </p>
        )}
      </div>
    </section>
  );
}
