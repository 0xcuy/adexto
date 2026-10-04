/**
 * <Disclosure summary="How Agent Score works" hint? icon? id? defaultOpen? className?>…</Disclosure>
 *
 * Penjelasan yang dilipat, dibangun di atas <details>/<summary> asli: bisa dibuka dengan keyboard
 * (Enter/Space), terbaca pembaca layar sebagai tombol yang bisa diperluas, dan tetap bekerja tanpa
 * JavaScript. Isi yang tertutup tidak dihitung `tools/audit-layout.mjs` (hanya summary-nya).
 *
 *   summary      judul baris yang bisa diketuk. Baris ≥ 48 px, seluruh lebarnya target sentuh.
 *   hint         teks kecil opsional di kanan judul ("7 factors", "10 agents").
 *   icon         ikon lucide opsional di depan judul, aria-hidden.
 *   id           dipasang di <details>. Tautan `#id` mendarat di baris summary.
 *   defaultOpen  terbuka saat pertama dirender.
 *
 * Penanda bawaan browser disembunyikan; chevron diputar lewat `group-open:`.
 * Tanpa state; server-safe.
 */
import type { ComponentType, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/components/ui/cn";

export interface DisclosureProps {
  summary: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  id?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

export default function Disclosure({ summary, hint, icon: Icon, id, defaultOpen = false, className, children }: DisclosureProps) {
  return (
    <details id={id} open={defaultOpen || undefined} className={cn("group rounded-panel border border-line bg-surface", className)}>
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-3 rounded-panel px-4 py-3 text-[14px] font-semibold text-ink transition-colors hover:bg-cream-2 [&::-webkit-details-marker]:hidden">
        {Icon && <Icon className="h-[16px] w-[16px] shrink-0 text-accent" aria-hidden="true" />}
        <span className="min-w-0 flex-1">{summary}</span>
        {hint && <span className="shrink-0 text-[12px] font-medium text-ink-faint">{hint}</span>}
        <ChevronDown className="h-[16px] w-[16px] shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-line px-4 py-4 text-[14px] leading-relaxed text-ink-soft">{children}</div>
    </details>
  );
}
