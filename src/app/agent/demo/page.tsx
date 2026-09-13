import { exampleMarket } from "@/lib/registry";
import X402Demo from "./X402Demo";

/**
 * Dinamis, dengan alasan yang sama seperti `/x402`: sebagai halaman statis pilihan pasarnya
 * dibekukan saat build, jadi listing yang dicabut sesudahnya tetap didemokan sampai ada
 * build berikutnya. Halaman ini murah untuk dirender dan jarang diakses, jadi kebenaran
 * lebih berharga daripada cache-nya.
 */
export const dynamic = "force-dynamic";

/**
 * Server wrapper: memilih pasar mana yang didemokan, lalu menyerahkannya ke klien.
 *
 * Berkas ini ada karena komponen demonya harus `"use client"` — ia memegang state tombol
 * dan melakukan permintaan dari peramban pengunjung — sementara pemilihan pasar harus
 * dibaca dari registry, yang hanya ada di server. Sebelum pemisahan ini, komponen klien
 * menyelesaikannya dengan memaku `"adexto"`.
 *
 * Aturan pemilihannya SENGAJA tidak diduplikasi di sini. `exampleMarket()` yang memilih,
 * dan halaman `/x402` memakai fungsi yang sama, jadi kedua halaman tidak bisa mendemokan
 * pasar yang berbeda dan tidak bisa saling menyimpang saat listing berubah.
 */
export default function AgentDemoPage() {
  const market = exampleMarket();
  /**
   * Fallback `adexto` hanya berlaku kalau registry tidak punya pasar yang bisa diisi sama
   * sekali, keadaan yang juga membuat seluruh situs kehilangan halaman token. Ia ada supaya
   * halaman ini tetap merender sesuatu yang bisa dijelaskan alih-alih meledak, bukan
   * sebagai jalur normal.
   */
  return <X402Demo market={market?.slug ?? "adexto"} />;
}
