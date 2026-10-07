"use client";
/**
 * Empat token bertingkat ($ADEXTO di 0G, $SAI di tiga chain) sebagai kartu pilihan cepat. Jatahnya
 * tetap per tingkat, jadi kartunya bisa menyebut angka pasti tanpa membaca apa pun; total stake dan
 * jumlah staker datang dari katalog begitu terbaca.
 */
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import ChainChip from "@/components/ui/ChainChip";
import { fmt, fmtShort, type SourceView } from "@/components/agent-compute/types";

export default function TieredTokens({
  initial,
  onOpen,
}: {
  initial: SourceView[];
  onOpen: (s: SourceView, opener: HTMLElement) => void;
}) {
  const [tiered, setTiered] = useState(initial);

  useEffect(() => {
    let alive = true;
    fetch("/api/agent-compute/sources?kind=tiered&limit=10&sort=name")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { items?: SourceView[] } | null) => {
        if (!alive || !j?.items?.length) return;
        const byId = new Map(j.items.map((s) => [s.id, s]));
        setTiered((prev) => prev.map((s) => byId.get(s.id) ?? s));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Dua bentuk dari satu tombol. Ponsel: satu baris ringkas per token (empat kartu bertumpuk dulu
   * memakan ±620 px sebelum direktori). Mulai sm: kartu dengan rentang jatah sebagai angka utama.
   * Tanpa lencana empat tingkat (dulu membungkus jadi dua baris di 1440 px): rentang jatah dan stake
   * minimum sudah menjawab "berapa yang saya dapat", dan tangganya ada di tabel di bawah.
   */
  return (
    <ul className="mt-4 grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
      {tiered.map((s) => {
        const first = s.tiers[0];
        const top = s.tiers[s.tiers.length - 1];
        const range = first && top ? `${fmtShort(first.allowance)} to ${fmtShort(top.allowance)}` : null;
        const footer = !s.contract
          ? "Stake contract not deployed yet"
          : s.stakers === null
            ? "Fixed allowance by tier"
            : `${fmt(s.stakers)} wallet${s.stakers === 1 ? "" : "s"} staking`;
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={(e) => onOpen(s, e.currentTarget)}
              aria-label={`Stake $${s.symbol} on ${s.chainName}`}
              disabled={!s.contract}
              className="group flex h-full w-full items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-col sm:items-stretch sm:gap-0 sm:p-4"
            >
              <span className="flex min-w-0 flex-1 flex-col sm:flex-none">
                <span className="flex items-center gap-2 sm:justify-between">
                  <span className="text-[15px] font-semibold text-ink sm:text-[16px]">${s.symbol}</span>
                  <ChainChip chain={s.chainId} size="sm" />
                </span>
                {/* Ponsel: jatah dan minimum dalam satu baris. */}
                <span className="mt-0.5 truncate text-[12px] text-ink-soft sm:hidden">
                  {range ? `${range} tokens · ` : ""}from {fmt(s.minStake)} {s.symbol}
                </span>
              </span>
              {range && (
                <span className="mt-3 hidden font-mono text-[18px] font-semibold tracking-tight text-ink sm:block">
                  {range}
                  <span className="ml-1.5 font-sans text-[12px] font-normal text-ink-faint">tokens</span>
                </span>
              )}
              <span className="mt-1 hidden text-[13px] leading-relaxed text-ink-soft sm:block">
                Stake from {fmt(s.minStake)} {s.symbol}
              </span>
              <span className="flex shrink-0 items-center justify-between gap-2 text-[12px] text-ink-faint sm:mt-auto sm:pt-4">
                <span className="hidden sm:inline">{footer}</span>
                <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
