/** Pure statistics helpers used by the analytics modules. Arrays are plain number[]; no external deps. */

export const TRADING_DAYS = 252;

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: number[]): number {
  return xs.length ? sum(xs) / xs.length : 0;
}

/** Sample variance (n − 1). */
export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - 1);
}

export function stdev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

/** Sample covariance of two equal-length series. */
export function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

export function correlation(a: number[], b: number[]): number {
  const d = stdev(a) * stdev(b);
  return d > 0 ? covariance(a, b) / d : 0;
}

/** Simple returns from a price series: r_t = p_t / p_{t-1} − 1. */
export function toReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const p0 = prices[i - 1];
    out.push(p0 > 0 ? prices[i] / p0 - 1 : 0);
  }
  return out;
}

/** Sample covariance matrix; `series[i]` is asset i's return series (equal lengths). */
export function covarianceMatrix(series: number[][]): number[][] {
  const n = series.length;
  const means = series.map(mean);
  const T = n ? Math.min(...series.map((s) => s.length)) : 0;
  const m: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  if (T < 2) return m;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      const si = series[i];
      const sj = series[j];
      for (let t = 0; t < T; t++) s += (si[t] - means[i]) * (sj[t] - means[j]);
      m[i][j] = m[j][i] = s / (T - 1);
    }
  }
  return m;
}

/**
 * Cholesky decomposition (lower-triangular L with L·Lᵀ = A). If A is not positive definite (e.g. more assets than
 * observations, or duplicated series) a small ridge is added to the diagonal and retried. Returns the ridge used.
 */
export function cholesky(a: number[][]): { L: number[][]; ridge: number } {
  const n = a.length;
  const trace = a.reduce((s, row, i) => s + row[i], 0);
  const base = n ? Math.max(trace / n, 1e-12) : 1e-12;
  for (const ridgeFactor of [0, 1e-10, 1e-8, 1e-6, 1e-4, 1e-3, 1e-2, 1e-1]) {
    const ridge = ridgeFactor * base;
    const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let s = a[i][j] + (i === j ? ridge : 0);
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) {
          if (!(s > 0) || !isFinite(s)) { ok = false; break; }
          L[i][i] = Math.sqrt(s);
        } else {
          L[i][j] = s / L[j][j];
        }
      }
    }
    if (ok) return { L, ridge };
  }
  // Degenerate: fall back to diagonal (independent assets).
  return { L: a.map((row, i) => row.map((_, j) => (i === j ? Math.sqrt(Math.max(a[i][i], 0)) : 0))), ridge: NaN };
}

/** Linear-interpolated quantile of an ascending-sorted array, p ∈ [0, 1]. */
export function quantileSorted(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface HistogramBin { x0: number; x1: number; mid: number; count: number }

export function histogram(values: number[], bins = 40): HistogramBin[] {
  if (!values.length) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  if (min === max) return [{ x0: min, x1: max, mid: min, count: values.length }];
  const w = (max - min) / bins;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({ x0: min + i * w, x1: min + (i + 1) * w, mid: min + (i + 0.5) * w, count: 0 }));
  for (const v of values) out[Math.min(bins - 1, Math.floor((v - min) / w))].count++;
  return out;
}

export interface PricePoint { date: string; close: number }

/**
 * Align several close-price series on common dates (inner join). If the overlap is too short (mixed providers with
 * different calendars), falls back to aligning the most recent observations by position ("tail" alignment).
 */
export function alignSeries(series: Record<string, PricePoint[]>, minOverlap = 40): { dates: string[]; closes: Record<string, number[]>; method: 'date' | 'tail' } {
  const keys = Object.keys(series).filter((k) => series[k]?.length);
  if (!keys.length) return { dates: [], closes: {}, method: 'date' };
  const maps = keys.map((k) => new Map(series[k].map((p) => [p.date, p.close])));
  let common = series[keys[0]].map((p) => p.date).filter((d) => maps.every((m) => m.has(d)));
  common = Array.from(new Set(common)).sort();
  if (common.length >= Math.min(minOverlap, Math.min(...keys.map((k) => series[k].length)))) {
    return { dates: common, closes: Object.fromEntries(keys.map((k, i) => [k, common.map((d) => maps[i].get(d)!)])), method: 'date' };
  }
  const n = Math.min(...keys.map((k) => series[k].length));
  const ref = series[keys[0]].slice(-n).map((p) => p.date);
  return { dates: ref, closes: Object.fromEntries(keys.map((k) => [k, series[k].slice(-n).map((p) => p.close)])), method: 'tail' };
}
