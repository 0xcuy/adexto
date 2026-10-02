import { plainDecimal } from "@/lib/pricing";

/**
 * Versi tampilan kartu, ikut di URL kartu sebagai `&v=`.
 *
 * Kartu versi pertama dikirim dengan bawaan `ImageResponse`, `immutable, max-age=31536000`, jadi
 * peramban dan pratinjau tautan yang pernah membukanya menyimpan kartu itu setahun tanpa pernah
 * bertanya lagi — termasuk kartu yang tautannya `0.0.0.0:3000`. URL baru adalah satu-satunya
 * cara menjangkau mereka. Naikkan angka ini setiap kali tampilan kartu berubah.
 */
// 3: logo chain di chip chain (2026-10-02).
export const SHARE_CARD_VERSION = 3;

/**
 * Format angka uang untuk KARTU GAMBAR.
 *
 * Kartu tidak bisa memakai `formatUsd` situs ini, karena notasi subskripnya (`0.0₅58`) tidak
 * punya glif di font bawaan satori dan tergambar sebagai kotak — di gambar yang justru
 * dibagikan ke luar.
 *
 * Tapi `plainDecimal(Number(v.toPrecision(4)))` juga salah, dan ini terlihat di kartu pertama:
 * nilai 0,07472 tercetak `0.07471999999999999476`. Sebabnya `plainDecimal` memakai
 * `toFixed(20)`, yang membuka seluruh galat pembulatan biner dari angka yang sudah dibulatkan.
 *
 * Jadi aturannya dipisah menurut besarannya, karena dua besaran itu butuh dua hal berbeda:
 *   - >= 0,01 → dua desimal. Ini uang biasa; presisi lebih dari itu hanya derau.
 *   - < 0,01  → desimal polos dari empat digit signifikan, karena harga token memang sekecil
 *     itu dan membulatkannya ke dua desimal akan mencetak "$0.00" untuk pasar yang hidup.
 */
export function cardUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1000) return `$${Math.round(value).toLocaleString("en-US")}`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  return `$${fourSignificant(value)}`;
}

/** Aturan yang sama untuk jumlah bersatuan aset native. */
export function cardNative(value: number, symbol: string): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const text = value >= 0.01 ? value.toFixed(4) : fourSignificant(value);
  return `${text} ${symbol}`;
}

/**
 * Desimal polos dengan empat digit signifikan untuk 0 < value < 0,01, disusun dari string
 * `toExponential`, bukan dari angka.
 *
 * `plainDecimal(Number(v.toPrecision(4)))` membuka galat biner lewat `toFixed(20)`: PnL 0,002045
 * tercetak `0.00204499999999999994` di kartu posisi. Digit dari `toExponential(3)` sudah
 * dibulatkan dan tidak pernah kembali menjadi float, jadi ekor itu tidak bisa muncul.
 */
function fourSignificant(value: number): string {
  if (value >= 0.01) return plainDecimal(Number(value.toPrecision(4)));
  const [mantissa, exponent] = value.toExponential(3).split("e");
  const digits = mantissa.replace(".", "").replace(/0+$/, "") || "0";
  return `0.${"0".repeat(-Number(exponent) - 1)}${digits}`;
}
