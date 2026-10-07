"use client";
/**
 * Ping endpoint compute, diberi label apa adanya: waktu bolak-balik dari SERVER ADEXTO ke health check
 * router, bukan dari peramban pengunjung dan bukan latensi inferensi. Diperbarui tiap 30 detik.
 */
import { useEffect, useState } from "react";

export default function PingBadge() {
  const [ping, setPing] = useState<{ ok: boolean; ms: number; status: number } | null>(null);

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

  // Tempatnya dipesan sebelum jawaban datang, supaya judul kartu tidak bergeser.
  if (!ping) return <span className="h-[22px] w-[64px]" aria-hidden="true" />;
  return (
    <span
      title={`HTTP ${ping.status} from the router's health check, measured from the ADEXTO server. Not inference latency.`}
      className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 font-mono text-[11px] font-semibold ${
        ping.ok ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${ping.ok ? "bg-ok" : "bg-danger"}`} />
      {ping.ok ? `${ping.ms} ms` : "unreachable"}
      <span className="sr-only">{ping.ok ? "Endpoint reachable" : "Endpoint unreachable"}</span>
    </span>
  );
}
