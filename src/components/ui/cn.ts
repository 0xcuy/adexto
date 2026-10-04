/**
 * cn(...inputs): string
 *
 * Penggabung kelas untuk semua primitives di `src/components/ui/`. `clsx` menyaring nilai palsu
 * (`cond && "kelas"`), `tailwind-merge` membuang kelas Tailwind yang bertabrakan sehingga
 * `className` dari pemakai MENANG atas bawaan komponen:
 *
 *   cn("h-[40px] px-4", "px-6")   → "h-[40px] px-6"
 *
 * Tanpa merge, `px-4 px-6` dua-duanya tetap ada dan yang menang ditentukan urutan di berkas CSS
 * hasil build, bukan urutan di atribut, jadi override diam-diam gagal.
 *
 * Token radius situs (`rounded-card`, `rounded-panel`) didaftarkan supaya ikut di-merge dengan
 * `rounded-xl` dan kawan-kawan. Kedua paket sudah ada di package.json; tidak ada dependensi baru.
 */
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  extend: {
    theme: {
      borderRadius: ["card", "panel"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
