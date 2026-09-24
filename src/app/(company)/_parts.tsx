/**
 * Potongan tipografi bersama untuk halaman Company.
 *
 * Diletakkan di berkas berawalan garis bawah supaya Next tidak memperlakukannya sebagai rute.
 * Kelas-kelasnya diambil dari `globals.css` yang sudah ada, bukan nilai baru: dokumen hukum
 * yang paletnya sedikit berbeda dari situsnya terlihat seperti ditempel dari tempat lain.
 */

/**
 * Satu daftar tautan Company, dipakai layout grup ini DAN footer.
 *
 * Tinggal di berkas berawalan garis bawah karena dua alasan: Next tidak memperlakukannya
 * sebagai rute, dan `layout.tsx` tidak boleh mengekspor const biasa — build menolaknya dengan
 * "does not match the required types of a Next.js Layout".
 */
export const COMPANY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/disclaimer", label: "Disclaimer" },
] as const;

export function PageTitle({ children, updated }: { children: React.ReactNode; updated: string }) {
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{children}</h1>
      {/* Tanggal ditulis di satu tempat per halaman dan bukan dihasilkan dari `new Date()`.
          Tanggal yang bergerak sendiri membuat dokumen tampak diperbarui padahal isinya tidak
          pernah disentuh. */}
      <p className="font-mono text-[11px] text-ink-faint">Last updated {updated}</p>
    </header>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-3 text-base font-semibold text-ink">{children}</h2>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-ink-soft">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-soft">{children}</ul>;
}

/** Kotak penekanan untuk pernyataan yang tidak boleh terlewat dibaca. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-warn/30 bg-warn/[0.07] p-3 text-[12px] leading-relaxed text-ink-soft">
      {children}
    </div>
  );
}
