import { describe, expect, it } from 'vitest';
import {
  alignSeries, analyzePortfolio, brinsonAttribution, cholesky, computeBeta, concentrationBy, covarianceMatrix, CASH_SEGMENT,
  DEFAULT_SCENARIOS, hhi, monteCarloVaR, mulberry32, normalGenerator, parsePositionsCsv, mergeCsvRows, positionsGate, newTickerCount,
  runStressTests, strikeShares, suggestRebalance, computeDrift, validateTargetWeights, valuePortfolio, annualizedVol, toReturns,
  type PricePoint, type MonteCarloOptions,
} from '@/lib/analytics';

const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

/** synthetic correlated price paths: asset = beta·market + idio */
function synth(seed: number, n: number, betas: number[], vol = 0.01): { bench: number[]; assets: number[][] } {
  const g = normalGenerator(mulberry32(seed));
  const bench: number[] = [];
  const assets: number[][] = betas.map(() => []);
  for (let t = 0; t < n; t++) {
    const m = g() * vol;
    bench.push(m);
    betas.forEach((b, i) => assets[i].push(b * m + g() * vol * 0.5));
  }
  return { bench, assets };
}
const toPrices = (rets: number[], start = 100) => rets.reduce<number[]>((a, r) => (a.push(a[a.length - 1] * (1 + r)), a), [start]);
const dates = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10));
const pts = (prices: number[]): PricePoint[] => { const d = dates(prices.length); return prices.map((c, i) => ({ date: d[i], close: c })); };

describe('valuation, weights & exposure', () => {
  const book = valuePortfolio([
    { ticker: 'AAA', quantity: 100, costBasis: 50, price: 60, prevClose: 58, sector: 'Information Technology', country: 'US' },
    { ticker: 'BBB', quantity: 200, costBasis: 20, price: 25, prevClose: 25, sector: 'Financials', country: 'US' },
    { ticker: 'CCC', quantity: -50, costBasis: 100, price: 80, prevClose: 82, sector: 'Information Technology', country: 'JP' },
  ]);
  it('computes long/short/gross/net and NAV', () => {
    expect(book.longMarketValue).toBe(6000 + 5000);
    expect(book.shortMarketValue).toBe(4000);
    expect(book.grossExposure).toBe(15000);
    expect(book.netExposure).toBe(7000);
    // short gained 50 * 20 = 1000 → NAV = 11000 + 1000
    expect(book.nav).toBe(12000);
    near(book.grossPct, 15000 / 12000);
    near(book.netPct, 7000 / 12000);
  });
  it('weights sum to net % and gross weights sum to 1', () => {
    near(book.positions.reduce((a, p) => a + p.weight, 0), book.netPct);
    near(book.positions.reduce((a, p) => a + p.grossWeight, 0), 1);
  });
  it('day & unrealized P&L are sign-correct for shorts', () => {
    const c = book.positions.find((p) => p.ticker === 'CCC')!;
    expect(c.unrealizedPnl).toBe(1000);
    expect(c.dayPnl).toBe(100); // price fell 2, short 50
    expect(book.dayPnl).toBe(200 + 0 + 100);
  });
  it('sector concentration + HHI', () => {
    const s = concentrationBy(book, 'sector');
    expect(s.buckets[0].key).toBe('Information Technology');
    expect(s.buckets[0].gross).toBe(10000);
    expect(s.buckets[0].net).toBe(2000);
    near(s.hhi, (10 / 15) ** 2 + (5 / 15) ** 2);
    near(hhi([1, 1, 1, 1]), 0.25);
    expect(concentrationBy(book, 'country').buckets.map((b) => b.key).sort()).toEqual(['JP', 'US']);
  });
});

describe('beta & volatility', () => {
  it('recovers known betas from synthetic returns', () => {
    const { bench, assets } = synth(7, 750, [0.5, 1.0, 1.8]);
    const b = assets.map((a) => computeBeta(a, bench).beta);
    expect(b[0]).toBeGreaterThan(0.4); expect(b[0]).toBeLessThan(0.6);
    expect(b[1]).toBeGreaterThan(0.9); expect(b[1]).toBeLessThan(1.1);
    expect(b[2]).toBeGreaterThan(1.65); expect(b[2]).toBeLessThan(1.95);
  });
  it('beta of benchmark on itself is 1 and annualized vol scales by √252', () => {
    const { bench } = synth(3, 300, []);
    near(computeBeta(bench, bench).beta, 1, 1e-12);
    const r = [0.01, -0.01, 0.01, -0.01];
    near(annualizedVol(r), Math.sqrt(4 * 0.0001 / 3) * Math.sqrt(252), 1e-12);
  });
  it('returns NaN beta when benchmark has no variance', () => {
    expect(Number.isNaN(computeBeta([0.1, 0.2, 0.3], [0, 0, 0]).beta)).toBe(true);
  });
});

