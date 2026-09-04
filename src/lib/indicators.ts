/**
 * Technical indicators computed from our own candles.
 *
 * WHY THESE ARE COMPUTED HERE AND NOT EMBEDDED
 *
 * The obvious route is to drop in a TradingView or GeckoTerminal widget. Neither
 * can work for a token launched on our curve: both resolve a symbol or pool from
 * their own database, and a market that started minutes ago on a factory they have
 * never indexed does not exist there. Embedding one would render an empty frame.
 * `lightweight-charts`, which this project already uses, is TradingView's own
 * renderer but ships no indicators, so the maths lives here.
 *
 * THE RULE EVERY FUNCTION FOLLOWS
 *
 * A window of N periods needs N periods of data. Until then the value is `null`,
 * never a partial average dressed up as a real one. That matters more here than on
 * a mature exchange: a token can be ten minutes old, and an RSI computed from three
 * candles would look authoritative while meaning nothing. Callers render `null` as
 * a gap and tell the user how many candles are still missing.
 *
 * A CONSEQUENCE WORTH KNOWING BEFORE IT LOOKS LIKE A BUG
 *
 * On a bonding curve that has only ever been bought, every period is a gain and
 * there are no losses at all. Wilder's RSI then divides by a zero average loss and
 * pins at exactly 100. That is not a broken indicator — a market that has never
 * ticked down genuinely is maximally overbought. The UI says so rather than hiding
 * it.
 */

export interface Ohlc {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A value per input index. `null` means "not enough data yet", never a guess. */
export type Series = Array<number | null>;

/** Simple moving average. */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average, seeded with the SMA of the first `period` values.
 *
 * Seeding matters: starting the recursion from values[0] lets the first data point
 * dominate the early curve, which on a young market is most of the chart.
 */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder's RSI — the standard definition, using Wilder smoothing rather than a
 * plain mean of the last N changes.
 *
 * Returns 100 when there has been no downward move in the window, which is the
 * correct reading for a market that has only risen, and 0 for the mirror case.
 */
export function rsi(closes: number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gainSum += delta;
    else lossSum -= delta;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    // No downward movement at all: RSI is 100 by definition, not by accident. A
    // flat market with neither gains nor losses is 50.
    out[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/**
 * MACD. The signal line is an EMA of the MACD line, so it is only defined once the
 * MACD line itself has `signalPeriod` real values — the warm-up compounds, and it
 * is not shortened here to make the chart fill up sooner.
 */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: Series = closes.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f === null || s === null ? null : f - s;
  });

  // Compact the defined stretch, run the EMA on that, then place it back so index
  // alignment with the candles is preserved.
  const firstDefined = macdLine.findIndex((v) => v !== null);
  const signal: Series = new Array(closes.length).fill(null);
  const histogram: Series = new Array(closes.length).fill(null);
  if (firstDefined >= 0) {
    const dense = macdLine.slice(firstDefined) as number[];
    const denseSignal = ema(dense, signalPeriod);
    for (let i = 0; i < denseSignal.length; i++) {
      const s = denseSignal[i];
      if (s === null) continue;
      const idx = firstDefined + i;
      signal[idx] = s;
      const m = macdLine[idx];
      if (m !== null) histogram[idx] = m - s;
    }
  }
  return { macd: macdLine, signal, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

/** Bollinger Bands: SMA middle with population standard deviation bands. */
export function bollinger(closes: number[], period = 20, multiplier = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const mid = middle[i];
    if (mid === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - mid) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = mid + multiplier * sd;
    lower[i] = mid - multiplier * sd;
  }
  return { upper, middle, lower };
}

/**
 * Volume-weighted average price, cumulative over the loaded range.
 *
 * Undefined while cumulative volume is zero — an empty bucket contributes nothing
 * and must not be allowed to define a price. Note this is a running VWAP over the
 * window we hold, not an exchange-style session VWAP that resets daily; a curve
 * has no trading session to reset on.
 */
export function vwap(candles: Ohlc[]): Series {
  const out: Series = new Array(candles.length).fill(null);
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * (c.volume || 0);
    vol += c.volume || 0;
    if (vol > 0) out[i] = pv / vol;
  }
  return out;
}

/** How many candles an indicator needs before it produces its first value. */
export const WARMUP: Record<string, number> = {
  ema9: 9,
  ema21: 21,
  sma50: 50,
  bollinger: 20,
  rsi14: 15, // period + 1: RSI needs one prior close to measure the first change
  macd: 34, // slow EMA (26) then 9 more for the signal line
  vwap: 1,
};

export interface IndicatorSet {
  ema9: Series;
  ema21: Series;
  sma50: Series;
  bollinger: BollingerResult;
  rsi14: Series;
  macd: MacdResult;
  vwap: Series;
}

/** Compute everything once; the UI decides what to show. */
export function computeIndicators(candles: Ohlc[]): IndicatorSet {
  const closes = candles.map((c) => c.close);
  return {
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    sma50: sma(closes, 50),
    bollinger: bollinger(closes, 20, 2),
    rsi14: rsi(closes, 14),
    macd: macd(closes, 12, 26, 9),
    vwap: vwap(candles),
  };
}

/**
 * Pair a series with its candle times and drop the warm-up gaps, producing the
 * shape lightweight-charts wants. Dropping rather than zero-filling is deliberate:
 * a zero would be drawn as a real datapoint at the bottom of the scale.
 */
export function toLineData(candles: Ohlc[], series: Series): Array<{ time: number; value: number }> {
  const out: Array<{ time: number; value: number }> = [];
  for (let i = 0; i < candles.length && i < series.length; i++) {
    const v = series[i];
    if (v === null || !Number.isFinite(v)) continue;
    out.push({ time: candles[i].time, value: v });
  }
  return out;
}
