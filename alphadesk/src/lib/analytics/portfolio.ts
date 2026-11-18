/**
 * End-to-end portfolio analytics from already-loaded inputs (pure + deterministic). The server loader
 * (`./server.ts`) fetches market data and calls `analyzePortfolio`; tests and the AI agent can call it directly.
 */
import { concentrationBy, hhi, mergeHoldings, valuePortfolio, type Concentration, type HoldingInput, type Valuation, type ValuedPosition } from './exposure';
import { annualizedVol, computeBeta, dollarVol, monteCarloVaR, portfolioReturnSeries, type MonteCarloResult } from './risk';
import { alignSeries, covarianceMatrix, toReturns, type PricePoint } from './stats';
import { runStressTests, type StressResult } from './stress';
import { brinsonAttribution, type AttributionResult } from './attribution';
import { cumulative, periodWeightsAndReturns } from './performance';
import { periodStart, type PeriodId } from './benchmarks';

export interface BenchmarkInput { id: string; label: string; history: PricePoint[]; sectorWeights: Record<string, number> }
export interface BenchmarkProxyInput { constituents: { ticker: string; sector: string; weight: number }[]; history: Record<string, PricePoint[]> }

export interface AnalyzeInput {
  holdings: HoldingInput[];
  /** daily close history per ticker (≈1Y) */
  history: Record<string, PricePoint[]>;
  benchmark: BenchmarkInput;
  benchmarkProxy?: BenchmarkProxyInput;
  period: PeriodId;
  /** Monte Carlo seed (default: derived from holdings) */
  seed?: string;
  paths?: number;
  nav?: number;
  distribution?: 'normal' | 'student-t';
  /** tickers whose history comes from a different source than the benchmark (e.g. simulated vs real) — use reference beta */
  referenceBetaFor?: string[];
}

export interface AnalyzedPosition extends ValuedPosition {
  beta: number;
  betaSource: 'regression' | 'assumption';
  annualVol: number | null;
  sparkline: number[];
  periodReturn: number | null;
  hasHistory: boolean;
}

export interface PortfolioAnalytics {
  valuation: Omit<Valuation, 'positions'>;
  positions: AnalyzedPosition[];
  exposure: { sector: Concentration; country: Concentration; positionHhi: number; effectivePositions: number; topWeights: { ticker: string; weight: number }[] };
  risk: {
    beta: number;
    betaSource: 'regression' | 'assumption' | 'mixed';
    betaAdjustedNet: number;
    annualVol: number;
    benchmarkVol: number | null;
    trackingError: number | null;
    dailyDollarVol: number;
    observations: number;
    alignment: 'date' | 'tail';
    monteCarlo: MonteCarloResult;
    /** headline 1-day 95% VaR in $ (positive = loss) */
    var95_1d: number;
    var95_1dPct: number;
  };
  stress: StressResult[];
  performance: { period: PeriodId; start: string | null; end: string | null; portfolioReturn: number; benchmarkReturn: number; active: number; series: { date: string; portfolio: number; benchmark: number }[] };
  attribution: AttributionResult & { calibrated: boolean; proxyNames: number };
  assumptions: string[];
}

const DEFAULT_DAILY_VOL_MISSING = 0.025;

