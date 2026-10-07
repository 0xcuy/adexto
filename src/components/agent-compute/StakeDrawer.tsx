"use client";
/**
 * Laci stake: panel kanan di desktop, lembar bawah di ponsel.
 *
 * Dialog modal yang sebenarnya (`role="dialog"`, `aria-modal`): fokus pindah ke tombol tutup saat
 * dibuka dan berputar di dalam panel, Esc dan klik di luar menutupnya, dan halaman di belakangnya
 * tidak ikut tergulir. Fokus dikembalikan ke tombol pembukanya oleh pemanggil (`onClose`).
 *
 * z-[70]/[71]: di atas tab bar ponsel (z-[57]) dan lembar-lembarnya (z-[56]).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

export default function StakeDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[2px]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stake-drawer-title"
        data-testid="stake-drawer"
        className="fixed inset-x-0 bottom-0 z-[71] flex max-h-[92dvh] flex-col rounded-t-card border-t border-line-strong bg-cream-2 shadow-[var(--shadow-lift)] md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[480px] md:rounded-none md:border-l md:border-t-0"
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong md:hidden" />
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 pb-3 pt-3 md:px-5 md:pt-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Stake and key</p>
            <h2 id="stake-drawer-title" className="mt-1 font-display text-[22px] font-semibold leading-tight tracking-tight text-ink">
              {title}
            </h2>
            {subtitle && <div className="mt-1">{subtitle}</div>}
          </div>
          <button
            ref={closeBtn}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-soft transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4 md:px-5">{children}</div>
      </div>
    </>
  );
}
