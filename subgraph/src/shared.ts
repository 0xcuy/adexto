import { BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Curve, CurveDayData, GlobalStats } from "../generated/schema";

/**
 * Pembantu bersama untuk kedua mapping.
 *
 * ATURAN YANG MENGIKAT SELURUH BERKAS DI DIREKTORI INI
 *
 * Tidak ada `.bind()` dan tidak ada `try_*` di mapping mana pun. RPC publik 0G
 * berjalan pruned — `eth_getBalance` gagal dengan `missing trie node` bahkan
 * 1.000 blok ke belakang — jadi setiap panggilan fungsi view akan mati begitu
 * subgraph mengejar dari startBlock. Semua yang dibutuhkan sudah dipancarkan oleh
 * event, jadi ini bukan pengorbanan; ia hanya harus dijaga.
 */

export const ZERO = BigInt.fromI32(0);
export const ONE = BigInt.fromI32(1);
export const ZERO_DEC = BigDecimal.fromString("0");
/** 1e18, untuk menyatakan harga dalam skala yang sama seperti kontrak. */
export const WAD = BigInt.fromString("1000000000000000000");
export const DAY = BigInt.fromI32(86400);

/**
 * Harga = reserveNative / reserveToken, sebagai BigDecimal.
 *
 * Pembagian dilakukan di BigDecimal, bukan BigInt: harga token di kurva ini
 * rutin berada di orde 1e-9 native, dan pembagian bilangan bulat akan
 * membulatkannya menjadi nol — yang berarti setiap grafik menjadi garis datar di
 * nol tanpa satu pun galat muncul.
 */
export function priceFrom(reserveNative: BigInt, reserveToken: BigInt): BigDecimal {
  if (reserveToken.equals(ZERO)) return ZERO_DEC;
  return reserveNative.toBigDecimal().div(reserveToken.toBigDecimal());
}

/**
 * Lantai harga: harga yang tercapai bila SETIAP token beredar dijual kembali,
 * yaitu (virtualNative + fee depth terkumpul) / curveTokens.
 *
 * Ini properti yang membedakan kurva ini — lantainya naik monoton seiring volume
 * karena irisan depth mengendap di dalam. Dihitung di sini supaya setiap klien
 * tidak perlu mengulang rumusnya dan tidak ada yang salah menuliskannya.
 */
export function floorPrice(virtualNative: BigInt, depthFees: BigInt, curveTokens: BigInt): BigDecimal {
  if (curveTokens.equals(ZERO)) return ZERO_DEC;
  return virtualNative.plus(depthFees).toBigDecimal().div(curveTokens.toBigDecimal());
}

export function globalStats(): GlobalStats {
  let g = GlobalStats.load("global");
  if (g == null) {
    g = new GlobalStats("global");
    g.totalProjects = ZERO;
    g.totalCurves = ZERO;
    g.totalSwaps = ZERO;
    g.totalVolumeNative = ZERO;
    g.totalDepthFees = ZERO;
    g.totalCreatorFees = ZERO;
    g.totalTreasuryFees = ZERO;
    g.totalTokensBurned = ZERO;
    g.lastUpdatedTimestamp = ZERO;
  }
  return g as GlobalStats;
}

/**
 * Ember harian untuk satu kurva.
 *
 * `open` hanya ditulis saat ember dibuat, `high`/`low` diperluas, `close` selalu
 * ditimpa. Itu membuat lilinnya konsisten dengan urutan swap sesungguhnya alih-alih
 * dengan urutan pembacaan klien.
 */
export function dayData(curve: Curve, event: ethereum.Event, priceAfter: BigDecimal): CurveDayData {
  const dayStart = event.block.timestamp.div(DAY).times(DAY);
  const id = curve.id + "-" + dayStart.toString();

  let d = CurveDayData.load(id);
  if (d == null) {
    d = new CurveDayData(id);
    d.curve = curve.id;
    d.dayStartTimestamp = dayStart;
    d.volumeNative = ZERO;
    d.swapCount = ZERO;
    d.openPriceNative = priceAfter;
    d.highPriceNative = priceAfter;
    d.lowPriceNative = priceAfter;
    d.depthFees = ZERO;
    d.creatorFees = ZERO;
    d.treasuryFees = ZERO;
  }
  if (priceAfter.gt(d.highPriceNative)) d.highPriceNative = priceAfter;
  // Nol bukan harga; ia hanya berarti reserve token kosong. Membiarkannya masuk
  // sebagai `low` akan menjatuhkan setiap lilin ke nol.
  if (priceAfter.gt(ZERO_DEC) && (d.lowPriceNative.equals(ZERO_DEC) || priceAfter.lt(d.lowPriceNative))) {
    d.lowPriceNative = priceAfter;
  }
  d.closePriceNative = priceAfter;
  return d as CurveDayData;
}

/** Id log yang stabil: satu tx bisa memuat beberapa swap. */
export function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

export function toBytes(value: Bytes): Bytes {
  return value;
}
