"use client";

/**
 * <CopyField value="https://adexto.xyz/api/mcp" label? copyLabel? wrap? multiline? className? />
 *
 * Nilai monospace + tombol Copy. Pengganti blok kode panjang yang keluar layar di ponsel
 * (baseline 3 Okt: blok kode /agents keluar 114 px dan halaman bisa digeser ke samping).
 *
 *   value      teks yang disalin, persis seperti ditampilkan.
 *   label      judul kecil di atas field ("MCP URL"). Opsional.
 *   copyLabel  nama yang dibaca pembaca layar untuk tombol: aria-label = `Copy <copyLabel>`.
 *              Bawaan: `label`, lalu "value". Teks tombol yang terlihat tetap "Copy", dan
 *              aria-label selalu diawali "Copy" (WCAG 2.5.3, label in name).
 *   wrap       satu baris yang dipatahkan di mana saja (break-all) alih-alih dipotong ellipsis.
 *              Pakai untuk alamat/URL yang harus terbaca utuh di 320 px.
 *   multiline  blok <pre> yang bisa digeser ke samping di dalam kotaknya sendiri (bukan halaman),
 *              dengan tombol Copy di bilah judul. Untuk konfigurasi JSON/perintah beberapa baris.
 *
 * Bawaan (tanpa wrap/multiline): satu baris, dipotong ellipsis, nilai penuh di `title`.
 * Ketuk nilainya = memilih seluruh nilai (`select-all`), jadi tetap bisa disalin manual bila
 * clipboard ditolak browser. Hasil salin diumumkan lewat region aria-live.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/components/ui/cn";

export interface CopyFieldProps {
  value: string;
  label?: string;
  copyLabel?: string;
  wrap?: boolean;
  multiline?: boolean;
  className?: string;
}

export default function CopyField({ value, label, copyLabel, wrap = false, multiline = false, className }: CopyFieldProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef<HTMLElement | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const name = copyLabel ?? label ?? "value";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      // Clipboard ditolak (konteks tidak aman, izin): pilih teksnya supaya bisa disalin manual.
      const el = valueRef.current;
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  };

  const button = (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${name}`}
      className={cn(
        "inline-flex h-[40px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors lg:h-[32px]",
        state === "copied" ? "text-ok" : "text-ink-soft hover:bg-cream-3 hover:text-ink"
      )}
    >
      {state === "copied" ? <Check className="h-[14px] w-[14px]" aria-hidden="true" /> : <Copy className="h-[14px] w-[14px]" aria-hidden="true" />}
      <span>{state === "copied" ? "Copied" : "Copy"}</span>
    </button>
  );

  const live = (
    <span aria-live="polite" className="sr-only">
      {state === "copied" ? `${name} copied` : state === "failed" ? `Copy failed. ${name} is selected; copy it manually.` : ""}
    </span>
  );

  if (multiline) {
    return (
      <div className={cn("min-w-0 rounded-panel border border-line bg-cream-2", className)}>
        <div className="flex min-h-[40px] items-center justify-between gap-2 border-b border-line py-1 pl-3 pr-1 lg:min-h-[36px]">
          <span className="min-w-0 truncate text-[12px] font-semibold text-ink-faint">{label}</span>
          {button}
        </div>
        <pre
          ref={(el) => {
            valueRef.current = el;
          }}
          tabIndex={0}
          className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-ink-soft sm:text-[13px]"
        >
          {value}
        </pre>
        {live}
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      {label && <div className="mb-1.5 text-[12px] font-medium text-ink-faint">{label}</div>}
      <div className="flex min-w-0 items-center gap-1 rounded-panel border border-line bg-cream-2 py-0.5 pl-3 pr-0.5">
        <code
          ref={(el) => {
            valueRef.current = el;
          }}
          title={wrap ? undefined : value}
          className={cn(
            // 12 px di bawah sm: URL MCP (26 karakter) muat utuh di 320 px tanpa dipotong.
            "min-w-0 flex-1 select-all py-2 font-mono text-[12px] leading-snug text-ink sm:text-[13px]",
            wrap ? "break-all" : "truncate"
          )}
        >
          {value}
        </code>
        {button}
      </div>
      {live}
    </div>
  );
}
