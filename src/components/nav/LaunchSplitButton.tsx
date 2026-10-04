"use client";

/**
 * <LaunchSplitButton /> — tombol `Launch | ▾` di ujung kanan header (UI-POLISH §6).
 *
 * Bagian kiri tetap TAUTAN langsung ke /studio: satu klik seperti sebelumnya, dan satu-satunya isian
 * aksen di bar ini. `▾` (mulai lg) membuka panel Launch dari `LAUNCH_MENU` di nav.ts: dua kartu besar
 * "Launch a token" dan "Launch with your agent", lalu Agents, Creator earnings, Rewards.
 *
 * Hover hanya dibaca di `▾` dan panelnya, bukan di tautan Launch, supaya kursor yang menuju tombol utama
 * tidak membuka panel. Di bawah lg `▾` disembunyikan: tujuan yang sama ada di lembar More tab bar.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { LAUNCH_MENU } from "@/config/nav";
import NavPanel from "@/components/nav/NavPanel";
import { useNavMenu } from "@/components/nav/MenuState";
import { cn } from "@/components/ui/cn";

export default function LaunchSplitButton() {
  const pathname = usePathname() ?? "/";
  const m = useNavMenu("launch");
  const { onBlur, ...hover } = m.rootProps;
  return (
    <div ref={m.setRoot} onBlur={onBlur} className="relative hidden items-center self-stretch sm:flex">
      {/* `h-[42px]` di sm–lg sama dengan segmented control chain/dompet di sebelahnya; `h-9` mulai lg. */}
      <div className="btn-glow flex h-[42px] items-stretch rounded-xl bg-accent text-white lg:h-9">
        <Link
          href="/studio"
          className="inline-flex items-center rounded-xl px-4 text-[13px] font-semibold transition-colors hover:bg-accent-strong lg:rounded-r-none lg:pr-3"
        >
          Launch
        </Link>
        <button
          ref={m.triggerRef}
          {...m.triggerProps}
          {...hover}
          aria-label="Launch options"
          className="hidden w-[30px] items-center justify-center rounded-r-xl border-l border-white/25 transition-colors hover:bg-accent-strong lg:inline-flex"
        >
          <ChevronDown className={cn("h-[14px] w-[14px] transition-transform duration-200", m.isOpen && "rotate-180")} aria-hidden="true" />
        </button>
      </div>
      <div {...m.panelProps} {...hover} className="absolute right-0 top-full z-50 w-[min(calc(100vw-32px),560px)] pt-2 motion-safe:animate-nav-in">
        <NavPanel menu={LAUNCH_MENU} pathname={pathname} onNavigate={m.close} />
      </div>
    </div>
  );
}
