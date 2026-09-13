import { exampleMarkets } from "@/lib/registry";
import X402Demo from "./X402Demo";

/**
 * Dinamis, dengan alasan yang sama seperti `/x402`: sebagai halaman statis pilihan pasarnya
 * dibekukan saat build, jadi listing yang dicabut sesudahnya tetap didemokan sampai ada
 * build berikutnya. Halaman ini murah untuk dirender dan jarang diakses, jadi kebenaran
 * lebih berharga daripada cache-nya.
 */
export const dynamic = "force-dynamic";

/**
 * Server wrapper: menyerahkan DAFTAR pasar yang bisa didemokan ke klien.
 *
 * Berkas ini ada karena komponen demonya harus `"use client"` — ia memegang state tombol dan
 * melakukan permintaan dari peramban pengunjung — sementara pemilihan pasar harus dibaca dari
 * registry, yang hanya ada di server.
 *
 * Dua versi sebelumnya sama-sama terlalu sempit. Yang pertama memaku `"adexto"` di komponen
 * klien. Yang kedua meneruskan satu pasar dari `exampleMarket()`, yang mengutamakan Monad —
 * jadi halaman yang gunanya memperlihatkan pembelian LINTAS chain hanya pernah memperlihatkan
 * satu chain. Sekarang klien menerima seluruh daftar dan pengunjung memilih, sehingga 0G dan
 * Monad dua-duanya bisa dicoba pada gerbang yang sama.
 *
 * Aturan pemilihannya tetap tidak diduplikasi: `exampleMarkets()` yang menyusunnya, dan
 * `/x402` memakai fungsi yang sama.
 */
export default function AgentDemoPage() {
  const markets = exampleMarkets().map((m) => ({
    slug: m.slug,
    symbol: m.symbol,
    chainLabel: m.chainLabel,
    chainId: m.chainId,
  }));

  /**
   * Fallback hanya berlaku kalau registry tidak punya satu pun pasar yang bisa diisi, keadaan
   * yang juga membuat seluruh situs kehilangan halaman token. Ia ada supaya halaman ini tetap
   * merender sesuatu yang bisa dijelaskan alih-alih meledak, bukan sebagai jalur normal.
   */
  return (
    <X402Demo
      markets={markets.length > 0 ? markets : [{ slug: "adexto", symbol: "ADEXTO", chainLabel: "0G Mainnet", chainId: 16661 }]}
    />
  );
}
