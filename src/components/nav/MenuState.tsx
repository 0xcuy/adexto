"use client";

/**
 * Keadaan bersama panel mega menu header (Plan UI-1 U1.2): SATU panel terbuka sekali waktu, baik
 * panel di kiri (Markets, Build) maupun panel Launch di ujung kanan header.
 *
 * Pola WAI-ARIA "disclosure navigation", bukan `role="menu"`: trigger adalah <button
 * aria-expanded aria-controls>, panel adalah daftar tautan biasa yang disembunyikan dengan `hidden`.
 * Tautan tetap tautan (Tab berjalan seperti biasa, klik tengah membuka tab baru).
 *
 *   <NavMenuProvider>…header…</NavMenuProvider>
 *   const m = useNavMenu("markets");
 *   <li ref={m.setRoot} {...m.rootProps}>
 *     <button ref={m.triggerRef} {...m.triggerProps}>Markets</button>
 *     <div {...m.panelProps}>…<Link data-nav-item onClick={m.close}>…</Link>…</div>
 *   </li>
 *
 * Perilaku:
 *   - Mouse: buka sesudah kursor diam 120 ms di atas wadahnya (jeda niat), tutup 200 ms sesudah kursor
 *     meninggalkan trigger DAN panel. Bila panel lain sedang terbuka, pindah langsung tanpa jeda.
 *   - Sentuh/pena: hanya ketuk (klik). Hover diabaikan.
 *   - Klik/Enter/Space: buka/tutup. Klik dalam 400 ms sesudah hover membukanya tidak menutup lagi
 *     (hover + klik di perangkat hibrida, dan `hover()` lalu `click()` di audit-layout).
 *   - ArrowDown di trigger: buka dan fokus tautan pertama. ↑/↓/Home/End di panel: pindah tautan.
 *   - Esc: tutup, fokus kembali ke trigger. Klik di luar, fokus keluar wadah, pindah rute: tutup.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

export type NavMenuKey = "markets" | "build" | "launch";

interface Ctx {
  open: NavMenuKey | null;
  openRef: { current: NavMenuKey | null };
  setOpen: (key: NavMenuKey | null) => void;
}

const MenuCtx = createContext<Ctx | null>(null);

export function NavMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState<NavMenuKey | null>(null);
  const openRef = useRef<NavMenuKey | null>(null);
  const setOpen = useCallback((key: NavMenuKey | null) => {
    openRef.current = key;
    setOpenState(key);
  }, []);

  // Pindah rute selalu menutup panel, supaya tidak tertinggal menutupi halaman baru.
  const pathname = usePathname();
  useEffect(() => {
    setOpen(null);
  }, [pathname, setOpen]);

  const value = useMemo(() => ({ open, openRef, setOpen }), [open, setOpen]);
  return <MenuCtx.Provider value={value}>{children}</MenuCtx.Provider>;
}

const OPEN_DELAY = 120;
const CLOSE_DELAY = 200;
const CLICK_GRACE = 400;

export function useNavMenu(key: NavMenuKey) {
  const ctx = useContext(MenuCtx);
  if (!ctx) throw new Error("useNavMenu must be used inside <NavMenuProvider>");
  const { open, openRef, setOpen } = ctx;
  const isOpen = open === key;

  const panelId = `nav-panel-${key}-${useId().replace(/:/g, "")}`;
  const rootRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverOpenedAt = useRef(0);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  const close = useCallback(() => {
    if (openRef.current === key) setOpen(null);
  }, [key, openRef, setOpen]);

  const items = () => [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-nav-item]") ?? [])];

  // Esc dan klik di luar hanya didengar selama panel ini terbuka.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    const onDown = (e: globalThis.PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [isOpen, close]);

  const rootProps = {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
      if (openRef.current === key) return;
      const now = () => {
        hoverOpenedAt.current = Date.now();
        setOpen(key);
      };
      if (openRef.current !== null) now();
      else openTimer.current = setTimeout(now, OPEN_DELAY);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (openTimer.current) clearTimeout(openTimer.current);
      openTimer.current = null;
      closeTimer.current = setTimeout(close, CLOSE_DELAY);
    },
    onBlur: (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && rootRef.current && !rootRef.current.contains(next)) close();
    },
  };

  const triggerProps = {
    type: "button" as const,
    "data-nav-trigger": "",
    "aria-expanded": isOpen,
    "aria-controls": panelId,
    onClick: () => {
      // Kedua timer dibatalkan: timer tutup sisa pointerleave sebelumnya pernah menutup panel yang baru
      // saja dibuka lewat Enter (terukur 4 Okt: terbuka di +50 ms, tertutup sendiri di +150 ms).
      clearTimers();
      if (openRef.current === key) {
        if (Date.now() - hoverOpenedAt.current < CLICK_GRACE) return;
        setOpen(null);
      } else {
        hoverOpenedAt.current = 0;
        setOpen(key);
      }
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        clearTimers();
        hoverOpenedAt.current = 0;
        setOpen(key);
        // Panel baru terlihat sesudah render berikutnya.
        requestAnimationFrame(() => items()[0]?.focus());
      }
    },
  };

  const panelProps = {
    id: panelId,
    "data-nav-panel": "",
    hidden: !isOpen,
    onKeyDown: (e: KeyboardEvent) => {
      const list = items();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      let next = -1;
      if (e.key === "ArrowDown") next = i < 0 ? 0 : (i + 1) % list.length;
      else if (e.key === "ArrowUp") next = i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = list.length - 1;
      if (next < 0) return;
      e.preventDefault();
      list[next].focus();
    },
  };

  // Ref panggilan balik, supaya wadahnya boleh elemen apa saja (<li>, <div>).
  const setRoot = useCallback((el: HTMLElement | null) => {
    rootRef.current = el;
  }, []);

  return { isOpen, close, setRoot, triggerRef, rootProps, triggerProps, panelProps };
}
