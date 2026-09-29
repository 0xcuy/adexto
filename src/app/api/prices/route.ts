/**
 * GET /api/prices — harga USD aset native.
 *
 * Sebelumnya route ini menarik ETH/ARB/BTC dari Binance, 0G dari CoinGecko, dan
 * MON tidak pernah ditarik sama sekali: nilainya dipaku 0,25 padahal pasar
 * menyebut ~0,022. Akibatnya setiap angka USD untuk pasar Monad — harga, market
 * cap, nilai fee — tampil sekitar 11x lebih tinggi daripada kenyataan.
 *
 * Lebih buruk lagi, route lama selalu membalas `success: true` walau seluruh feed
 * gagal dan angkanya berasal dari nilai cadangan, sehingga pemanggil tidak punya
 * cara membedakan harga nyata dari tebakan.
 *
 * Keduanya kini ditangani `src/lib/native-price.ts`, dan `live` diteruskan ke
 * pemanggil supaya bisa memutuskan sendiri — khususnya jalur launch, yang harus
 * MENOLAK menetapkan market cap dari harga tebakan.
 */
import { NextResponse } from "next/server";
import { nativePrices } from "@/lib/native-price";
import { recordFx } from "@/lib/fx-history";

export async function GET() {
  const { prices, live, fetchedAt, source } = await nativePrices();
  /**
   * Kurs yang teramati DIREKAM di sini, bukan lewat penjadwal.
   *
   * Alasannya ada di `src/lib/fx-history.ts`: chart USD hanya boleh digambar dari kurs yang
   * benar-benar pernah diamati, dan route ini satu-satunya tempat kurs melewati server.
   * Tanpa proses tambahan dan tanpa cron — selama ada yang membuka situsnya, riwayatnya
   * bertambah. Hanya harga `live` yang direkam; nilai cadangan adalah tebakan.
   *
   * `source` diteruskan karena hanya bacaan upstream yang sungguhan boleh masuk riwayat —
   * alasannya ada di `recordFx`. Bacaan dari cache adalah pengamatan yang SAMA dibaca ulang.
   *
   * Dibungkus try/catch: gagal menulis riwayat tidak boleh menggagalkan pembacaan harga.
   */
  try {
    recordFx(prices, live, source);
  } catch {
    // riwayat tidak wajib untuk pembacaan harga
  }
  return NextResponse.json({ success: true, prices, live, source, updatedAt: fetchedAt });
}
