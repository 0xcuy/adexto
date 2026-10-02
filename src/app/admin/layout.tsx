import type { Metadata } from "next";

/** `/admin` tidak untuk mesin pencari: halaman alat owner, dan setiap aksinya butuh tanda tangan admin. */
export const metadata: Metadata = {
  title: "Admin · ADEXTO",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
