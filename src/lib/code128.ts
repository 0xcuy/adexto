/**
 * Code 128 (set B) untuk barcode di kartu identitas agen.
 *
 * Ditulis sendiri, bukan paket baru: polanya tabel standar 107 simbol dan checksum modulo 103,
 * dan dependency baru di repo ini butuh persetujuan owner. Benar tidaknya diuji dengan decoder
 * independen (ZXing) atas tangkapan layar kartu, bukan dengan kode ini sendiri (PLAN-AGENTS-ID).
 *
 * Tiap pola adalah lebar batang/spasi bergantian dalam modul, mulai dengan batang, dan jumlahnya
 * selalu 11 (stop: 13). Pemeriksaan di bawah menolak tabel yang rusak saat modul dimuat.
 */
const PATTERNS = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
  "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 " +
  "232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 " +
  "313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 " +
  "111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 " +
  "114311 411113 411311 113141 114131 311141 411131 211412 211214 211232"
).split(" ");
const STOP = "2331112";
const START_B = 104;

if (
  PATTERNS.length !== 106 ||
  new Set(PATTERNS).size !== 106 ||
  PATTERNS.some((p) => [...p].reduce((a, b) => a + Number(b), 0) !== 11)
) {
  throw new Error("code128: pattern table is corrupt");
}

export interface Code128 {
  /** Batang hitam sebagai [x, lebar] dalam modul, berurutan. */
  bars: Array<[number, number]>;
  /** Lebar total dalam modul, tanpa quiet zone. */
  modules: number;
}

/** Hanya ASCII 32–126 (set B). Teks di luar itu ditolak, bukan diganti diam-diam. */
export function code128B(text: string): Code128 {
  const values = [...text].map((ch) => {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`code128: character not in set B: ${JSON.stringify(ch)}`);
    return v;
  });
  const checksum = values.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  const widths = [PATTERNS[START_B], ...values.map((v) => PATTERNS[v]), PATTERNS[checksum], STOP].join("");
  const bars: Array<[number, number]> = [];
  let x = 0;
  for (let i = 0; i < widths.length; i++) {
    const w = Number(widths[i]);
    if (i % 2 === 0) bars.push([x, w]);
    x += w;
  }
  return { bars, modules: x };
}
