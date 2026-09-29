/**
 * Posisi satu dompet di satu pasar, dihitung dari perdagangannya sendiri di chain.
 *
 * Murni — tanpa jaringan, tanpa disk — supaya bisa diuji terhadap hitungan tangan.
 *
 * METODE: BIAYA RATA-RATA
 *
 * Setiap pembelian menambah token dan modal; setiap penjualan melepas token pada harga masuk
 * rata-rata saat itu, dan selisihnya dengan hasil jual menjadi PnL terealisasi. Ini metode yang
 * dipakai sebagian besar terminal, dan satu-satunya yang tidak bergantung pada urutan lot yang
 * tidak bisa dilihat dari chain.
 *
 * YANG TIDAK DIKETAHUI, DAN DIKATAKAN
 *
 * Token bisa masuk tanpa dibeli — dikirim dari dompet lain. Token seperti itu TIDAK punya harga
 * masuk, dan menebaknya (harga saat diterima? nol?) akan menghasilkan PnL karangan. Jadi saldo
 * dipecah dua: bagian yang asal-usulnya perdagangan (`trackedTokens`, punya modal) dan sisanya
 * (`untrackedTokens`). PnL hanya dihitung untuk bagian pertama, dan UI wajib menyebut bagian
 * kedua.
 *
 * Kalau saldo sekarang LEBIH KECIL dari token hasil perdagangan, sebagian sudah dikirim keluar.
 * Token itu pergi membawa modalnya secara proporsional; pengiriman bukan penjualan, jadi tidak
 * ada PnL terealisasi yang lahir darinya.
 */

export interface PositionSwap {
  isBuy: boolean;
  /** `msg.sender`, huruf kecil. */
  trader: string;
  /** Penerima token (beli) atau penerima native (jual), huruf kecil. */
  recipient: string;
  amountToken: number;
  /** Beli: native yang dibayar, bruto termasuk fee. Jual: native yang diterima, neto. */
  amountNative: number;
  /** Detik. */
  time: number;
  blockNumber: number;
  logIndex?: number;
}

export interface PositionResult {
  wallet: string;
  buys: number;
  sells: number;
  boughtTokens: number;
  soldTokens: number;
  spentNative: number;
  receivedNative: number;
  balanceTokens: number;
  trackedTokens: number;
  untrackedTokens: number;
  costNative: number;
  costUsd: number | null;
  avgEntryNative: number | null;
  avgEntryUsd: number | null;
  valueNative: number;
  valueUsd: number | null;
  unrealizedNative: number | null;
  unrealizedUsd: number | null;
  /** Persen dalam native: harga token terhadap harga masuk, tanpa gerak kurs. */
  unrealizedPct: number | null;
  /** Persen dalam dolar: termasuk gerak kurs aset native sejak dibeli. */
  unrealizedPctUsd: number | null;
  realizedNative: number;
  realizedUsd: number | null;
  /** Token terjual yang tidak punya harga masuk; hasilnya tidak masuk PnL terealisasi. */
  soldWithoutEntryTokens: number;
  firstTradeAt: number | null;
  lastTradeAt: number | null;
}

/** Perdagangan yang menjadi milik dompet ini: token diterima (beli) atau token dilepas (jual). */
export function walletSwaps<T extends PositionSwap>(swaps: T[], wallet: string): T[] {
  const w = wallet.toLowerCase();
  return swaps.filter((s) => (s.isBuy ? s.recipient === w : s.trader === w));
}

export function computePosition(input: {
  wallet: string;
  swaps: PositionSwap[];
  balanceTokens: number;
  spotNative: number;
  fxNow: number | null;
  fxAt: (seconds: number) => number | null;
}): PositionResult {
  const mine = walletSwaps(input.swaps, input.wallet).sort(
    (a, b) => a.blockNumber - b.blockNumber || (a.logIndex ?? 0) - (b.logIndex ?? 0)
  );

  let tracked = 0;
  let cost = 0;
  let costUsd = 0;
  let usdKnown = true;
  let realized = 0;
  let realizedUsd = 0;
  let soldWithoutEntry = 0;
  let bought = 0;
  let sold = 0;
  let spent = 0;
  let received = 0;
  let buys = 0;
  let sells = 0;

  for (const s of mine) {
    const fx = input.fxAt(s.time);
    if (fx === null) usdKnown = false;
    if (s.isBuy) {
      buys++;
      bought += s.amountToken;
      spent += s.amountNative;
      tracked += s.amountToken;
      cost += s.amountNative;
      if (fx !== null) costUsd += s.amountNative * fx;
      continue;
    }
    sells++;
    sold += s.amountToken;
    received += s.amountNative;
    const fromTracked = Math.min(s.amountToken, tracked);
    const avg = tracked > 0 ? cost / tracked : 0;
    const avgUsd = tracked > 0 ? costUsd / tracked : 0;
    const share = s.amountToken > 0 ? fromTracked / s.amountToken : 0;
    realized += s.amountNative * share - avg * fromTracked;
    if (fx !== null) realizedUsd += s.amountNative * fx * share - avgUsd * fromTracked;
    cost -= avg * fromTracked;
    costUsd -= avgUsd * fromTracked;
    tracked -= fromTracked;
    soldWithoutEntry += s.amountToken - fromTracked;
  }

  const balance = Math.max(0, input.balanceTokens);
  if (balance < tracked) {
    // Sebagian dikirim keluar: modalnya ikut pergi secara proporsional.
    const keep = tracked > 0 ? balance / tracked : 0;
    cost *= keep;
    costUsd *= keep;
    tracked = balance;
  }
  // Pembulatan float tidak boleh menyisakan "0.000000001 token tanpa harga masuk".
  const epsilon = Math.max(1e-9, balance * 1e-12);
  const untracked = balance - tracked > epsilon ? balance - tracked : 0;

  const spot = input.spotNative > 0 ? input.spotNative : 0;
  const fxNow = input.fxNow;
  const valueNative = balance * spot;
  const trackedValue = tracked * spot;
  const haveTracked = tracked > epsilon;

  return {
    wallet: input.wallet.toLowerCase(),
    buys,
    sells,
    boughtTokens: bought,
    soldTokens: sold,
    spentNative: spent,
    receivedNative: received,
    balanceTokens: balance,
    trackedTokens: haveTracked ? tracked : 0,
    untrackedTokens: untracked,
    costNative: haveTracked ? cost : 0,
    costUsd: usdKnown ? (haveTracked ? costUsd : 0) : null,
    avgEntryNative: haveTracked ? cost / tracked : null,
    avgEntryUsd: haveTracked && usdKnown ? costUsd / tracked : null,
    valueNative,
    valueUsd: fxNow !== null ? valueNative * fxNow : null,
    unrealizedNative: haveTracked && spot > 0 ? trackedValue - cost : null,
    unrealizedUsd: haveTracked && spot > 0 && fxNow !== null && usdKnown ? trackedValue * fxNow - costUsd : null,
    unrealizedPct: haveTracked && spot > 0 && cost > 0 ? ((trackedValue - cost) / cost) * 100 : null,
    unrealizedPctUsd:
      haveTracked && spot > 0 && fxNow !== null && usdKnown && costUsd > 0
        ? ((trackedValue * fxNow - costUsd) / costUsd) * 100
        : null,
    realizedNative: realized,
    realizedUsd: usdKnown ? realizedUsd : null,
    soldWithoutEntryTokens: soldWithoutEntry,
    firstTradeAt: mine.length > 0 ? mine[0].time : null,
    lastTradeAt: mine.length > 0 ? mine[mine.length - 1].time : null,
  };
}