describe('Cholesky', () => {
  it('reconstructs a PD matrix', () => {
    const A = [[4, 2, 0.6], [2, 5, 1.5], [0.6, 1.5, 3]];
    const { L, ridge } = cholesky(A);
    expect(ridge).toBe(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(L[i].reduce((s, _, k) => s + L[i][k] * L[j][k], 0), A[i][j], 1e-12);
  });
  it('adds a ridge for singular matrices instead of failing', () => {
    const { ridge } = cholesky([[1, 1], [1, 1]]);
    expect(ridge).toBeGreaterThan(0);
  });
});

describe('Monte Carlo VaR / CVaR', () => {
  const cov = [[0.0004, 0.0002], [0.0002, 0.0009]];
  const base: MonteCarloOptions = { exposures: [1_000_000, 500_000], cov, paths: 5000, seed: 'test' };
  it('is deterministic for a seed and changes with the seed', () => {
    const a = monteCarloVaR({ ...base });
    const b = monteCarloVaR({ ...base });
    const c = monteCarloVaR({ ...base, seed: 'other' });
    expect(a.horizons[0].levels).toEqual(b.horizons[0].levels);
    expect(a.histogram).toEqual(b.histogram);
    expect(c.horizons[0].levels[0].var).not.toBe(a.horizons[0].levels[0].var);
    expect(a.paths).toBe(5000);
  });
  it('CVaR ≥ VaR, 99% ≥ 95%, 10-day > 1-day', () => {
    for (const distribution of ['normal', 'student-t'] as const) {
      const r = monteCarloVaR({ ...base, distribution });
      for (const h of r.horizons) {
        const [l95, l99] = h.levels;
        expect(l95.cvar).toBeGreaterThanOrEqual(l95.var);
        expect(l99.cvar).toBeGreaterThanOrEqual(l99.var);
        expect(l99.var).toBeGreaterThan(l95.var);
      }
      expect(r.horizons[1].levels[0].var).toBeGreaterThan(r.horizons[0].levels[0].var * 2.5);
    }
  });
  it('normal MC VaR is within 5% of the analytic (parametric) VaR', () => {
    const r = monteCarloVaR({ ...base, distribution: 'normal' });
    const h = r.horizons[0];
    expect(Math.abs(h.levels[0].var / h.parametric[0].var - 1)).toBeLessThan(0.05);
    expect(Math.abs(h.levels[1].var / h.parametric[1].var - 1)).toBeLessThan(0.08);
  });
  it('a hedged book has lower VaR than an unhedged one', () => {
    const corr = [[0.0004, 0.00038], [0.00038, 0.0004]];
    const longOnly = monteCarloVaR({ exposures: [1e6, 0], cov: corr, seed: 1, distribution: 'normal' }).horizons[0].levels[0].var;
    const hedged = monteCarloVaR({ exposures: [1e6, -1e6], cov: corr, seed: 1, distribution: 'normal' }).horizons[0].levels[0].var;
    expect(hedged).toBeLessThan(longOnly * 0.4);
  });
  it('component CVaR contributions sum to 1-day CVaR at 99%', () => {
    const r = monteCarloVaR({ ...base, labels: ['A', 'B'] });
    const tot = r.contributions.reduce((a, c) => a + c.cvarContribution, 0);
    near(tot, r.horizons[0].levels[1].cvar, 1e-6);
    near(r.histogram.reduce((a, b) => a + b.count, 0), 5000);
  });
});

describe('stress tests', () => {
  const positions = [
    { ticker: 'TECH', sector: 'Information Technology', marketValue: 100_000, beta: 1.5 },
    { ticker: 'BANK', sector: 'Financials', marketValue: 50_000, beta: 1.1 },
    { ticker: 'OIL', sector: 'Energy', marketValue: -40_000, beta: 0.9 },
  ];
  const res = runStressTests(positions, 200_000);
  const by = Object.fromEntries(res.map((r) => [r.id, r]));
  it('runs the four default scenarios', () => {
    expect(res.map((r) => r.id)).toEqual(DEFAULT_SCENARIOS.map((s) => s.id));
  });
  it('equity −20% is beta-scaled and shorts gain', () => {
    const e = by.equity_down_20;
    near(e.positions.find((p) => p.ticker === 'TECH')!.pnl, 100_000 * -0.3);
    near(e.positions.find((p) => p.ticker === 'OIL')!.pnl, -40_000 * -0.18);
    near(e.pnl, -30_000 - 11_000 + 7_200);
    near(e.pnlPct, e.pnl / 200_000);
  });
  it('rates +200bp uses 2× sector sensitivities; banks benefit', () => {
    const r = by.rates_200bp;
    near(r.positions.find((p) => p.ticker === 'TECH')!.shock, -0.09);
    expect(r.positions.find((p) => p.ticker === 'BANK')!.pnl).toBeGreaterThan(0);
    expect(r.sectorTable!['Real Estate']).toBeCloseTo(-0.13);
  });
  it('oil spike hurts a short energy position; position P&L sums to total', () => {
    const o = by.oil_spike;
    expect(o.positions.find((p) => p.ticker === 'OIL')!.pnl).toBeLessThan(0);
    for (const r of res) near(r.positions.reduce((a, p) => a + p.pnl, 0), r.pnl, 1e-6);
    expect(by.tech_selloff.worst!.ticker).toBe('TECH');
  });
});

describe('Brinson attribution', () => {
  const port = [
    { sector: 'IT', weight: 0.6, ret: 0.2 }, { sector: 'IT', weight: 0.1, ret: -0.1 },
    { sector: 'Fin', weight: 0.3, ret: 0.05 },
  ];
  const bench = [{ sector: 'IT', weight: 0.4, ret: 0.15 }, { sector: 'Fin', weight: 0.4, ret: 0.03 }, { sector: 'Energy', weight: 0.2, ret: -0.05 }];
  it('allocation + selection + interaction = active return', () => {
    const a = brinsonAttribution(port, bench);
    near(a.allocation + a.selection + a.interaction, a.active, 1e-12);
    near(a.portfolioReturn, 0.6 * 0.2 + 0.1 * -0.1 + 0.3 * 0.05, 1e-12);
    near(a.benchmarkReturn, 0.4 * 0.15 + 0.4 * 0.03 + 0.2 * -0.05, 1e-12);
    for (const s of a.segments) near(s.allocation + s.selection + s.interaction, s.total, 1e-12);
  });
  it('handles long/short books (cash segment) and net-zero sectors', () => {
    const ls = [{ sector: 'IT', weight: 0.8, ret: 0.1 }, { sector: 'Fin', weight: 0.3, ret: 0.02 }, { sector: 'Fin', weight: -0.3, ret: -0.04 }, { sector: 'Energy', weight: -0.2, ret: 0.05 }];
    const a = brinsonAttribution(ls, bench);
    expect(a.segments.some((s) => s.sector === CASH_SEGMENT)).toBe(true);
    near(a.allocation + a.selection + a.interaction, a.active, 1e-12);
    const fin = a.segments.find((s) => s.sector === 'Fin')!;
    near(fin.contribution, 0.3 * 0.02 + -0.3 * -0.04, 1e-12);
  });
  it('identical portfolio and benchmark → zero active', () => {
    const a = brinsonAttribution(bench, bench);
    near(a.active, 0, 1e-12);
    for (const s of a.segments) near(s.total, 0, 1e-12);
  });
});

describe('basket drift & rebalance', () => {
  const targets = [{ ticker: 'A', targetWeight: 0.5, price: 100 }, { ticker: 'B', targetWeight: 0.3, price: 50 }, { ticker: 'C', targetWeight: 0.2, price: 20 }];
  const shares = strikeShares(targets, 1_000_000);
  it('struck shares hit targets at strike prices', () => {
    const d = computeDrift(targets.map((t) => ({ ...t, shares: shares[t.ticker] })));
    for (const r of d.rows) near(r.drift, 0, 1e-12);
    near(d.totalValue, 1_000_000, 1e-6);
  });
  const drifted = [{ ticker: 'A', targetWeight: 0.5, shares: shares.A, price: 140 }, { ticker: 'B', targetWeight: 0.3, shares: shares.B, price: 45 }, { ticker: 'C', targetWeight: 0.2, shares: shares.C, price: 21 }];
  it('full rebalance trades restore every target weight', () => {
    const r = suggestRebalance(drifted, { mode: 'full' });
    expect(r.breaches).toBeGreaterThan(0);
    for (const [t, w] of Object.entries(r.postTradeWeights)) near(w, r.rows.find((x) => x.ticker === t)!.targetWeight, 1e-9);
    near(r.cashResidual, 0, 1e-6);
    expect(r.trades.find((t) => t.ticker === 'A')!.action).toBe('SELL');
    expect(r.trades.find((t) => t.ticker === 'B')!.action).toBe('BUY');
  });
  it('whole-share rounding stays within one share of target', () => {
    const r = suggestRebalance(drifted, { mode: 'full', wholeShares: true });
    for (const t of r.trades) expect(Number.isInteger(t.shares)).toBe(true);
    for (const row of r.rows) expect(Math.abs(r.postTradeWeights[row.ticker] - row.targetWeight)).toBeLessThan(row.price / r.totalValue + 1e-12);
  });
  it('band mode only trades names outside tolerance; no trades when inside band', () => {
    const r = suggestRebalance(drifted, { tolerance: 0.05 });
    const driftTrades = r.trades.filter((t) => t.reason === 'drift');
    expect(driftTrades.length).toBeGreaterThan(0);
    for (const t of driftTrades) {
      expect(Math.abs(r.rows.find((x) => x.ticker === t.ticker)!.drift)).toBeGreaterThan(0.05);
      near(r.postTradeWeights[t.ticker], r.rows.find((x) => x.ticker === t.ticker)!.targetWeight, 1e-9);
    }
    // self-funding: fully invested after trades
    near(r.cashResidual, 0, 1e-6);
    near(Object.values(r.postTradeWeights).reduce((a, b) => a + b, 0), 1, 1e-9);
    const unfunded = suggestRebalance(drifted, { tolerance: 0.05, selfFunding: false });
    expect(unfunded.trades.every((t) => t.reason === 'drift')).toBe(true);
    const calm = suggestRebalance(drifted, { tolerance: 0.5 });
    expect(calm.trades).toHaveLength(0);
  });
  it('validates target weights sum to 100%', () => {
    expect(validateTargetWeights([0.5, 0.3, 0.2]).ok).toBe(true);
    expect(validateTargetWeights([0.5, 0.3]).ok).toBe(false);
    expect(validateTargetWeights([1.2, -0.2]).ok).toBe(false);
  });
});

describe('position limits by plan', () => {
  it('FREE allows 5, Pro unlimited', () => {
    expect(positionsGate({ plan: 'FREE' }, 4, 1).allowed).toBe(true);
    const f = positionsGate({ plan: 'FREE' }, 5, 1);
    expect(f.allowed).toBe(false);
    expect(f.upgradeTo).toBe('PRO_PLUS');
    expect(f.maxAddable).toBe(0);
    expect(positionsGate({ plan: 'PRO' }, 10, 41).allowed).toBe(true);
    expect(positionsGate({ plan: 'PRO_PLUS' }, 10_000, 5000).allowed).toBe(true);
  });
  it('counts only new tickers when appending', () => {
    expect(newTickerCount(['MSFT', 'nvda'], ['NVDA', 'AAPL', 'aapl', 'TSLA'])).toBe(2);
  });
});

describe('CSV parsing', () => {
  it('parses valid rows with aliases, percents and shorts', () => {
    const r = parsePositionsCsv('Symbol,Qty,Cost,Weight\nmsft,100,"$410.50",10%\nTSLA,-50,380,-3\nNVDA,"1,000",120,0.12\n');
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.ticker, x.quantity, x.costBasis, x.targetWeight])).toEqual([
      ['MSFT', 100, 410.5, 0.1], ['TSLA', -50, 380, -0.03], ['NVDA', 1000, 120, 0.12],
    ]);
  });
  it('reports row-level errors with line numbers', () => {
    const r = parsePositionsCsv('ticker,quantity,cost_basis\nMSFT,abc,10\n,5,10\nGOOD,0,10\nBAD$,1,1\nOK,10,-1\nFINE,10,5\n');
    expect(r.rows.map((x) => x.ticker)).toEqual(['FINE']);
    expect(r.errors.map((e) => [e.line, e.field])).toEqual([[2, 'quantity'], [3, 'ticker'], [4, 'quantity'], [5, 'ticker'], [6, 'cost_basis']]);
  });
  it('rejects a missing header and warns on duplicates / unknown tickers', () => {
    expect(parsePositionsCsv('foo,bar\n1,2').errors[0].field).toBe('header');
    const r = parsePositionsCsv('ticker,quantity,cost_basis\nMSFT,10,1\nMSFT,30,3\nZZZZ,1,1', { knownTickers: new Set(['MSFT']) });
    expect(r.warnings.map((w) => w.line)).toEqual([3, 4]);
    const merged = mergeCsvRows(r.rows);
    expect(merged.find((x) => x.ticker === 'MSFT')).toMatchObject({ quantity: 40, costBasis: 2.5 });
  });
  it('enforces the max row count', () => {
    const body = Array.from({ length: 12 }, (_, i) => `T${String.fromCharCode(65 + i)},1,1`).join('\n');
    const r = parsePositionsCsv(`ticker,quantity,cost_basis\n${body}`, { maxRows: 10 });
    expect(r.rows).toHaveLength(10);
    expect(r.errors.some((e) => e.field === 'file')).toBe(true);
  });
});

