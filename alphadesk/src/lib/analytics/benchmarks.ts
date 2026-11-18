/** Benchmark definitions + static reference sector weights (approximate, for attribution). */

export type BenchmarkId = 'SPY' | 'QQQ' | 'IWM';
export interface BenchmarkDef {
  id: BenchmarkId;
  label: string;
  /** ETF used as a price proxy for the index */
  proxy: string;
  /** Approximate GICS sector weights (fractions, sum ≈ 1). Static reference values, refreshed manually. */
  sectorWeights: Record<string, number>;
  /** which universe names to use as constituent proxies for sector returns */
  constituentFilter: (u: { exchange: string; marketCap: number; country: string }) => boolean;
  /** cap-weight ('cap') or equal-weight ('equal') proxy constituents */
  weighting: 'cap' | 'equal';
}

export const BENCHMARKS: Record<BenchmarkId, BenchmarkDef> = {
  SPY: {
    id: 'SPY', label: 'S&P 500', proxy: 'SPY', weighting: 'cap',
    sectorWeights: {
      'Information Technology': 0.32, Financials: 0.13, 'Health Care': 0.1, 'Consumer Discretionary': 0.1, 'Communication Services': 0.09,
      Industrials: 0.085, 'Consumer Staples': 0.055, Energy: 0.032, Utilities: 0.024, 'Real Estate': 0.021, Materials: 0.018,
    },
    constituentFilter: (u) => u.country === 'US',
  },
  QQQ: {
    id: 'QQQ', label: 'Nasdaq 100', proxy: 'QQQ', weighting: 'cap',
    sectorWeights: {
      'Information Technology': 0.5, 'Communication Services': 0.16, 'Consumer Discretionary': 0.14, 'Consumer Staples': 0.05, 'Health Care': 0.05,
      Industrials: 0.045, Utilities: 0.015, Materials: 0.013, Energy: 0.005, Financials: 0.005, 'Real Estate': 0.002,
    },
    constituentFilter: (u) => u.exchange.toUpperCase().includes('NASDAQ'),
  },
  IWM: {
    id: 'IWM', label: 'Russell 2000', proxy: 'IWM', weighting: 'equal',
    sectorWeights: {
      Financials: 0.18, Industrials: 0.17, 'Health Care': 0.16, 'Information Technology': 0.13, 'Consumer Discretionary': 0.1, 'Real Estate': 0.06,
      Energy: 0.055, Materials: 0.045, 'Consumer Staples': 0.03, Utilities: 0.03, 'Communication Services': 0.03,
    },
    constituentFilter: () => true,
  },
};

export function asBenchmark(b: string | null | undefined): BenchmarkId {
  const u = (b ?? '').toUpperCase();
  return u === 'QQQ' || u === 'IWM' ? u : 'SPY';
}

export type PeriodId = '1M' | '3M' | '6M' | 'YTD' | '1Y';
export const PERIODS: PeriodId[] = ['1M', '3M', '6M', 'YTD', '1Y'];
export function asPeriod(p: string | null | undefined): PeriodId {
  return (PERIODS as string[]).includes(p ?? '') ? (p as PeriodId) : '1Y';
}

/** First date (YYYY-MM-DD) included in a period ending at `end`. */
export function periodStart(end: string, period: PeriodId): string {
  const d = new Date(end + 'T00:00:00Z');
  const day = 86400000;
  switch (period) {
    case '1M': return new Date(d.getTime() - 31 * day).toISOString().slice(0, 10);
    case '3M': return new Date(d.getTime() - 92 * day).toISOString().slice(0, 10);
    case '6M': return new Date(d.getTime() - 183 * day).toISOString().slice(0, 10);
    case 'YTD': return `${d.getUTCFullYear() - (d.getUTCMonth() === 0 && d.getUTCDate() < 3 ? 1 : 0)}-01-01`;
    default: return new Date(d.getTime() - 365 * day).toISOString().slice(0, 10);
  }
}
