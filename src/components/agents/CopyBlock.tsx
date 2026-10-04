"use client";

/** Blok kode dengan tombol salin, untuk konfigurasi MCP di /agents. */
import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyBlock({ label, code }: { label: string; code: string }) {
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
    // min-w-0: sebagai item grid, lebar min-content <pre> (baris terpanjang) dulu memaksa trek
    // grid 460 px, jadi blok keluar layar 114 px di 360 px dan halaman bisa digeser ke samping.
    // Dengan min-w-0 kotaknya mengikuti lebar kolom dan <pre> menggulir di dalamnya.
    <div className="min-w-0 rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-cream-3 hover:text-ink"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-ink-soft sm:text-xs">{code}</pre>
    </div>
  );
}
