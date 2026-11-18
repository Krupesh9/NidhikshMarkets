/** Beta, volatility and Monte Carlo VaR/CVaR. Pure and deterministic given a seed. */
import { cholesky, covariance, histogram, mean, quantileSorted, stdev, TRADING_DAYS, variance, type HistogramBin } from './stats';
import { mulberry32, normalGenerator, seedFromString } from './prng';

export interface BetaResult { beta: number; alpha: number; correlation: number; r2: number; observations: number }

/** OLS beta of asset returns on benchmark returns (equal-length, aligned). */
export function computeBeta(asset: number[], bench: number[]): BetaResult {
  const n = Math.min(asset.length, bench.length);
  const a = asset.slice(-n);
  const b = bench.slice(-n);
  const vb = variance(b);
  if (n < 3 || vb <= 0) return { beta: NaN, alpha: 0, correlation: 0, r2: 0, observations: n };
  const beta = covariance(a, b) / vb;
  const sa = stdev(a);
  const corr = sa > 0 ? covariance(a, b) / (sa * Math.sqrt(vb)) : 0;
  return { beta, alpha: mean(a) - beta * mean(b), correlation: corr, r2: corr * corr, observations: n };
}

/** Annualized volatility from daily returns (√252 scaling). */
export function annualizedVol(dailyReturns: number[], periodsPerYear = TRADING_DAYS): number {
  return stdev(dailyReturns) * Math.sqrt(periodsPerYear);
}

/** Weighted portfolio return series: r_p,t = Σ w_i r_i,t. `series[i]` aligned, `weights[i]` signed. */
export function portfolioReturnSeries(series: number[][], weights: number[]): number[] {
  const T = series.length ? Math.min(...series.map((s) => s.length)) : 0;
  const out = new Array<number>(T).fill(0);
  for (let i = 0; i < series.length; i++) for (let t = 0; t < T; t++) out[t] += weights[i] * series[i][t];
  return out;
}

/** Portfolio $ volatility per day from exposures ($) and a daily covariance matrix: √(eᵀΣe). */
export function dollarVol(exposures: number[], cov: number[][]): number {
  let s = 0;
  for (let i = 0; i < exposures.length; i++) for (let j = 0; j < exposures.length; j++) s += exposures[i] * cov[i][j] * exposures[j];
  return Math.sqrt(Math.max(0, s));
}

export interface VarLevel { confidence: number; var: number; cvar: number }
export interface HorizonRisk {
  days: number;
  /** losses reported as positive $ amounts */
  levels: VarLevel[];
  meanPnl: number;
  stdevPnl: number;
  /** analytic normal VaR for comparison (z·σ·√h) */
  parametric: VarLevel[];
  worst: number;
  best: number;
}
export interface MonteCarloOptions {
  /** $ market value per asset (signed) */
  exposures: number[];
  /** daily covariance matrix of simple returns */
  cov: number[][];
  /** optional daily mean returns (default 0 — conservative, standard for short horizons) */
  means?: number[];
  paths?: number;
  seed?: number | string;
  horizons?: number[];
  confidences?: number[];
  /** 'normal' or fat-tailed multivariate Student-t (default t, ν=5, variance-matched) */
  distribution?: 'normal' | 'student-t';
  df?: number;
  histogramBins?: number;
  labels?: string[];
}
export interface MonteCarloResult {
  paths: number;
  seed: number;
  distribution: 'normal' | 'student-t';
  df: number | null;
  ridge: number;
  horizons: HorizonRisk[];
  /** 1-day P&L histogram */
  histogram: HistogramBin[];
  /** per-asset contribution to 1-day CVaR at the highest confidence (sums to that CVaR) */
  contributions: { label: string; cvarContribution: number; share: number }[];
}

const Z: Record<string, number> = { '0.9': 1.2815515655, '0.95': 1.6448536270, '0.975': 1.9599639845, '0.99': 2.3263478740 };
function zFor(c: number): number {
  return Z[String(c)] ?? Math.sqrt(2) * inverseErf(2 * c - 1);
}
function inverseErf(x: number): number {
  const a = 0.147;
  const ln = Math.log(1 - x * x);
  const t = 2 / (Math.PI * a) + ln / 2;
  return Math.sign(x) * Math.sqrt(Math.sqrt(t * t - ln / a) - t);
}

/**
 * Monte Carlo VaR/CVaR. Correlated shocks via Cholesky of the covariance (r = μ + L·z), optionally Student-t scaled
 * for fat tails. Multi-day horizons use √h scaling of independent draws (Basel square-root-of-time). Deterministic
 * for a given seed.
 */
