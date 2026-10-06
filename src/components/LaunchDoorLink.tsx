"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { LAUNCH_SHEET_ID, launchSheetAvailable, openLaunchSheet } from "@/components/nav/launch-sheet";

/**
 * Pintu "Launch" di landing.
 *
 * Di ponsel dan tablet (ada tab bar) ia membuka lembar Launch yang SAMA dengan tab Launch: Studio atau Agent.
 * Mulai lg tetap tautan ke /studio, sama dengan bagian kiri tombol Launch di header.
 *
 * Tetap `<a href>`: tanpa JS, klik tengah, atau Ctrl/Cmd/Shift+klik membuka Studio seperti tautan biasa. Atribut
 * `aria-haspopup` baru dipasang sesudah mount, saat lembarnya memang ada, supaya HTML server tidak menjanjikan
 * dialog di desktop.
 */
export default function LaunchDoorLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  const [opensSheet, setOpensSheet] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setOpensSheet(launchSheetAvailable());
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!launchSheetAvailable()) return;
    e.preventDefault();
    openLaunchSheet(e.currentTarget);
  };

  return (
    <Link
      href={href}
      className={className}
      onClick={onClick}
      aria-haspopup={opensSheet ? "dialog" : undefined}
      aria-controls={opensSheet ? LAUNCH_SHEET_ID : undefined}
    >
      {children}
    </Link>
  );
}
