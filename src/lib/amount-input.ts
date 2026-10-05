/**
 * Angka yang diketik di kolom jumlah swap, dinormalkan ke bentuk yang bisa diparse: "1234.5".
 * Dipakai kedua kolom (bayar dan terima), dan keduanya menampilkan angka TANPA pemisah ribuan.
 *
 * KOMA
 *
 * Keyboard Android berbahasa Indonesia menampilkan "," di tombol desimal, jadi orang mengetik
 * "0,001" untuk 0.001. Kolom bayar dulu `type="number"`: tergantung peramban dan locale, koma itu
 * dibuang ("00001" = 1, seribu kali lipat) atau nilainya kosong.
 *
 * Aturannya, berurutan:
 *
 * 1. Titik DAN koma (angka yang ditempel): yang muncul terakhir adalah desimal, yang lain pemisah
 *    ribuan, asal pola ribuannya sah ("1.234,5" dan "1,234.5" sama-sama 1234.5). Pola yang tidak sah
 *    ("0.5,") berarti pemisah pertama adalah desimal dan sisanya dibuang, jadi koma yang kelepasan
 *    sesudah "0.5" tidak mengubahnya jadi 5.
 * 2. Satu jenis pemisah, BERULANG dengan kelompok tiga digit ("1,000,000", "1.000.000"): ribuan.
 * 3. Selain itu pemisah pertama adalah desimal dan sisanya dibuang. "1,500" jadi 1.5, bukan 1500:
 *    keraguan diselesaikan ke angka yang LEBIH KECIL, jadi salah baca tidak pernah membelanjakan
 *    lebih dari yang dimaksud.
 *
 * DESIMAL
 *
 * Digit di belakang titik dipotong ke `decimals`. Kalau tidak, `parseUnits` menolak angkanya dan
 * kutipan hilang tanpa penjelasan.
 */
export function normalizeAmountInput(raw: string, decimals = 18): string {
  const s = String(raw ?? "").replace(/[^\d.,]/g, "");
  const dots = s.split(".").length - 1;
  const commas = s.split(",").length - 1;
  let out: string;
  if (dots > 0 && commas > 0) {
    const last = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const other = last === "." ? "," : ".";
    const grouped = new RegExp(`^[1-9]\\d{0,2}(\\${other}\\d{3})+\\${last}\\d*$`).test(s);
    out = grouped ? s.split(other).join("").replace(last, ".") : firstSeparatorIsDecimal(s);
  } else if (dots + commas > 1) {
    const sep = dots > 0 ? "." : ",";
    const grouped = new RegExp(`^[1-9]\\d{0,2}(\\${sep}\\d{3})+$`).test(s);
    out = grouped ? s.split(sep).join("") : firstSeparatorIsDecimal(s);
  } else {
    out = firstSeparatorIsDecimal(s);
  }
  const dot = out.indexOf(".");
  if (dot < 0) return out;
  const intPart = out.slice(0, dot);
  const frac = out.slice(dot + 1).slice(0, Math.max(0, decimals));
  return `${intPart === "" ? "0" : intPart}.${frac}`;
}

/** Pemisah pertama (titik atau koma) jadi titik desimal; pemisah sesudahnya dibuang. */
function firstSeparatorIsDecimal(s: string): string {
  const i = s.search(/[.,]/);
  if (i < 0) return s;
  return `${s.slice(0, i)}.${s.slice(i + 1).replace(/[.,]/g, "")}`;
}

/**
 * Jumlah token untuk DIISIKAN ke kolom: digit sama dengan `formatTokenAmount`, tanpa pemisah
 * ribuan. Kolom terima dulu menampilkan estimasi "2,850"; menghapus satu digitnya memberi
 * "2,85", yang terbaca 2.85 — seribu kali lebih kecil. Angka di dalam kolom yang bisa disunting
 * tidak dikelompokkan, sama seperti kolom bayar.
 */
export function plainTokenAmount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return value.toLocaleString("en-US", { maximumFractionDigits, useGrouping: false });
}
