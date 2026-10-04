/**
 * <PageHeader kicker? kickerIcon? title subtitle? actions? as? className? id? />
 *
 * Kepala halaman dengan satu bentuk untuk semua rute: kicker (eyebrow), judul display tipis,
 * satu-dua kalimat, lalu slot aksi. Di ponsel aksi turun ke bawah teks; mulai lg ia duduk di kanan.
 *
 *   kicker      label kecil di atas judul ("Agents"). Memakai kelas `.kicker` globals.css.
 *   kickerIcon  ikon lucide opsional di depan kicker, aria-hidden.
 *   title       judul halaman. Dirender sebagai <h1> (bawaan) atau <h2> lewat `as`.
 *   subtitle    paragraf penjelas, maks ±75 karakter per baris (max-w-3xl).
 *   actions     tombol/tautan (pakai `buttonClass`/`Button`). Dibungkus flex-wrap, jadi tidak
 *               pernah keluar layar di 320 px.
 *
 * Dirender sebagai <div>, BUKAN <header>: `tools/audit-layout.mjs` menganggap setiap <header>
 * sebagai wilayah shell (milik UI-1), jadi <header> di dalam halaman akan salah wilayah.
 * Tanpa state; server-safe.
 */
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export interface PageHeaderProps {
  kicker?: ReactNode;
  kickerIcon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2";
  id?: string;
  className?: string;
}

export default function PageHeader({ kicker, kickerIcon: KickerIcon, title, subtitle, actions, as = "h1", id, className }: PageHeaderProps) {
  const Heading = as;
  return (
    <div id={id} className={cn("flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0 max-w-3xl">
        {kicker && (
          <div className="kicker mb-3">
            {KickerIcon && <KickerIcon className="h-[14px] w-[14px] text-accent" aria-hidden="true" />}
            <span>{kicker}</span>
          </div>
        )}
        <Heading className="font-display text-[28px] font-light leading-[1.1] tracking-tight text-ink sm:text-[36px]">{title}</Heading>
        {subtitle && <div className="mt-3 text-[14px] leading-relaxed text-ink-soft sm:text-[16px]">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
