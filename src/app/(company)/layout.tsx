import Link from "next/link";
import { COMPANY_LINKS } from "./_parts";

/**
 * Kerangka bersama untuk kelima halaman Company.
 *
 * KENAPA SATU LAYOUT, BUKAN LIMA HALAMAN YANG MASING-MASING MENGGAMBAR KERANGKANYA
 *
 * Kelimanya berupa dokumen teks dengan bentuk yang sama: judul, tanggal, prosa. Menyalin
 * kerangkanya lima kali berarti lima tempat yang harus diubah setiap kali paletnya bergeser,
 * dan pengalaman di repo ini menunjukkan yang terjadi adalah salah satunya tertinggal.
 *
 * Grup rute `(company)` TIDAK menambah segmen URL. Halamannya tetap `/about`, `/privacy` dan
 * seterusnya — tanda kurung itulah yang membuat foldernya sekadar pengelompokan, jadi tautan
 * yang dipasang di footer tidak berubah bentuk hanya karena berkasnya dikelompokkan.
 */

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <nav aria-label="Company" className="mb-8 flex flex-wrap gap-1.5 border-b border-line pb-4">
        {COMPANY_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-ink-soft transition-colors hover:bg-cream-3 hover:text-ink"
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <article className="space-y-5">{children}</article>
    </div>
  );
}
