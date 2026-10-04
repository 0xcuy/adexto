/**
 * <Stat label="Outside traders" value={12} hint? size? align? className? />
 *
 * Satu angka dengan labelnya. Angka memakai `data-numeric` (digit lebar tetap, aturan global di
 * globals.css), jadi angka yang berubah tidak menggeser tata letak.
 *
 *   label  teks kecil di atas angka, 12 px. Tulis apa adanya; jangan huruf kapital semua.
 *   value  angka atau teks pendek yang sudah diformat pemanggil ("1,204", "$3.1k", "—").
 *   hint   baris kecil opsional di bawah angka (satuan, sumber, "index catching up").
 *   size   md = angka 20 px (bawaan, strip angka di kartu) · lg = 28 px (strip hero halaman).
 *   align  start (bawaan) · center.
 *
 * Wadah strip dibuat pemanggil (grid/flex), Stat hanya isinya. Tanpa state; server-safe.
 */
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  size?: "md" | "lg";
  align?: "start" | "center";
  className?: string;
}

export default function Stat({ label, value, hint, size = "md", align = "start", className }: StatProps) {
  return (
    <div className={cn("min-w-0", align === "center" && "text-center", className)}>
      <div className="text-[12px] leading-snug text-ink-faint">{label}</div>
      <div
        data-numeric
        className={cn(
          "mt-1 font-semibold leading-none tracking-tight text-ink",
          size === "lg" ? "font-display text-[28px]" : "text-[20px]"
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[12px] leading-snug text-ink-soft">{hint}</div>}
    </div>
  );
}
