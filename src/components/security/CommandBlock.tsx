"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * Blok perintah dengan tombol salin, untuk checklist "Verify it yourself".
 *
 * Satu-satunya bagian klien di halaman keamanan. Isinya tetap dirender server (teksnya ada di
 * HTML awal), jadi pembaca tanpa JavaScript masih bisa memblok dan menyalin sendiri.
 *
 * Baris panjang DIBUNGKUS, bukan digulir: versi gulir membuat ujung baris (alamat RPC) lewat di
 * bawah tombol Copy dan tidak terbaca. Bungkus lunak tidak menyisipkan newline, jadi teks yang
 * diblok manual tetap satu baris perintah.
 */
export default function CommandBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="relative" data-testid="verify-command">
      {label && <div className="mb-1 font-mono text-[10px] font-bold text-ink-soft">{label}</div>}
      <pre
        tabIndex={0}
        aria-label={label ? `Command: ${label}` : "Command"}
        className="whitespace-pre-wrap rounded-lg bg-cream-3 p-3 pr-20 font-mono text-[10.5px] leading-relaxed text-ink [overflow-wrap:anywhere] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {code}
      </pre>
      <button
        type="button"
        onClick={copy}
        className={`absolute right-1.5 inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink-soft hover:border-accent/40 hover:text-ink ${
          label ? "top-6" : "top-1.5"
        }`}
        aria-label="Copy command"
        data-testid="verify-copy"
      >
        {copied ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