export function analyzePortfolio(input: AnalyzeInput): PortfolioAnalytics {
  const assumptions: string[] = [];
  const holdings = mergeHoldings(input.holdings.filter((h) => h.quantity !== 0));
  const val = valuePortfolio(holdings, { nav: input.nav });

  // --- align history (benchmark first so tail alignment uses its calendar)
  const bId = '__BENCH__';
  const withHist = holdings.filter((h) => (input.history[h.ticker]?.length ?? 0) > 20).map((h) => h.ticker);
  const series: Record<string, PricePoint[]> = {};
  if (input.benchmark.history.length > 20) series[bId] = input.benchmark.history;
  for (const t of withHist) series[t] = input.history[t];
  const aligned = alignSeries(series);
  const benchCloses = aligned.closes[bId];
  const benchRets = benchCloses ? toReturns(benchCloses) : [];
  const rets: Record<string, number[]> = Object.fromEntries(withHist.map((t) => [t, toReturns(aligned.closes[t] ?? [])]));
  if (aligned.method === 'tail') assumptions.push('Price histories came from providers with different calendars; returns were aligned on the most recent observations.');
  if (!benchCloses) assumptions.push(`No ${input.benchmark.label} history available — betas use reference (profile) betas or 1.0.`);

  // --- per-position beta / vol / sparkline
  let assumedBeta = 0;
  const refBeta = new Set((input.referenceBetaFor ?? []).map((t) => t.toUpperCase()));
  const positions: AnalyzedPosition[] = val.positions.map((p) => {
    const r = rets[p.ticker];
    let beta = NaN;
    let source: 'regression' | 'assumption' = 'regression';
    if (r && benchRets.length > 20 && !refBeta.has(p.ticker)) beta = computeBeta(r, benchRets).beta;
    if (!isFinite(beta)) { beta = p.beta != null && isFinite(p.beta) ? p.beta : 1; source = 'assumption'; assumedBeta++; }
    const hist = input.history[p.ticker] ?? [];
    return {
      ...p, beta, betaSource: source, annualVol: r && r.length > 20 ? annualizedVol(r) : null,
      sparkline: hist.slice(-30).map((b) => b.close), periodReturn: null, hasHistory: !!r,
    };
  });
  if (assumedBeta) assumptions.push(`${assumedBeta} position(s) use a reference beta (profile beta or 1.0) because aligned return history was unavailable or came from a different (simulated vs live) source than the benchmark.`);
  const pBeta = positions.reduce((a, p) => a + p.weight * p.beta, 0);

  // --- covariance + Monte Carlo
  const tickers = positions.map((p) => p.ticker);
  const T = withHist.length ? Math.min(...withHist.map((t) => rets[t].length)) : 0;
  const retMatrix = tickers.map((t) => (rets[t] && T > 1 ? rets[t].slice(-T) : []));
  let cov = covarianceMatrix(retMatrix.map((r) => (r.length ? r : new Array<number>(Math.max(T, 2)).fill(0))));
  const missing = tickers.filter((t) => !rets[t]);
  if (missing.length) {
    assumptions.push(`${missing.join(', ')}: no price history — modelled as independent with ${(DEFAULT_DAILY_VOL_MISSING * 100).toFixed(1)}% daily volatility.`);
    cov = cov.map((row, i) => row.map((v, j) => (rets[tickers[i]] && rets[tickers[j]] ? v : i === j ? DEFAULT_DAILY_VOL_MISSING ** 2 : 0)));
  }
  if (!tickers.length) cov = [];
  const exposures = positions.map((p) => p.marketValue);
  const mc = monteCarloVaR({
    exposures, cov, paths: input.paths ?? 5000, seed: input.seed ?? `pf:${tickers.join(',')}:${exposures.map((e) => Math.round(e)).join(',')}`,
    horizons: [1, 10], confidences: [0.95, 0.99], distribution: input.distribution ?? 'student-t', labels: tickers,
  });
  const dVol = dollarVol(exposures, cov);
  const pRets = T > 1 ? portfolioReturnSeries(tickers.map((t) => (rets[t] ? rets[t].slice(-T) : new Array<number>(T).fill(0))), positions.map((p) => p.weight)) : [];
  const bRets = benchRets.slice(-T);
  const te = pRets.length > 20 && bRets.length === pRets.length ? annualizedVol(pRets.map((r, i) => r - bRets[i])) : null;
  const var95 = mc.horizons[0]?.levels.find((l) => l.confidence === 0.95)?.var ?? 0;

  // --- stress
  const stress = runStressTests(positions.map((p) => ({ ticker: p.ticker, sector: p.sector, marketValue: p.marketValue, beta: p.beta })), val.nav);

  // --- performance + attribution over period
  const dates = aligned.dates;
  const end = dates[dates.length - 1] ?? null;
  let perf: PortfolioAnalytics['performance'] = { period: input.period, start: null, end, portfolioReturn: 0, benchmarkReturn: 0, active: 0, series: [] };
  let attribution: PortfolioAnalytics['attribution'] = { ...brinsonAttribution([], [{ sector: 'n/a', weight: 1, ret: 0 }]), calibrated: false, proxyNames: 0 };
  if (end && dates.length > 2) {
    const from = periodStart(end, input.period);
    const i0 = Math.max(0, dates.findIndex((d) => d >= from));
    const window = dates.slice(i0);
    const startPx: Record<string, number> = {};
    const endPx: Record<string, number> = {};
    for (const p of positions) {
      const c = aligned.closes[p.ticker];
      if (c) { startPx[p.ticker] = c[i0]; endPx[p.ticker] = c[c.length - 1]; } else { startPx[p.ticker] = p.price; endPx[p.ticker] = p.price; }
    }
    // valuation uses live quotes; performance uses closes so the window is internally consistent
    const navNow = val.nav;
    const pw = periodWeightsAndReturns(positions.map((p) => ({ ticker: p.ticker, quantity: p.quantity, costBasis: p.costBasis, sector: p.sector })), startPx, endPx, navNow);
    for (const p of positions) p.periodReturn = startPx[p.ticker] > 0 ? endPx[p.ticker] / startPx[p.ticker] - 1 : null;
    // series: buy-and-hold NAV path
    const navPath = window.map((_, k) => {
      const idx = i0 + k;
      let pnlToDate = 0;
      for (const p of positions) {
        const c = aligned.closes[p.ticker];
        if (c) pnlToDate += p.quantity * (c[idx] - c[i0]);
      }
      return pw.navStart + pnlToDate;
    });
    const pCum = navPath.map((v) => (pw.navStart ? v / pw.navStart - 1 : 0));
    const bCum = benchCloses ? window.map((_, k) => benchCloses[i0 + k] / benchCloses[i0] - 1) : window.map(() => 0);
    const Rb = benchCloses ? bCum[bCum.length - 1] : null;

    // benchmark sector returns from proxy constituents
    const bw = input.benchmark.sectorWeights;
    const proxySectorRet: Record<string, { w: number; c: number }> = {};
    let proxyNames = 0;
    if (input.benchmarkProxy) {
      for (const c of input.benchmarkProxy.constituents) {
        const h = input.benchmarkProxy.history[c.ticker];
        if (!h || h.length < 2) continue;
        const startBar = h.find((b) => b.date >= window[0]) ?? h[0];
        const r = startBar.close > 0 ? h[h.length - 1].close / startBar.close - 1 : 0;
        const s = (proxySectorRet[c.sector] ??= { w: 0, c: 0 });
        s.w += c.weight; s.c += c.weight * r; proxyNames++;
      }
    }
    const avail = Object.entries(proxySectorRet).filter(([, v]) => v.w > 0);
    const fill = avail.length ? avail.reduce((a, [, v]) => a + v.c, 0) / avail.reduce((a, [, v]) => a + v.w, 0) : (Rb ?? 0);
    const rbRaw: Record<string, number> = Object.fromEntries(Object.keys(bw).map((k) => [k, proxySectorRet[k]?.w ? proxySectorRet[k].c / proxySectorRet[k].w : fill]));
    const wSum = Object.values(bw).reduce((a, b) => a + b, 0) || 1;
    const implied = Object.entries(bw).reduce((a, [k, w]) => a + (w / wSum) * rbRaw[k], 0);
    const shift = Rb != null ? Rb - implied : 0;
    const benchRows = Object.entries(bw).map(([k, w]) => ({ sector: k, weight: w / wSum, ret: rbRaw[k] + shift }));
    attribution = { ...brinsonAttribution(pw.rows, benchRows), calibrated: Rb != null, proxyNames };
    perf = {
      period: input.period, start: window[0], end, portfolioReturn: pw.periodReturn, benchmarkReturn: attribution.benchmarkReturn,
      active: pw.periodReturn - attribution.benchmarkReturn,
      series: window.map((d, k) => ({ date: d, portfolio: pCum[k], benchmark: bCum[k] })),
    };
    assumptions.push(`Attribution: buy-and-hold of current holdings from ${window[0]}; benchmark sector weights are static ${input.benchmark.label} reference weights; sector returns from ${proxyNames} proxy constituent(s)${Rb != null ? ', calibrated to the benchmark’s actual period return' : ''}.`);
  }

  const sector = concentrationBy(val, 'sector');
  const country = concentrationBy(val, 'country');
  const posH = hhi(positions.map((p) => p.marketValue));
  const { positions: _omit, ...valuation } = val;
  void _omit;
  assumptions.push(`VaR: ${mc.paths.toLocaleString('en-US')} Monte Carlo paths, ${mc.distribution === 'student-t' ? `multivariate Student-t (ν=${mc.df}) ` : 'multivariate normal '}shocks via Cholesky of the ${T}-day sample covariance, zero mean; 10-day uses √10 scaling. Seed ${mc.seed}.`);
  assumptions.push('Capital base (NAV) = long market value + unrealised P&L on shorts (short proceeds held as collateral; no cash or leverage financing modelled).');
  return {
    valuation,
    positions,
    exposure: { sector, country, positionHhi: posH, effectivePositions: posH ? 1 / posH : 0, topWeights: positions.map((p) => ({ ticker: p.ticker, weight: p.weight })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 5) },
    risk: {
      beta: pBeta, betaSource: assumedBeta === 0 ? 'regression' : assumedBeta === positions.length ? 'assumption' : 'mixed',
      betaAdjustedNet: pBeta, annualVol: val.nav ? (dVol / val.nav) * Math.sqrt(252) : 0, benchmarkVol: benchRets.length > 20 ? annualizedVol(benchRets) : null,
      trackingError: te, dailyDollarVol: dVol, observations: T, alignment: aligned.method, monteCarlo: mc, var95_1d: var95, var95_1dPct: val.nav ? var95 / val.nav : 0,
    },
    stress,
    performance: perf,
    attribution,
    assumptions,
  };
}
