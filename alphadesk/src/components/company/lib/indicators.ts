/**
 * Pure technical-indicator math for the price chart.
 * Every function returns an array aligned 1:1 with its input; positions where the
 * indicator is not yet defined (warm-up) are `null`. Inputs may contain leading nulls
 * (e.g. when chaining EMA over a MACD line).
 */
export type Series = ReadonlyArray<number | null | undefined>;
export type Out = (number | null)[];

const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Simple moving average over a trailing window of `n` defined values. */
export function sma(values: Series, n: number): Out {
  const out: Out = new Array(values.length).fill(null);
  if (n < 1) return out;
  let sum = 0;
  let count = 0; // consecutive defined values in window
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) { sum = 0; count = 0; continue; }
    sum += v;
    count++;
    if (count > n) { sum -= values[i - n] as number; count = n; }
    if (count === n) out[i] = sum / n;
  }
  return out;
}

/** Exponential moving average (k = 2/(n+1)), seeded with the SMA of the first `n` defined values. */
export function ema(values: Series, n: number): Out {
  const out: Out = new Array(values.length).fill(null);
  if (n < 1) return out;
  const k = 2 / (n + 1);
  let prev: number | null = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) continue;
    if (prev == null) {
      seedSum += v;
      seedCount++;
      if (seedCount === n) { prev = seedSum / n; out[i] = prev; }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Relative Strength Index with Wilder smoothing. First value at index `n` (needs n price changes). */
export function rsi(values: Series, n = 14): Out {
  const out: Out = new Array(values.length).fill(null);
  if (n < 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  let changes = 0;
  let prevVal: number | null = null;
  const toRsi = () => (avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) continue;
    if (prevVal == null) { prevVal = v; continue; }
    const ch = v - prevVal;
    prevVal = v;
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    changes++;
    if (changes <= n) {
      avgGain += g / n;
      avgLoss += l / n;
      if (changes === n) out[i] = toRsi();
    } else {
      avgGain = (avgGain * (n - 1) + g) / n;
      avgLoss = (avgLoss * (n - 1) + l) / n;
      out[i] = toRsi();
    }
  }
  return out;
}

export interface MacdResult { macd: Out; signal: Out; hist: Out }

/** MACD = EMA(fast) − EMA(slow); signal = EMA(signalN) of MACD; hist = MACD − signal. */
export function macd(values: Series, fast = 12, slow = 26, signalN = 9): MacdResult {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line: Out = f.map((v, i) => (v != null && s[i] != null ? v - (s[i] as number) : null));
  const signal = ema(line, signalN);
  const hist: Out = line.map((v, i) => (v != null && signal[i] != null ? v - (signal[i] as number) : null));
  return { macd: line, signal, hist };
}

export interface Cross { index: number; dir: 'up' | 'down' }

/**
 * Indices where series `a` crosses series `b`. 'up' = a moves from below to above b,
 * 'down' = from above to below. Touching (a == b) without changing side is not a cross.
 */
export function crossovers(a: Series, b: Series): Cross[] {
  const out: Cross[] = [];
  let lastSign = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (!isNum(x) || !isNum(y)) continue;
    const sign = Math.sign(x - y);
    if (sign === 0) continue;
    if (lastSign !== 0 && sign !== lastSign) out.push({ index: i, dir: sign > 0 ? 'up' : 'down' });
    lastSign = sign;
  }
  return out;
}
