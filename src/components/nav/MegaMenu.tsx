"use client";

/**
 * <MegaMenu /> — navigasi desktop header (≥ lg): `Markets ▾  Build ▾` (UI-POLISH §6).
 *
 * Isi dari `HEADER_MENUS` di `src/config/nav.ts`. Perilaku buka/tutup ada di `MenuState.tsx`
 * (pola WAI-ARIA disclosure navigation). Setiap trigger membawa `data-nav-trigger` dan setiap panel
 * `data-nav-panel`; `tools/audit-layout.mjs` membuka panel lewat atribut itu di d1024–d1440.
 *
 * Panel diletakkan relatif ke <nav> (bukan ke trigger), jadi kedua panel mulai di garis kiri yang sama
 * dan panel Build selebar 760 px tetap di dalam layar 1024 px. <li> dan <nav> setinggi header, dan
 * panel memakai `pt-2` sebagai jembatan tak terlihat, jadi kursor yang turun dari trigger ke panel
 * tidak pernah keluar dari wadahnya.
 */
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { HEADER_MENUS, isNavActive, type NavMenu } from "@/config/nav";
import { CHAIN_LIST } from "@/lib/chains";
import ChainChip from "@/components/ui/ChainChip";
import NavPanel from "@/components/nav/NavPanel";
import { useNavMenu } from "@/components/nav/MenuState";
import { cn } from "@/components/ui/cn";

const PANEL_WIDTH: Record<string, string> = {
  markets: "w-[min(calc(100vw-32px),400px)]",
  build: "w-[min(calc(100vw-32px),760px)]",
};

/** Daftar chain di dasar panel Markets: setiap pasar hidup di salah satunya. */
function ChainFooter() {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[12px] font-medium text-ink-faint">Chains</span>
      {CHAIN_LIST.filter((c) => c.key !== "Devchain").map((c) => (
        <ChainChip key={c.chainId} chain={c} size="sm" />
      ))}
    </div>
  );
}

function MenuItem({ menu, pathname }: { menu: NavMenu; pathname: string }) {
  const m = useNavMenu(menu.key);
  const here = menu.columns.some((g) => g.items.some((i) => isNavActive(pathname, i)));
  return (
    <li ref={m.setRoot} {...m.rootProps} className="flex items-center">
      <button
        ref={m.triggerRef}
        {...m.triggerProps}
        className={cn(
          "inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-full pl-3 pr-2.5 text-[14px] font-medium transition-colors duration-150",
          m.isOpen || here ? "bg-cream-3 text-ink" : "text-ink-soft hover:bg-cream-3 hover:text-ink"
        )}
      >
        {menu.label}
        <ChevronDown
          className={cn("h-[14px] w-[14px] text-ink-faint transition-transform duration-200", m.isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <div {...m.panelProps} className={cn("absolute left-0 top-full z-50 pt-2 motion-safe:animate-nav-in", PANEL_WIDTH[menu.key])}>
        <NavPanel menu={menu} pathname={pathname} onNavigate={m.close} footer={menu.key === "markets" ? <ChainFooter /> : undefined} />
      </div>
    </li>
  );
}

export default function MegaMenu() {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Main" className="relative hidden self-stretch lg:flex">
      <ul className="flex items-stretch gap-1">
        {HEADER_MENUS.map((menu) => (
          <MenuItem key={menu.key} menu={menu} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}
