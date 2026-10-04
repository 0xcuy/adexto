import { NextResponse } from "next/server";
import { launchCosts } from "@/lib/launch-cost";
import { publicErrorMessage } from "@/lib/public-error";

/**
 * GET /api/launch-cost — biaya membuka satu pasar, per chain, dihitung hidup.
 *
 * Angka yang sama dengan halaman depan (`src/lib/launch-cost.ts`), sekarang bisa dibaca
 * Studio di langkah review: satuan gas `deployTrinity` yang diukur × harga gas chain itu saat
 * ini × harga token native. Chain yang RPC-nya tidak menjawab dilaporkan `live: false` dengan
 * angka null — Studio menyatakan "not readable", tidak menampilkan angka lama.
 *
 * Tidak ada input dari pemanggil dan tidak ada yang ditulis; harga gas di-cache lima menit oleh
 * `fetch` dan kurs 60 detik oleh `nativePrices()`, jadi endpoint ini murah dipanggil.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const costs = await launchCosts();
    return NextResponse.json(
      { success: true, costs, readAt: new Date().toISOString() },
      { headers: { "cache-control": "public, max-age=30" } }
    );
  } catch (error: any) {
    return NextResponse.json({ success: false, error: publicErrorMessage(error), costs: [] }, { status: 502 });
  }
}
