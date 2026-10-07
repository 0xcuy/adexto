/**
 * <DocsShell current title kicker? summary? toc? intro?>…</DocsShell>
 *
 * Kerangka setiap halaman docs, meniru docs comfy.fun atas permintaan owner (4 Okt):
 *   - Sidebar berkelompok dari `docs-nav.ts` (≥ lg, menempel saat digulir). Di ponsel sidebar yang sama
 *     menjadi satu tombol lipat di atas artikel, berlabel halaman yang sedang dibuka.
 *   - Artikel selebar baca (±70 karakter per baris), kepala = grup + judul, lalu kotak "In short".
 *   - "On this page" di kanan mulai xl, dari daftar seksi.
 *   - Pager previous/next di bawah, urutan sama dengan sidebar.
 *
 * Server component. `<details key={current}>` memaksa tombol lipat ponsel tertutup lagi setiap pindah
 * halaman (React memakai ulang DOM yang sama bila kuncinya sama).
 * Dirender sebagai <div>, bukan <main>: layout akar sudah membungkus halaman dengan <main>.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { DOC_GROUPS, DOC_ORDER, neighbours } from "@/app/docs/docs-nav";
import type { DocArt } from "@/app/docs/docs-art";
import { cn } from "@/components/ui/cn";

function DocsNavList({ current }: { current: string }) {
  return (
    <div className="space-y-5">
      {DOC_GROUPS.map((g) => (
        <div key={g.label}>
          <p className="px-3 pb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{g.label}</p>
          <ul>
            {g.items.map((i) => {
              const active = i.href === current;
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-[40px] items-center rounded-lg px-3 text-[14px] transition-colors lg:min-h-[34px]",
                      active ? "bg-accent-soft font-semibold text-accent" : "text-ink-soft hover:bg-cream-2 hover:text-ink"
                    )}
                  >
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Pager({ current }: { current: string }) {
  const { prev, next } = neighbours(current);
  if (!prev && !next) return null;
  const card =
    "group flex min-h-[64px] flex-col justify-center gap-0.5 rounded-panel border border-line px-4 py-3 transition-colors hover:border-accent/40 hover:bg-cream-2";
  return (
    <nav aria-label="Previous and next page" className="mt-14 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
      {prev ? (
        <Link href={prev.href} className={card}>
          <span className="flex items-center gap-1 text-[12px] text-ink-faint">
            <ArrowLeft className="h-[12px] w-[12px]" aria-hidden="true" /> Previous
          </span>
          <span className="text-[15px] font-semibold text-ink group-hover:text-accent">{prev.label}</span>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
      {next && (
        <Link href={next.href} className={cn(card, "sm:items-end sm:text-right")}>
          <span className="flex items-center gap-1 text-[12px] text-ink-faint">
            Next <ArrowRight className="h-[12px] w-[12px]" aria-hidden="true" />
          </span>
          <span className="text-[15px] font-semibold text-ink group-hover:text-accent">{next.label}</span>
        </Link>
      )}
    </nav>
  );
}

export interface DocsShellProps {
  current: string;
  title: string;
  kicker?: string | null;
  summary?: readonly string[];
  toc?: ReadonlyArray<{ id: string; label: string }>;
  intro?: ReactNode;
  /** Gambar hero di bawah judul (`docs-art.ts`). Hiasan, jadi `alt` kosong. */
  art?: DocArt | null;
  children: ReactNode;
}

export default function DocsShell({ current, title, kicker, summary, toc, intro, art, children }: DocsShellProps) {
  const currentLabel = DOC_ORDER.find((d) => d.href === current)?.label ?? title;
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-10">
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12 xl:grid-cols-[220px_minmax(0,1fr)_190px]">
        {/* Ponsel/tablet: sidebar yang sama, dilipat di atas artikel. */}
        <details key={current} className="group mb-6 rounded-panel border border-line bg-surface lg:hidden">
          <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-[12px] text-ink-faint">Docs</span>
              <span className="block truncate text-[14px] font-semibold text-ink">{currentLabel}</span>
            </span>
            <ChevronDown className="h-[16px] w-[16px] shrink-0 text-ink-faint transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <nav aria-label="Docs" className="border-t border-line px-1 py-3">
            <DocsNavList current={current} />
          </nav>
        </details>

        <aside className="hidden lg:block">
          <nav aria-label="Docs" className="sticky top-[88px] max-h-[calc(100vh-112px)] overflow-y-auto pb-8 pr-1">
            <DocsNavList current={current} />
          </nav>
        </aside>

        <article className="min-w-0 max-w-[720px]">
          <div>
            {kicker && <p className="text-[13px] font-semibold text-accent">{kicker}</p>}
            <h1 className="mt-1 font-display text-[32px] font-semibold leading-[1.15] tracking-tight text-ink sm:text-[40px]">{title}</h1>
            {art && (
              /**
               * `<img>` biasa, bukan `next/image`: berkasnya sudah WebP berukuran tetap dengan dua lebar, jadi
               * optimizer tidak menambah apa pun, dan memakainya berarti menambah `images.localPatterns` di
               * `next.config.ts`.
               * `width`/`height` menahan tempatnya sebelum gambar datang (tanpa geser tata letak), dan ia
               * `fetchPriority="high"` karena di layar mana pun ia berada di atas lipatan.
               */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={art.src}
                srcSet={art.srcSet}
                sizes="(min-width: 768px) 720px, calc(100vw - 32px)"
                width={art.width}
                height={art.height}
                alt=""
                decoding="async"
                fetchPriority="high"
                className="mt-5 aspect-[12/5] h-auto w-full rounded-panel border border-line bg-[rgb(23,18,13)] object-cover"
              />
            )}
            {intro && <div className="mt-4 text-[16px] leading-[1.75] text-ink-soft sm:text-[17px]">{intro}</div>}
            {summary && summary.length > 0 && (
              <div className="mt-6 rounded-panel border border-line bg-surface p-4 sm:p-5">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">In short</p>
                <ul className="mt-2.5 space-y-2.5">
                  {summary.map((s) => (
                    <li key={s} className="flex gap-3 text-[15px] leading-relaxed text-ink sm:text-[16px]">
                      <span aria-hidden="true" className="mt-[0.7em] h-[6px] w-[6px] shrink-0 rounded-full bg-accent" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="mt-10">{children}</div>
          <Pager current={current} />
        </article>

        {toc && toc.length > 1 && (
          <aside className="hidden xl:block">
            <nav aria-label="On this page" className="sticky top-[88px] max-h-[calc(100vh-112px)] overflow-y-auto">
              <p className="pb-2 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">On this page</p>
              <ul className="space-y-1 border-l border-line">
                {toc.map((t) => (
                  <li key={t.id}>
                    <a href={`#${t.id}`} className="-ml-px block border-l border-transparent py-1 pl-3 text-[13px] leading-snug text-ink-soft transition-colors hover:border-accent hover:text-ink">
                      {t.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}
