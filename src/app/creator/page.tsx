import CreatorDashboard from "@/components/CreatorDashboard";
export const metadata = {
  title: "Creator earnings · ADEXTO",
  description:
    "What every market you launched has earned, read from each curve on every chain, with claims per market or per chain.",
};
/**
 * `?address=` dibaca di server dan diteruskan ke dasbor (U2.5), supaya HTML pertama sudah memesan ruang daftar untuk
 * alamat itu. Halaman jadi dirender per permintaan; isinya tetap tanpa data server (angka dibaca dasbor dari
 * `/api/creator/earnings` sesudah halaman tampil), jadi render ini murah.
 */
export default async function CreatorPage({ searchParams }: { searchParams: Promise<{ address?: string | string[] }> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.address) ? sp.address[0] : sp.address;
  return <CreatorDashboard initialAddress={raw ?? null} />;
}
