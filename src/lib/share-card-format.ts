import { plainDecimal } from "@/lib/pricing";

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
  return `$${plainDecimal(Number(value.toPrecision(4)))}`;
}

/** Aturan yang sama untuk jumlah bersatuan aset native. */
export function cardNative(value: number, symbol: string): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const text = value >= 0.01 ? value.toFixed(4) : plainDecimal(Number(value.toPrecision(4)));
  return `${text} ${symbol}`;
}
