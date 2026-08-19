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

export async function GET() {
  const { prices, live, fetchedAt, source } = await nativePrices();
  return NextResponse.json({ success: true, prices, live, source, updatedAt: fetchedAt });
}