describe('series alignment & end-to-end analyzePortfolio', () => {
  it('inner-joins on dates', () => {
    const a = alignSeries({ X: [{ date: '2025-01-01', close: 1 }, { date: '2025-01-02', close: 2 }, { date: '2025-01-03', close: 3 }], Y: [{ date: '2025-01-02', close: 5 }, { date: '2025-01-03', close: 6 }] }, 2);
    expect(a.dates).toEqual(['2025-01-02', '2025-01-03']);
    expect(a.closes.X).toEqual([2, 3]);
  });
  const { bench, assets } = synth(11, 260, [1.4, 0.6, 1.0]);
  const sectorWeights = { 'Information Technology': 0.5, Financials: 0.3, Energy: 0.2 };
  const input = {
    holdings: [
      { ticker: 'AAA', quantity: 1000, costBasis: 90, price: toPrices(assets[0]).at(-1)!, sector: 'Information Technology', country: 'US' },
      { ticker: 'BBB', quantity: 2000, costBasis: 40, price: toPrices(assets[1]).at(-1)!, sector: 'Financials', country: 'US' },
      { ticker: 'CCC', quantity: -500, costBasis: 100, price: toPrices(assets[2]).at(-1)!, sector: 'Energy', country: 'GB' },
      { ticker: 'NOHIST', quantity: 10, costBasis: 10, price: 12, sector: null, country: null, beta: 1.2 },
    ],
    history: { AAA: pts(toPrices(assets[0])), BBB: pts(toPrices(assets[1])), CCC: pts(toPrices(assets[2])) },
    benchmark: { id: 'SPY', label: 'S&P 500', history: pts(toPrices(bench)), sectorWeights },
    period: '3M' as const,
    paths: 2000,
  };
  const a = analyzePortfolio(input);
  it('produces consistent headline numbers', () => {
    expect(a.positions).toHaveLength(4);
    expect(a.positions.find((p) => p.ticker === 'NOHIST')).toMatchObject({ betaSource: 'assumption', beta: 1.2, sector: 'Unclassified' });
    const b = a.positions.find((p) => p.ticker === 'AAA')!.beta;
    expect(b).toBeGreaterThan(1.2); expect(b).toBeLessThan(1.6);
    near(a.risk.beta, a.positions.reduce((s, p) => s + p.weight * p.beta, 0), 1e-12);
    expect(a.risk.var95_1d).toBeGreaterThan(0);
    expect(a.risk.monteCarlo.horizons[0].levels[0].cvar).toBeGreaterThanOrEqual(a.risk.var95_1d);
    expect(a.stress).toHaveLength(4);
    expect(a.assumptions.join(' ')).toMatch(/NOHIST/);
  });
  it('attribution sums to active return and matches performance', () => {
    near(a.attribution.allocation + a.attribution.selection + a.attribution.interaction, a.attribution.active, 1e-12);
    near(a.performance.portfolioReturn, a.attribution.portfolioReturn, 1e-9);
    // calibrated to actual benchmark period return
    const s = a.performance.series;
    near(a.attribution.benchmarkReturn, s[s.length - 1].benchmark, 1e-9);
    near(s[s.length - 1].portfolio, a.performance.portfolioReturn, 1e-9);
  });
  it('is deterministic', () => {
    expect(analyzePortfolio(input).risk.monteCarlo.horizons).toEqual(a.risk.monteCarlo.horizons);
  });
  it('falls back to reference betas without benchmark history', () => {
    const b = analyzePortfolio({ ...input, benchmark: { ...input.benchmark, history: [] } });
    expect(b.risk.betaSource).toBe('assumption');
    expect(b.assumptions.join(' ')).toMatch(/No S&P 500 history/);
  });
  it('covariance matrix is symmetric', () => {
    const c = covarianceMatrix([toReturns([1, 2, 3, 2]), toReturns([3, 1, 2, 4])]);
    expect(c[0][1]).toBe(c[1][0]);
  });
});
