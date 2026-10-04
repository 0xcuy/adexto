/**
 * <Skeleton className="h-[14px] w-24" shape? />
 *
 * Bentuk tempat isi yang sedang dimuat, memakai kelas `.skeleton` yang sudah ada di globals.css
 * (shimmer yang berhenti dengan `prefers-reduced-motion`). Hanya bentuk: kalau pembacaan GAGAL,
 * komponen pemanggil menulis teks galatnya sendiri, bukan membiarkan skeleton berputar terus.
 *
 *   className  ukuran WAJIB lewat kelas (tinggi dan lebar), supaya ruangnya sudah terpesan sebelum
 *              data tiba. Itu yang mencegah CLS (baseline 3 Okt: /explorer 0,35–0,47 karena daftar
 *              muncul sesudah spinner).
 *   shape      pill (bawaan, radius penuh) · rect (radius 8 px, untuk kartu/baris/grafik).
 *
 * aria-hidden: pembaca layar tidak membaca kotak kosong. Wadah yang sedang memuat sebaiknya diberi
 * `aria-busy="true"` dan satu teks sr-only ("Loading markets…"). Server-safe.
 */
import { cn } from "@/components/ui/cn";

export interface SkeletonProps {
  className?: string;
  shape?: "pill" | "rect";
}

export default function Skeleton({ className, shape = "pill" }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      // Radius rect lewat style: `.skeleton` di globals.css datang SESUDAH utilities dan memasang
      // border-radius 999px, jadi kelas `rounded-*` akan kalah.
      style={shape === "rect" ? { borderRadius: 8 } : undefined}
      className={cn("skeleton block", className)}
    />
  );
}
