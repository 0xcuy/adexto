"use client";

/**
 * Lencana Agent Score untuk satu pasar. Antarmuka bersama (README rencana §4): Plan 2 boleh
 * meng-import komponen ini apa adanya, tanpa menyuntingnya, di halaman token dan leaderboard.
 *
 * Membaca `GET /api/agents/score`. Selama memuat ia menampilkan placeholder berukuran sama;
 * kalau skornya tidak terbaca ia tidak menampilkan apa pun, sesuai aturan repo ini: yang tidak
 * terbaca tidak diklaim.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

interface Factor {
  key: string;
  label: string;
  points: number;
  max: number;
  value: string;
}

interface ScoreResponse {
  score: number;
  max: number;
  factors: Factor[];
  complete: boolean;
  computedAt: string;
}

export default function AgentScoreBadge({
  chainId,
  token,
  className = "",
}: {
  chainId: number;
  token: string;
  className?: string;
}) {
  const [data, setData] = useState<ScoreResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    fetch(`/api/agents/score?chainId=${encodeURIComponent(String(chainId))}&token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ScoreResponse | null) => {
        if (!alive) return;
        if (j && typeof j.score === "number") setData(j);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [chainId, token]);

  if (failed) return null;
  const base =
    "inline-flex items-center gap-1.5 rounded-full border border-line bg-cream-2 px-2.5 py-1 text-[11px] font-medium text-ink-soft";
  if (!data) {
    return (
      <span className={`${base} ${className}`} aria-busy="true">
        Agent Score <span className="text-ink-faint">…</span>
      </span>
    );
  }
  const breakdown = data.factors.map((f) => `${f.label}: ${f.points}/${f.max} (${f.value})`).join("; ");
  return (
    <Link
      href="/agents#score"
      className={`${base} hover:text-ink hover:border-line-strong transition-colors ${className}`}
      title={`${breakdown}${data.complete ? "" : ". Index still catching up."}`}
      aria-label={`Agent Score ${data.score} out of ${data.max}. ${breakdown}`}
    >
      Agent Score <strong className="font-semibold text-ink" data-numeric>{data.score}</strong>
      <span className="text-ink-faint">/{data.max}</span>
    </Link>
  );
}
