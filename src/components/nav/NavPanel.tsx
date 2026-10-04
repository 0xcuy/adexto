/**
 * <NavPanel menu={NavMenu} pathname onNavigate footer? />
 *
 * Isi satu panel mega menu desktop, dibangun dari `src/config/nav.ts` (satu sumber dengan tab bar
 * ponsel dan footer). Setiap tujuan adalah kartu: ikon, judul, satu baris deskripsi. Panel Launch
 * memuat dua kartu besar di atas (`menu.featured`).
 *
 *   menu        NavMenu dari nav.ts (HEADER_MENUS / LAUNCH_MENU).
 *   pathname    rute sekarang, untuk `aria-current="page"`.
 *   onNavigate  dipanggil saat tautan diklik (menutup panel; perlu untuk tautan #anchor di rute
 *               yang sama, karena pindah hash tidak mengganti pathname).
 *   footer      isi opsional di dasar panel (panel Markets: daftar chain).
 *
 * Setiap tautan membawa `data-nav-item`, dipakai MenuState untuk navigasi ↑/↓. Grup diberi
 * `role="group"` + judul bila panel punya lebih dari satu kolom. Tidak ada state sendiri.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { isNavActive, type NavItem, type NavMenu } from "@/config/nav";
import { cn } from "@/components/ui/cn";

function ItemLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const active = isNavActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      data-nav-item=""
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-cream-2 focus-visible:bg-cream-2",
        active && "bg-cream-2"
      )}
    >
      <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 pt-px">
        <span className={cn("block text-[14px] font-semibold leading-snug", active ? "text-accent" : "text-ink")}>{item.label}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{item.description}</span>
      </span>
    </Link>
  );
}

function FeaturedLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const active = isNavActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      data-nav-item=""
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className="group flex min-h-[128px] flex-col rounded-panel border border-line bg-cream-2 p-4 transition-colors hover:border-accent/40 hover:bg-cream-3 focus-visible:border-accent/40"
    >
      <span className="flex h-[40px] w-[40px] items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon className="h-[20px] w-[20px]" aria-hidden="true" />
      </span>
      <span className="mt-3 flex items-center gap-1.5 text-[16px] font-semibold leading-snug text-ink">
        {item.label}
        <ArrowRight className="h-[14px] w-[14px] text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
      <span className="mt-1 text-[13px] leading-snug text-ink-soft">{item.description}</span>
    </Link>
  );
}

export default function NavPanel({
  menu,
  pathname,
  onNavigate,
  footer,
}: {
  menu: NavMenu;
  pathname: string;
  onNavigate: () => void;
  footer?: ReactNode;
}) {
  const multi = menu.columns.length > 1;
  return (
    <div className="rounded-panel border border-line bg-surface p-2 shadow-[var(--shadow-lift)]">
      {menu.featured && menu.featured.length > 0 && (
        <div className="grid grid-cols-2 gap-2 p-1">
          {menu.featured.map((item) => (
            <FeaturedLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </div>
      )}
      <div className={cn("grid gap-2", multi && "grid-cols-[minmax(0,2fr)_minmax(0,1fr)]", menu.featured && "mt-1 border-t border-line pt-2")}>
        {menu.columns.map((group, gi) => {
          const headingId = `nav-${menu.key}-${group.key}-heading`;
          // Kolom pertama di panel berkolom banyak cukup lebar untuk dua baris kartu berdampingan.
          const twoUp = multi && gi === 0 && group.items.length > 3;
          return (
            <div key={group.key} role="group" aria-labelledby={multi ? headingId : undefined} aria-label={multi ? undefined : group.label}>
              {multi && (
                <p id={headingId} className="px-2.5 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                  {group.label}
                </p>
              )}
              <ul className={cn("grid gap-0.5", twoUp && "grid-cols-2")}>
                {group.items.map((item) => (
                  <li key={item.href}>
                    <ItemLink item={item} pathname={pathname} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {footer && <div className="mt-1 border-t border-line px-2.5 pb-1 pt-2.5">{footer}</div>}
    </div>
  );
}
