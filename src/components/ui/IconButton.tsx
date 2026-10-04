/**
 * <IconButton icon={Copy} aria-label="Copy address" variant? size? …props tombol HTML />
 *
 * Tombol ikon dengan area sentuh penuh walau ikonnya kecil: ikon 16 px, area 40×40 px
 * (`md`, bawaan). `sm` = 40×40 di ponsel dan 32×32 mulai lg. Baseline 3 Okt: tombol ikon
 * 20×20 yang berdempetan adalah sumber terbesar ERROR tap<24 (WCAG 2.2 SC 2.5.8).
 *
 *   icon        komponen ikon lucide-react (atau komponen apa pun yang menerima className).
 *   aria-label  WAJIB. Tombol ini tidak punya teks, jadi labelnya satu-satunya nama yang
 *               dibaca pembaca layar. Juga dipakai sebagai `title` (tooltip) bila `title` kosong.
 *   variant     ghost (bawaan) · secondary · primary · danger, sama dengan Button.
 *
 * Tanpa state; aman dari server component maupun client.
 */
import type { ComponentProps, ComponentType } from "react";
import { cn } from "@/components/ui/cn";
import type { ButtonVariant } from "@/components/ui/Button";

export type IconButtonSize = "sm" | "md";

export type IconButtonProps = Omit<ComponentProps<"button">, "aria-label" | "children"> & {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  "aria-label": string;
  variant?: ButtonVariant;
  size?: IconButtonSize;
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong",
  secondary: "border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink",
  ghost: "text-ink-soft hover:bg-cream-3 hover:text-ink",
  danger: "text-danger hover:bg-danger/10",
};

const SIZES: Record<IconButtonSize, string> = {
  sm: "h-[40px] w-[40px] rounded-lg lg:h-[32px] lg:w-[32px]",
  md: "h-[40px] w-[40px] rounded-xl",
};

export default function IconButton({
  icon: Icon,
  variant = "ghost",
  size = "md",
  className,
  title,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      title={title ?? rest["aria-label"]}
      className={cn(
        "inline-flex shrink-0 items-center justify-center transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      <Icon className="h-[16px] w-[16px]" aria-hidden="true" />
    </button>
  );
}
