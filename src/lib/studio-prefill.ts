/**
 * Tautan prefill Studio: `/studio?mode=express&name=…&symbol=…&chain=…`.
 *
 * Dipakai dua arah: Studio membaca query saat dimuat, dan tombol "Copy launch link" menyusun
 * tautan yang sama. Ini juga fondasi bot tag sosial yang ditunda — bot cukup membalas dengan
 * tautan ini, dan peluncurannya tetap ditandatangani dompet creator sendiri.
 *
 * Aturan sanitasi SAMA dengan batas factory, bukan lebih longgar: nama 1..64 BYTE (factory
 * mengukur `bytes(name).length`, jadi huruf non-ASCII dihitung per byte UTF-8), ticker A-Z0-9
 * maksimal 12. Nilai yang lolos di sini tidak akan ditolak factory karena bentuknya.
 */

export type StudioMode = "express" | "advanced";

export type StudioPrefill = {
  mode: StudioMode | null;
  name: string | null;
  symbol: string | null;
  chainId: number | null;
};

const NAME_MAX_BYTES = 64;
const SYMBOL_MAX = 12;

/** Ticker seperti input Studio: huruf besar, hanya A-Z dan 0-9, paling banyak 12. */
export function sanitizeSymbol(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, SYMBOL_MAX);
}

/**
 * Nama: karakter kontrol dibuang, spasi dirapatkan, lalu dipotong ke 64 byte UTF-8 tanpa
 * membelah satu karakter (dipotong per code point, bukan per byte).
 */
export function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const enc = new TextEncoder();
  let out = "";
  let bytes = 0;
  for (const ch of cleaned) {
    const n = enc.encode(ch).length;
    if (bytes + n > NAME_MAX_BYTES) break;
    out += ch;
    bytes += n;
  }
  return out.trim();
}

/**
 * `chain` boleh chain id (`8453`) atau kunci chain tanpa peduli huruf (`base`, `0g`). Yang
 * tidak cocok dengan chain yang BISA meluncurkan diabaikan, bukan dipaksakan.
 */
export function parseStudioPrefill(search: string, liveChains: Array<{ chainId: number; key: string }>): StudioPrefill {
  const q = new URLSearchParams(search);
  const modeRaw = (q.get("mode") ?? "").toLowerCase();
  const mode: StudioMode | null = modeRaw === "express" || modeRaw === "advanced" ? modeRaw : null;

  const nameRaw = q.get("name");
  const name = nameRaw === null ? null : sanitizeName(nameRaw) || null;
  const symbolRaw = q.get("symbol") ?? q.get("ticker");
  const symbol = symbolRaw === null ? null : sanitizeSymbol(symbolRaw) || null;

  const chainRaw = (q.get("chain") ?? "").trim().toLowerCase();
  let chainId: number | null = null;
  if (chainRaw) {
    const hit = liveChains.find((c) => String(c.chainId) === chainRaw || c.key.toLowerCase() === chainRaw);
    chainId = hit ? hit.chainId : null;
  }
  return { mode, name, symbol, chainId };
}

/** Tautan yang membuka Studio dalam mode Express dengan isian ini. Kosong tidak ikut. */
export function buildStudioPrefillUrl(
  origin: string,
  p: { name?: string | null; symbol?: string | null; chainId?: number | null }
): string {
  const q = new URLSearchParams({ mode: "express" });
  const name = p.name ? sanitizeName(p.name) : "";
  const symbol = p.symbol ? sanitizeSymbol(p.symbol) : "";
  if (name) q.set("name", name);
  if (symbol) q.set("symbol", symbol);
  if (p.chainId) q.set("chain", String(p.chainId));
  return `${origin.replace(/\/+$/, "")}/studio?${q.toString()}`;
}
