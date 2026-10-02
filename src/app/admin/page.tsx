"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Megaphone, Trash2 } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { personalSign } from "@/lib/personal-sign";
import { promotedMessage, referralExportMessage, type PromotedAction } from "@/lib/growth-admin-message";
import { CHAIN_LIST } from "@/lib/chains";
import { PROMOTED_TERMS } from "@/config/growth-programs";

/**
 * `/admin`: alat owner untuk program pertumbuhan Plan 2. Halaman ini tidak memegang hak apa pun;
 * setiap aksi ditandatangani dompet yang tersambung dan server menolak alamat yang bukan admin
 * (`src/lib/growth-admin.ts`). Tanpa dompet admin, halamannya hanya bisa membaca.
 */

interface Slot {
  id: string;
  chainId: number;
  token: string;
  symbol: string;
  startsAt: number;
  endsAt: number;
  paymentRef: string;
  approvedBy: string;
  removedAt: number | null;
}

const fmt = (t: number) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export default function AdminPage() {
  const { address, isConnected, connectWallet } = useWallet();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [weeks, setWeeks] = useState<string[]>([]);
  const [line, setLine] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const chains = CHAIN_LIST.filter((c) => c.chainId !== 31337 || process.env.NEXT_PUBLIC_DEVCHAIN_RPC);
  const [form, setForm] = useState({ chainId: String(chains[0]?.chainId ?? ""), token: "", hours: String(PROMOTED_TERMS.hours), startsIn: "0", paymentRef: "" });

  const load = useCallback(async () => {
    const [s, w] = await Promise.all([fetch("/api/promoted?all=1", { cache: "no-store" }), fetch("/api/referral/export", { cache: "no-store" })]);
    if (s.ok) setSlots((await s.json()).slots ?? []);
    if (w.ok) setWeeks((await w.json()).weeks ?? []);
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const signed = async (label: string, fn: (issuedAt: number) => Promise<Response>) => {
    if (!address) return;
    setBusy(label);
    setLine(null);
    try {
      const res = await fn(Date.now());
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res;
    } catch (e: any) {
      setLine({ text: String(e?.shortMessage ?? e?.message ?? e), tone: "err" });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const promotedCall = (action: PromotedAction) =>
    signed(action.action === "approve" ? "approve" : `remove-${action.id}`, async (issuedAt) => {
      const signature = await personalSign(promotedMessage(action, issuedAt), address!);
      return fetch("/api/promoted", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...action, issuedAt, signature }) });
    });

  const approve = async () => {
    const startsAt = Math.floor(Date.now() / 1000) + Math.round(Number(form.startsIn) * 3600);
    const res = await promotedCall({
      action: "approve",
      chainId: Number(form.chainId),
      token: form.token.trim(),
      startsAt,
      hours: Number(form.hours),
      paymentRef: form.paymentRef.trim(),
    });
    if (res) {
      setLine({ text: "Slot approved.", tone: "ok" });
      setForm((f) => ({ ...f, token: "", paymentRef: "" }));
      load();
    }
  };

  const exportWeek = async (week: string) => {
    const res = await signed(`export-${week}`, async (issuedAt) => {
      const signature = await personalSign(referralExportMessage(week, issuedAt), address!);
      return fetch("/api/referral/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ week, issuedAt, signature }) });
    });
    if (!res) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `adexto-referrals-${week}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const input = "w-full rounded-xl border border-line bg-cream-2 px-3 py-2 text-xs text-ink focus:border-accent/40 focus:outline-none";
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <p className="kicker mb-2">Admin</p>
        <h1 className="font-display text-3xl font-light tracking-tight text-ink">Growth programs</h1>
        <p className="mt-2 text-[13px] text-ink-soft">Every action is signed by the connected wallet and checked against the admin list on the server.</p>
      </div>
      {!isConnected || !address ? (
        <button type="button" onClick={() => connectWallet().catch(() => {})} className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white">
          Connect an admin wallet
        </button>
      ) : (
        <p className="text-[11px] text-ink-faint">
          Signing as <span className="font-mono text-ink">{address}</span>
        </p>
      )}
      {line && <p className={`text-xs ${line.tone === "ok" ? "text-ok" : "text-danger"}`}>{line.text}</p>}

      <section className="glass-panel space-y-3 rounded-card border border-line bg-surface p-5 shadow-[var(--shadow-panel)]">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Megaphone className="h-4 w-4 text-warn" aria-hidden /> Promoted slots ({PROMOTED_TERMS.slots} at a time)
        </h2>
        <p className="text-[11px] text-ink-soft">Check the payment to the treasury yourself first; the server records your note but does not verify it.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          <select value={form.chainId} onChange={(e) => setForm({ ...form, chainId: e.target.value })} className={input} aria-label="Chain">
            {chains.map((c) => (
              <option key={c.chainId} value={c.chainId}>
                {c.name}
              </option>
            ))}
          </select>
          <input value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="Token address" className={`${input} sm:col-span-2`} aria-label="Token address" />
          <input value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="Hours" className={input} aria-label="Hours" />
          <input value={form.startsIn} onChange={(e) => setForm({ ...form, startsIn: e.target.value })} placeholder="Starts in (hours)" className={input} aria-label="Starts in hours" />
          <input value={form.paymentRef} onChange={(e) => setForm({ ...form, paymentRef: e.target.value })} placeholder="Payment note (tx hash)" className={`${input} sm:col-span-4`} aria-label="Payment note" />
          <button
            type="button"
            disabled={!address || busy !== null}
            onClick={approve}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy === "approve" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Sign &amp; approve
          </button>
        </div>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">
              <th className="py-2">Market</th>
              <th className="py-2">Window</th>
              <th className="py-2">Payment</th>
              <th className="py-2">State</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {slots.map((s) => {
              const state = s.removedAt ? "removed" : now < s.startsAt ? "upcoming" : now < s.endsAt ? "live" : "ended";
              return (
                <tr key={s.id}>
                  <td className="py-2 text-ink">
                    ${s.symbol} <span className="text-ink-faint">({s.chainId})</span>
                  </td>
                  <td className="py-2 text-ink-soft">
                    {fmt(s.startsAt)} → {fmt(s.endsAt)}
                  </td>
                  <td className="max-w-[180px] truncate py-2 font-mono text-ink-soft">{s.paymentRef}</td>
                  <td className="py-2 text-ink-soft">{state}</td>
                  <td className="py-2 text-right">
                    {!s.removedAt && state !== "ended" && (
                      <button
                        type="button"
                        disabled={!address || busy !== null}
                        onClick={async () => {
                          if (await promotedCall({ action: "remove", id: s.id })) load();
                        }}
                        className="inline-flex items-center gap-1 text-danger hover:underline disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden /> Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {slots.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-ink-faint">
                  No slots yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="glass-panel space-y-3 rounded-card border border-line bg-surface p-5 shadow-[var(--shadow-panel)]">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Download className="h-4 w-4 text-accent" aria-hidden /> Referral payouts (CSV)
        </h2>
        <p className="text-[11px] text-ink-soft">One row per referrer for the week (Monday 00:00 UTC). The reward column uses the terms in src/config/growth-programs.ts.</p>
        {weeks.length === 0 ? (
          <p className="text-xs text-ink-faint">No referred trade recorded yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {weeks.map((w) => (
              <button
                key={w}
                type="button"
                disabled={!address || busy !== null}
                onClick={() => exportWeek(w)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent/40 disabled:opacity-50"
              >
                {busy === `export-${w}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />} {w}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
