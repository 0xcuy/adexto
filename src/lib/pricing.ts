/**
 * Price handling with explicit units.
 *
 * The old code stored prices as display strings ("0.0184 0G", "0.00018 ETH") and
 * the frontend did `price.replace(/[^0-9.]/g, "")` before using the number as USD.
 * That made QNOVA — priced at 0.00018 ETH, i.e. roughly $0.34 — render as $0.00018
 * and every "You Receive" estimate was wrong by the same factor.
 *
 * Every record now carries a numeric `priceNative` plus the `nativeSymbol` it is
 * denominated in. USD is always derived through the live price feed.
 */

export type AssetPrices = Record<string, number>;

export const FALLBACK_PRICES: AssetPrices = {
  ETH: 2650,
  "0G": 0.15,
  A0GI: 0.15,
  USDC: 1,
  USDT: 1,
  cbBTC: 62500,
  ARB: 0.55,
  MON: 0.25,
};

export interface ParsedPrice {
  amount: number;
  unit: string | null;
}

/** Parse "0.00018 ETH" / "$0.0184" / 0.15 into an amount plus its unit. */
export function parsePriceString(value: string | number | null | undefined): ParsedPrice {
  if (value === null || value === undefined) return { amount: 0, unit: null };
  if (typeof value === "number") return { amount: Number.isFinite(value) ? value : 0, unit: null };

  const raw = String(value).trim();
  if (!raw) return { amount: 0, unit: null };

  const numberMatch = raw.match(/-?\d+(?:[.,]\d+)?/);
  const amount = numberMatch ? Number(numberMatch[0].replace(/,/g, "")) : 0;

  if (raw.includes("$") || /\bUSD\b/i.test(raw)) return { amount, unit: "USD" };

  const unitMatch = raw.match(/(?:\d|\s)([A-Za-z][A-Za-z0-9]{1,7})\s*$/);
  return { amount: Number.isFinite(amount) ? amount : 0, unit: unitMatch ? unitMatch[1].toUpperCase() : null };
}

export function assetPriceUsd(symbol: string | null | undefined, prices: AssetPrices): number {
  if (!symbol) return 0;
  const key = symbol.toUpperCase();
  if (key === "USD") return 1;
  return prices[symbol] ?? prices[key] ?? FALLBACK_PRICES[symbol] ?? FALLBACK_PRICES[key] ?? 0;
}

/** Convert an amount denominated in `unit` into USD. */
export function toUsd(amount: number, unit: string | null | undefined, prices: AssetPrices): number {
  if (!Number.isFinite(amount) || amount === 0) return 0;
  if (!unit || unit.toUpperCase() === "USD") return amount;
  return amount * assetPriceUsd(unit, prices);
}

/** Derive a token's USD price from its native-denominated price. */
export function tokenPriceUsd(
  priceNative: number | null | undefined,
  nativeSymbol: string | null | undefined,
  prices: AssetPrices
): number {
  if (!priceNative || !Number.isFinite(priceNative)) return 0;
  return toUsd(priceNative, nativeSymbol ?? null, prices);
}

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
const toSubscript = (n: number) =>
  String(n)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)] ?? d)
    .join("");

/**
 * Harga token baru sering sekecil 1e-10. Dua cara lama sama-sama gagal:
 * `toFixed(9)` memberi "0.000000000" (informasinya hilang total) dan
 * `toExponential()` memberi "9.37e-12" yang terbaca seperti pesan error.
 *
 * Notasi subscript adalah yang dipakai DEX arus utama: jumlah nol setelah titik
 * ditulis kecil, lalu digit signifikan. 0,00000000000937 -> "0.0₁₁937".
 * Presisi tetap terbaca dan lebarnya tidak meledak.
 */
export function formatSmallNumber(value: number, sigDigits = 4): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 0.001) {
    const digits = abs >= 1 ? 4 : 6;
    return sign + trimZeros(abs.toFixed(digits));
  }

  const exp = Math.floor(Math.log10(abs));
  const zeros = -exp - 1;
  const mantissa = abs / 10 ** exp;
  const digits = trimZeros(mantissa.toFixed(sigDigits - 1)).replace(".", "");
  // Di bawah 3 nol, tulis biasa saja — subscript justru lebih sulit dibaca.
  if (zeros < 3) return sign + trimZeros(abs.toFixed(zeros + sigDigits));
  return `${sign}0.0${toSubscript(zeros)}${digits}`;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/**
 * Angka desimal utuh, tanpa notasi ringkas — untuk isi tooltip.
 *
 * Notasi subscript memang padat, tapi ia menuntut pembaca tahu aturannya:
 * `0.0₅15` berarti titik, lima nol, lalu 15. Yang belum tahu hanya bisa menebak,
 * dan tidak ada apa pun di layar yang mengajarkan. Ini menyediakan angka aslinya
 * saat kursor diarahkan, sehingga notasinya bisa tetap padat tanpa menyandera
 * informasi.
 */
export function plainDecimal(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  // toFixed(20) melampaui presisi double, jadi cukup untuk harga token apa pun,
  // lalu nol di ujung dibuang supaya tidak jadi ekor panjang tanpa makna.
  return trimZeros(value.toFixed(20));
}

export function formatUsd(value: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  const abs = Math.abs(value);

  if (opts.compact && abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (opts.compact && abs >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;

  // Nilai sangat kecil dulu jadi notasi eksponensial ("$9.37e-12"); sekarang
  // subscript supaya terbaca sebagai harga, bukan sebagai galat.
  if (abs < 0.01) return `$${formatSmallNumber(value)}`;
  if (abs < 1) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNative(value: number, symbol: string): string {
  if (!Number.isFinite(value) || value === 0) return `0 ${symbol}`;
  return `${formatSmallNumber(value)} ${symbol}`;
}

/** Harga per token dalam aset native, siap tayang. */
export function formatPriceNative(value: number, symbol: string): string {
  if (!Number.isFinite(value) || value <= 0) return `— ${symbol}`;
  return `${formatSmallNumber(value)} ${symbol}`;
}

export function formatTokenAmount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

/** Market cap in USD from whole-token supply and native price. */
export function marketCapUsd(
  supplyWholeTokens: number | string | null | undefined,
  priceNative: number | null | undefined,
  nativeSymbol: string | null | undefined,
  prices: AssetPrices
): number {
  const supply = typeof supplyWholeTokens === "string"
    ? Number(supplyWholeTokens.replace(/[^0-9.]/g, ""))
    : Number(supplyWholeTokens ?? 0);
  if (!Number.isFinite(supply) || supply <= 0) return 0;
  return supply * tokenPriceUsd(priceNative, nativeSymbol, prices);
}

export function parseSupply(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
