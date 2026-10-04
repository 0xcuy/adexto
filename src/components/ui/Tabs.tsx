"use client";

/**
 * <Tabs label="MCP client" items={[{ id, label, content, icon? }]} defaultValue? value? onValueChange?
 *       variant? listClassName? panelClassName? className? />
 *
 * Pola WAI-ARIA Tabs: <div role="tablist" aria-label>, setiap tab <button role="tab"
 * aria-selected aria-controls>, setiap panel <div role="tabpanel" aria-labelledby>.
 *
 *   Keyboard   ←/→ pindah tab (berputar), Home/End ke tab pertama/terakhir. Seleksi mengikuti
 *              fokus (aktivasi otomatis), dan hanya tab aktif yang ada di urutan Tab
 *              (roving tabindex), jadi Tab berikutnya langsung masuk ke panel.
 *   label      WAJIB: nama tablist untuk pembaca layar.
 *   items      `label` adalah SATU-SATUNYA teks di tombol tab, jadi selector skrip seperti
 *              `button:text-is("Market")` tetap cocok. `icon` opsional berupa ELEMEN
 *              (`<Compass className="h-[14px] w-[14px]" aria-hidden="true" />`), bukan komponen:
 *              ini client component, dan fungsi tidak bisa dioper dari server component.
 *   value      mode terkontrol; tanpa `value` komponen memegang state sendiri dari
 *              `defaultValue` (bawaan: item pertama).
 *   variant    segmented (bawaan, kontrol berbingkai) · underline (garis bawah, untuk bagian
 *              halaman).
 *
 * Semua panel dirender; yang tidak aktif memakai atribut `hidden`. Isi panel tetap ada di HTML
 * (mesin pencari, find-in-page), dan audit tidak menghitung panel tersembunyi.
 * Tab 40 px di ponsel, 32 px mulai lg. Daftar tab bisa digeser di dalam dirinya sendiri bila
 * tidak muat, bukan menggeser halaman.
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
  /**
   * ELEMEN, bukan komponen: `<Compass className="h-[14px] w-[14px]" aria-hidden="true" />`.
   * Tabs adalah client component, dan server component tidak bisa mengoper fungsi (komponen
   * ikon) melintasi batas itu; elemen yang sudah dirender bisa.
   */
  icon?: ReactNode;
}

export interface TabsProps {
  label: string;
  items: readonly TabItem[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (id: string) => void;
  variant?: "segmented" | "underline";
  className?: string;
  listClassName?: string;
  panelClassName?: string;
}

export default function Tabs({
  label,
  items,
  defaultValue,
  value,
  onValueChange,
  variant = "segmented",
  className,
  listClassName,
  panelClassName,
}: TabsProps) {
  const base = useId();
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id);
  const active = value ?? inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onValueChange?.(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((t) => t.id === active);
    if (i < 0) return;
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(items[next].id);
    refs.current[next]?.focus();
  };

  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;
  const segmented = variant === "segmented";

  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn(
          "flex max-w-full overflow-x-auto",
          segmented ? "w-fit gap-1 rounded-xl border border-line bg-cream-2 p-1" : "gap-3 border-b border-line",
          listClassName
        )}
      >
        {items.map((t, i) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={selected}
              aria-controls={panelId(t.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.id)}
              className={cn(
                "inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-colors focus-visible:outline-offset-[-2px] lg:min-h-[32px]",
                segmented
                  ? cn(
                      "rounded-lg px-3 text-[13px]",
                      selected ? "bg-surface text-ink shadow-[var(--shadow-sm)]" : "text-ink-soft hover:text-ink"
                    )
                  : cn(
                      // px-2: label pendek ("You") tetap ≥ 32 px lebarnya sebagai target sentuh.
                      "-mb-px border-b-2 px-2 text-[14px]",
                      selected ? "border-accent text-ink" : "border-transparent text-ink-soft hover:text-ink"
                    )
              )}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={panelId(t.id)}
          aria-labelledby={tabId(t.id)}
          tabIndex={0}
          hidden={t.id !== active}
          className={cn("mt-3 min-w-0 focus-visible:outline-offset-4", panelClassName)}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
