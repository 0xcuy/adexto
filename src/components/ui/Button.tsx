/**
 * <Button variant? size? fullWidth? glow? …props tombol HTML />
 * buttonClass({ variant?, size?, fullWidth?, glow?, className? }): string
 *
 * Satu bentuk tombol untuk seluruh situs. `buttonClass()` dipakai bila elemennya bukan <button>,
 * misalnya tautan: <Link href="/studio" className={buttonClass({ variant: "primary" })}>Launch</Link>
 *
 *   variant   primary   isian aksen, teks putih. Satu per layar (aturan satu aksen).
 *             secondary berbingkai di atas permukaan (bawaan).
 *             ghost     tanpa bingkai, untuk aksi ketiga dan baris alat.
 *             danger    isian merah, hanya untuk aksi yang merusak/membatalkan.
 *   size      sm   40 px di ponsel, 32 px mulai lg (1024 px). Untuk baris alat padat di desktop.
 *             md   40 px di semua lebar (bawaan).
 *             lg   48 px, untuk CTA utama halaman.
 *   fullWidth w-full.
 *   glow      menambah `.btn-glow` (globals.css). Hanya untuk SATU aksi utama per layar.
 *
 * Tinggi ditulis dalam px, bukan kelas rem: rem situs ini 14 px, jadi `h-10` = 35 px, bukan 40.
 * `className` dari pemakai menang atas bawaan (lihat `cn`). Fokus memakai cincin global
 * `:focus-visible` di globals.css, supaya semua kontrol berbagi satu tanda fokus.
 *
 * Tidak ada state, jadi aman dirender dari server component (tanpa onClick) maupun client.
 */
import type { ComponentProps } from "react";
import { cn } from "@/components/ui/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonStyle {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  glow?: boolean;
  className?: string;
}

const BASE =
  "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold leading-none transition-colors duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:shrink-0";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white shadow-[var(--shadow-sm)] hover:bg-accent-strong",
  secondary: "border border-line bg-surface text-ink shadow-[var(--shadow-sm)] hover:border-line-strong hover:bg-cream-2",
  ghost: "text-ink-soft hover:bg-cream-3 hover:text-ink",
  danger: "bg-danger text-white hover:bg-danger/90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-[40px] gap-1.5 rounded-lg px-3 text-[13px] lg:h-[32px]",
  md: "h-[40px] gap-2 rounded-xl px-4 text-[14px]",
  lg: "h-[48px] gap-2 rounded-xl px-6 text-[16px]",
};

export function buttonClass({ variant = "secondary", size = "md", fullWidth = false, glow = false, className }: ButtonStyle = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", glow && "btn-glow", className);
}

export type ButtonProps = Omit<ComponentProps<"button">, "className"> & ButtonStyle;

export default function Button({ variant, size, fullWidth, glow, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass({ variant, size, fullWidth, glow, className })} {...rest} />;
}