export function monteCarloVaR(o: MonteCarloOptions): MonteCarloResult {
  const n = o.exposures.length;
  const paths = Math.max(100, Math.floor(o.paths ?? 5000));
  const horizons = o.horizons ?? [1, 10];
  const confs = (o.confidences ?? [0.95, 0.99]).slice().sort((a, b) => a - b);
  const dist = o.distribution ?? 'student-t';
  const df = Math.max(3, Math.floor(o.df ?? 5));
  const seed = typeof o.seed === 'string' ? seedFromString(o.seed) : (o.seed ?? 42) >>> 0;
  const { L, ridge } = cholesky(o.cov);
  const means = o.means ?? new Array<number>(n).fill(0);
  const tScale = Math.sqrt((df - 2) / df); // variance-match the t to the covariance

  const results: HorizonRisk[] = [];
  let hist: HistogramBin[] = [];
  let contributions: MonteCarloResult['contributions'] = [];

  horizons.forEach((h, hi) => {
    const uni = mulberry32(seed + hi * 7919);
    const norm = normalGenerator(uni);
    const pnl = new Float64Array(paths);
    const assetPnl: Float64Array[] | null = hi === 0 ? Array.from({ length: n }, () => new Float64Array(paths)) : null;
    const z = new Float64Array(n);
    const sq = Math.sqrt(h);
    for (let p = 0; p < paths; p++) {
      for (let i = 0; i < n; i++) z[i] = norm();
      let mix = 1;
      if (dist === 'student-t') {
        let chi = 0;
        for (let k = 0; k < df; k++) { const g = norm(); chi += g * g; }
        mix = tScale / Math.sqrt(chi / df);
      }
      let total = 0;
      for (let i = 0; i < n; i++) {
        let r = 0;
        const Li = L[i];
        for (let k = 0; k <= i; k++) r += Li[k] * z[k];
        const ret = means[i] * h + r * mix * sq;
        const v = o.exposures[i] * ret;
        total += v;
        if (assetPnl) assetPnl[i][p] = v;
      }
      pnl[p] = total;
    }
    const sorted = Array.from(pnl).sort((a, b) => a - b);
    const levels: VarLevel[] = confs.map((c) => {
      const q = quantileSorted(sorted, 1 - c);
      const k = Math.max(1, Math.floor(paths * (1 - c)));
      let s = 0;
      for (let i = 0; i < k; i++) s += sorted[i];
      const tailMean = s / k;
      const v = Math.max(0, -q);
      return { confidence: c, var: v, cvar: Math.max(v, -tailMean) };
    });
    const m = mean(sorted);
    const sd = Math.sqrt(sorted.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, paths - 1));
    let sigma1 = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sigma1 += o.exposures[i] * o.cov[i][j] * o.exposures[j];
    const sigmaH = Math.sqrt(Math.max(0, sigma1) * h);
    const muH = o.exposures.reduce((a, e, i) => a + e * means[i] * h, 0);
    results.push({
      days: h, levels, meanPnl: m, stdevPnl: sd, worst: sorted[0] ?? 0, best: sorted[sorted.length - 1] ?? 0,
      parametric: confs.map((c) => ({ confidence: c, var: Math.max(0, zFor(c) * sigmaH - muH), cvar: Math.max(0, sigmaH * Math.exp(-(zFor(c) ** 2) / 2) / (Math.sqrt(2 * Math.PI) * (1 - c)) - muH) })),
    });
    if (hi === 0) {
      hist = histogram(sorted, o.histogramBins ?? 40);
      if (assetPnl) {
        const c = confs[confs.length - 1];
        const k = Math.max(1, Math.floor(paths * (1 - c)));
        const idx = Array.from(pnl.keys()).sort((a, b) => pnl[a] - pnl[b]).slice(0, k);
        const contrib = assetPnl.map((arr) => -idx.reduce((s, ix) => s + arr[ix], 0) / k);
        const tot = contrib.reduce((a, b) => a + b, 0);
        contributions = contrib.map((v, i) => ({ label: o.labels?.[i] ?? String(i), cvarContribution: v, share: tot ? v / tot : 0 }))
          .sort((a, b) => b.cvarContribution - a.cvarContribution);
      }
    }
  });
  return { paths, seed, distribution: dist, df: dist === 'student-t' ? df : null, ridge, horizons: results, histogram: hist, contributions };
}
