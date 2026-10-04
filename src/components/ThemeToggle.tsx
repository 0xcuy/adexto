"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";
import { consentAllowsPreferences } from "@/components/CookieConsent";

/**
 * Tombol ganti tema gelap/terang.
 *
 * Render pertama tidak tahu tema sebenarnya (skrip <head> mungkin sudah menggantinya),
 * jadi ikon ditentukan sesudah mount. Sebelum itu tombolnya tetap ada dan bisa diklik,
 * hanya ikonnya netral — lebih baik daripada ikon yang salah lalu melompat.
 */
export default function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "row" }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const toggle = () => {
    const next: Theme = readTheme() === "dark" ? "light" : "dark";
    applyTheme(next, consentAllowsPreferences());
    setTheme(next);
  };

  const label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  const Icon = theme === "light" ? Moon : Sun;

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className="flex w-full items-center justify-between rounded-panel px-3 py-3 text-[14px] font-medium text-ink transition-colors hover:bg-cream-3"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon className="h-4 w-4" />
          </span>
          {theme === "light" ? "Dark theme" : "Light theme"}
        </span>
        <span className="text-[11px] text-ink-faint">{theme === "light" ? "light on" : "dark on"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      // 40 px di layar sentuh (di bawah lg), 31,5 px (`h-9`) di desktop seperti sebelumnya.
      className="flex h-[40px] w-[40px] items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-cream-3 hover:text-ink lg:h-9 lg:w-9"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
