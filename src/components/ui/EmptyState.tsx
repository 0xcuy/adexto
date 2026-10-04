/**
 * <EmptyState icon? title body? action? titleAs? compact? className? />
 *
 * Keadaan kosong yang menjelaskan KENAPA kosong dan apa langkah berikutnya, alih-alih tabel
 * kosong atau satu baris abu-abu.
 *
 *   icon     ikon lucide opsional dalam lingkaran aksen tipis, aria-hidden.
 *   title    satu kalimat pendek ("No agent-bound market yet").
 *   body     penjelasan opsional, satu-dua kalimat.
 *   action   tombol/tautan opsional (pakai `buttonClass`).
 *   titleAs  p (bawaan) · h2 · h3, sesuai urutan judul halaman pemakai.
 *   compact  padding lebih kecil, untuk di dalam kartu/panel.
 *
 * Tanpa state; server-safe.
 */
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export interface EmptyStateProps {
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  titleAs?: "p" | "h2" | "h3";
  compact?: boolean;
  className?: string;
}

export default function EmptyState({ icon: Icon, title, body, action, titleAs = "p", compact = false, className }: EmptyStateProps) {
  const Title = titleAs;
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-panel border border-dashed border-line-strong text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-10",
        className
      )}
    >
      {Icon && (
        <span className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
      )}
      <Title className="text-[16px] font-semibold text-ink">{title}</Title>
      {body && <div className="max-w-md text-[14px] leading-relaxed text-ink-soft">{body}</div>}
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
