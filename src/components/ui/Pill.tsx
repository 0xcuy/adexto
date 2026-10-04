/**
 * <Pill tone? size? icon? className?>verified</Pill>
 * <StatusDot tone? pulse? hideLabel? className?>curve live</StatusDot>
 *
 * Lencana status: verified, curve live, x402, ERC-8004. Teksnya SELALU ada di DOM, karena skrip
 * (`demo-v1/record.mjs`, `audit_*.mjs`) dan pembaca layar membacanya. Warna tidak pernah menjadi
 * satu-satunya pembawa arti (WCAG 1.4.1).
 *
 *   tone      neutral (bawaan) · accent · ok · warn · danger. ok/warn/danger hanya untuk keadaan
 *             sungguhan (aturan satu aksen di globals.css), bukan hiasan.
 *   size      sm = 11 px, tinggi 20 px · md = 12 px, tinggi 24 px (bawaan).
 *   icon      ikon opsional di depan teks (lucide-react), 12 px, aria-hidden.
 *
 * StatusDot = titik berwarna + teks. `pulse` hanya untuk keadaan yang memang sedang berjalan dan
 * dimatikan oleh `prefers-reduced-motion` (aturan global di globals.css). `hideLabel` membuat
 * teks sr-only: titiknya terlihat, teksnya tetap terbaca mesin.
 *
 * Tanpa state; aman dari server component maupun client.
 */
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

const PILL_TONES: Record<Tone, string> = {
  neutral: "border-line bg-cream-3 text-ink-soft",
  accent: "border-accent/30 bg-accent-soft text-accent",
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

// px, bukan kelas rem: rem situs ini 14 px, jadi `h-5` hanya 17,5 px.
const PILL_SIZES = {
  sm: "h-[20px] gap-1 px-2 text-[11px]",
  md: "h-[24px] gap-1.5 px-2.5 text-[12px]",
} as const;

export interface PillProps {
  tone?: Tone;
  size?: keyof typeof PILL_SIZES;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Pill({ tone = "neutral", size = "md", icon: Icon, title, className, children }: PillProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border font-semibold leading-none",
        PILL_TONES[tone],
        PILL_SIZES[size],
        className
      )}
    >
      {Icon && <Icon className="h-[12px] w-[12px] shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}

const DOT_TONES: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

export interface StatusDotProps {
  tone?: Tone;
  pulse?: boolean;
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}

export function StatusDot({ tone = "ok", pulse = false, hideLabel = false, className, children }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium text-ink-soft", className)}>
      <span aria-hidden="true" className="relative flex h-[8px] w-[8px] shrink-0">
        {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", DOT_TONES[tone])} />}
        <span className={cn("relative h-[8px] w-[8px] rounded-full", DOT_TONES[tone])} />
      </span>
      <span className={hideLabel ? "sr-only" : undefined}>{children}</span>
    </span>
  );
}

export default Pill;
