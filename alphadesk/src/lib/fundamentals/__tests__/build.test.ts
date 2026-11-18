import { describe, expect, it } from 'vitest';
import type { Bar, Estimates, FinancialStatementRow, SourceRef } from '@/lib/data/types';
import { adjustForSplits, buildFundamentals, closeOnOrBefore, estimateGrowth, ttmFreeCashFlow, type BuildInput } from '../build';

const src: SourceRef = { id: 's', name: 'src', kind: 'filing' };
const rowSource = (r: FinancialStatementRow): SourceRef => ({ id: `row:${r.fiscalYear}-${r.fiscalPeriod}`, name: `10-K FY${r.fiscalYear}`, kind: 'filing', url: 'https://www.sec.gov/x' });

function row(p: Partial<FinancialStatementRow> & { fiscalYear: number; fiscalPeriod: string; periodEnd: string }): FinancialStatementRow {
  return {
    revenue: 0, grossProfit: 0, operatingIncome: 0, netIncome: 0, ebitda: 0, eps: 0, totalAssets: 0, totalLiabilities: 0, totalEquity: 0, cash: 0,
    totalDebt: 0, operatingCashFlow: 0, capex: 0, freeCashFlow: 0, sharesOutstanding: 0, grossMargin: 0, operatingMargin: 0, netMargin: 0, ...p,
  };
}

/** 6 fiscal years (FY2020–FY2025, Dec year-end), EPS 1.00 → 1.61 (10%/yr), equity 1000, debt 500, 100 shares. */
function annualFixture(over: Partial<FinancialStatementRow> = {}): FinancialStatementRow[] {
  return [0, 1, 2, 3, 4, 5].map((i) => row({
    fiscalYear: 2020 + i, fiscalPeriod: 'FY', periodEnd: `${2020 + i}-12-31`, eps: Math.pow(1.1, i), totalEquity: 1000, totalDebt: 500, cash: 200,
    operatingCashFlow: 220, capex: 20, freeCashFlow: 200, sharesOutstanding: 100, ...over,
  }));
}
/** 4 quarters of 2025 (span ~274 days) — EPS sums to 2.00, OCF 60 × 4 − capex 10 × 4 = 200. */
function quarterlyFixture(over: Partial<FinancialStatementRow> = {}): FinancialStatementRow[] {
  return [['Q1', '2025-03-31'], ['Q2', '2025-06-30'], ['Q3', '2025-09-30'], ['Q4', '2025-12-31']].map(([q, d]) => row({
    fiscalYear: 2025, fiscalPeriod: q, periodEnd: d, eps: 0.5, totalEquity: 1000, totalDebt: 500, cash: 200, operatingCashFlow: 60, capex: 10, sharesOutstanding: 100, ...over,
  }));
}
function bars(): Bar[] {
  const out: Bar[] = [];
  for (let y = 2021; y <= 2025; y++) for (const md of ['06-30', '12-30']) out.push({ date: `${y}-${md}`, open: 30, high: 30, low: 30, close: 30, volume: 1 });
  return out;
}
const estimates = (fy2027: number): Estimates => ({
  ticker: 'TST', rating: { buy: 0, hold: 0, sell: 0 }, priceTarget: { mean: 0, high: 0, low: 0 },
  periods: [
    { period: 'FY2026', metric: 'eps', consensus: 2.2, high: 0, low: 0, numAnalysts: 10, revisions: [], change30dPct: 0, change90dPct: 0 },
    { period: 'FY2027', metric: 'eps', consensus: fy2027, high: 0, low: 0, numAnalysts: 8, revisions: [], change30dPct: 0, change90dPct: 0 },
  ],
});

function input(over: Partial<BuildInput> = {}): BuildInput {
  return {
    ticker: 'TST', price: 30, priceSource: src, annual: annualFixture(), quarterly: quarterlyFixture(), rowSource,
    estimates: estimates(2.42), estimatesSource: { id: 'av', name: 'AV', kind: 'estimate' },
    riskFree: { value: 4, date: '2026-11-16', series: 'DGS10' }, aaa: { value: 5.5, date: '2026-11-16', series: 'DAAA' },
    beta: { value: 1.2, basis: 'test', source: src }, bars: bars(), isFund: false, isFinancial: false, ...over,
  };
}

describe('helpers', () => {
  it('TTM FCF from 4 quarters, else latest FY', () => {
    expect(ttmFreeCashFlow(annualFixture(), quarterlyFixture()).value).toBe(200);
    expect(ttmFreeCashFlow(annualFixture({ freeCashFlow: 150 }), []).value).toBe(150);
    expect(ttmFreeCashFlow([], []).value).toBeNull();
  });
  it('closeOnOrBefore within a week', () => {
    expect(closeOnOrBefore(bars(), '2024-12-31')?.date).toBe('2024-12-30');
    expect(closeOnOrBefore(bars(), '2024-10-31')).toBeNull(); // > 7 days gap
    expect(closeOnOrBefore(bars(), '2019-01-01')).toBeNull();
  });
  it('growth: consensus CAGR to the furthest FY ≤ 3y out', () => {
    // TTM 2.00 → FY2027 2.42 over 2 yrs = 10%
    const g = estimateGrowth({ epsTtm: 2, annual: annualFixture(), quarterly: quarterlyFixture(), estimates: estimates(2.42), estimatesSource: src, ticker: 'TST', rowSource });
    expect(g.basis).toBe('consensus');
    expect(g.raw).toBeCloseTo(10, 6);
    expect(g.capped).toBe(false);
  });
  it('growth: capped at +25%', () => {
    const g = estimateGrowth({ epsTtm: 2, annual: annualFixture(), quarterly: quarterlyFixture(), estimates: estimates(8), estimatesSource: src, ticker: 'TST', rowSource });
    expect(g.raw).toBeCloseTo(100, 6);
    expect(g.value).toBe(25);
    expect(g.capped).toBe(true);
  });
  it('growth: historical EPS CAGR when no consensus', () => {
    const g = estimateGrowth({ epsTtm: 2, annual: annualFixture(), quarterly: [], estimates: null, estimatesSource: null, ticker: 'TST', rowSource });
    expect(g.basis).toBe('historical-eps');
    expect(g.raw).toBeCloseTo(10, 6); // FY2020 1.00 → FY2025 1.61, 5 yrs
  });
});

describe('adjustForSplits', () => {
  it('restates pre-split EPS and shares (10-for-1), ignores ordinary buybacks', () => {
    const rows = [
      row({ fiscalYear: 2023, fiscalPeriod: 'FY', periodEnd: '2023-12-31', eps: 12, sharesOutstanding: 2_500 }),
      row({ fiscalYear: 2024, fiscalPeriod: 'FY', periodEnd: '2024-12-31', eps: 2, sharesOutstanding: 24_800 }),
      row({ fiscalYear: 2025, fiscalPeriod: 'FY', periodEnd: '2025-12-31', eps: 3, sharesOutstanding: 24_500 }),
    ];
    const { rows: out, splits } = adjustForSplits(rows);
    expect(splits).toEqual([{ before: '2024-12-31', ratio: 10 }]);
    expect(out[0].eps).toBeCloseTo(1.2, 10);
    expect(out[0].sharesOutstanding).toBe(25_000);
    expect(out[1]).toEqual(rows[1]);
    expect(rows[0].eps).toBe(12); // input not mutated
  });
  it('handles reverse splits', () => {
    const { rows: out } = adjustForSplits([
      row({ fiscalYear: 2024, fiscalPeriod: 'FY', periodEnd: '2024-12-31', eps: -0.1, sharesOutstanding: 1_000 }),
      row({ fiscalYear: 2025, fiscalPeriod: 'FY', periodEnd: '2025-12-31', eps: -2, sharesOutstanding: 50 }),
    ]);
    expect(out[0].sharesOutstanding).toBe(50);
    expect(out[0].eps).toBeCloseTo(-2, 10);
  });
});

describe('buildFundamentals', () => {
  it('computes every block for a normal company (hand-checked)', () => {
    const m = buildFundamentals(input());
    expect(m.kind).toBe('company');
    // TTM EPS 2.00, g 10, Y 5.5 → 2 × 28.5 × 0.8 = 45.6
    expect(m.graham.value).toBeCloseTo(45.6, 6);
    // BVPS 10 → Graham Number √(22.5 × 2 × 10) = √450
    expect(m.graham.grahamNumber).toBeCloseTo(Math.sqrt(450), 6);
    expect(m.graham.marginOfSafety).toBeCloseTo(((45.6 - 30) / 45.6) * 100, 6);
    // discount = 4 + 1.2 × 5 = 10
    expect(m.dcf.defaults).toEqual({ growth: 10, discount: 10, terminal: 2.5 });
    expect(m.dcf.result?.ok).toBe(true);
    if (m.dcf.result?.ok) {
      // FCF 220, 242, 266.2 → PV 200 each; TV = 266.2 × 1.025 / 0.075 = 3638.07; PV = 2733.33; + cash 200 − debt 500
      expect(m.dcf.result.sumPvFcf).toBeCloseTo(600, 6);
      expect(m.dcf.result.pvTerminal).toBeCloseTo((266.2 * 1.025) / 0.075 / 1.331, 6);
      expect(m.dcf.result.perShare).toBeCloseTo((600 + (266.2 * 1.025) / 0.075 / 1.331 - 300) / 100, 6);
    }
    // P/E 15 ÷ growth 10 = 1.5
    expect(m.peg.value).toBeCloseTo(1.5, 6);
    expect(m.peg.band).toBe('fair');
    expect(m.pb.value).toBeCloseTo(3, 6);
    expect(m.de.value).toBeCloseTo(0.5, 6);
    expect(m.pb.history.map((p) => p.label)).toEqual(['FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025', 'Now']);
    expect(m.pb.history[0].value).toBeCloseTo(3, 6);
    expect(m.de.history).toHaveLength(5); // latest quarter = FY end → no duplicate "Now"
  });

  it('DCF overrides are applied (API ?growth=&discount=&terminal=)', () => {
    const m = buildFundamentals(input({ overrides: { growth: 0, discount: 8, terminal: 0 } }));
    expect(m.dcf.params).toEqual({ growth: 0, discount: 8, terminal: 0 });
    if (!m.dcf.result?.ok) throw new Error('dcf');
    expect(m.dcf.result.perShare).toBeCloseTo((200 / 0.08 - 300) / 100, 6);
  });

  it('r ≤ terminal growth → DCF not meaningful', () => {
    const m = buildFundamentals(input({ overrides: { discount: 2, terminal: 2.5 } }));
    expect(m.dcf.status).toBe('nm');
    expect(m.dcf.reason).toMatch(/must exceed terminal growth/);
  });

  it('loss-maker: Graham, PEG and DCF not meaningful; P/B still shown', () => {
    const m = buildFundamentals(input({
      annual: annualFixture({ eps: -1, freeCashFlow: -50, operatingCashFlow: -30 }),
      quarterly: quarterlyFixture({ eps: -0.25, operatingCashFlow: -5, capex: 10 }),
      estimates: null,
    }));
    expect(m.graham.status).toBe('nm');
    expect(m.graham.reason).toMatch(/negative or zero/);
    expect(m.peg.status).toBe('nm');
    expect(m.dcf.status).toBe('nm');
    expect(m.dcf.reason).toMatch(/zero or negative/);
    expect(m.pb.value).toBeCloseTo(3, 6);
  });

  it('negative equity: D/E flagged, P/B not meaningful, no Graham Number', () => {
    const m = buildFundamentals(input({ annual: annualFixture({ totalEquity: -200 }), quarterly: quarterlyFixture({ totalEquity: -200 }) }));
    expect(m.de.status).toBe('negative-equity');
    expect(m.de.value).toBeNull();
    expect(m.de.history.every((p) => p.negativeEquity)).toBe(true);
    expect(m.pb.status).toBe('nm');
    expect(m.graham.grahamNumber).toBeNull();
    expect(m.graham.value).not.toBeNull(); // Graham V itself only needs EPS
  });

  it('bank: DCF and D/E not meaningful, P/B and PEG kept', () => {
    const m = buildFundamentals(input({ isFinancial: true }));
    expect(m.kind).toBe('financial');
    expect(m.dcf.status).toBe('nm');
    expect(m.dcf.reason).toMatch(/financial companies/);
    expect(m.de.status).toBe('nm');
    expect(m.pb.status).toBe('ok');
    expect(m.peg.status).toBe('ok');
  });

  it('ETF / fund: not applicable', () => {
    const m = buildFundamentals(input({ isFund: true, annual: [], quarterly: [] }));
    expect(m.kind).toBe('fund');
    expect(m.reason).toMatch(/Not applicable to funds/);
  });

  it('missing data: no statements → unavailable; no FRED → fallbacks + notes', () => {
    expect(buildFundamentals(input({ annual: [], quarterly: [] })).kind).toBe('unavailable');
    const m = buildFundamentals(input({ riskFree: null, aaa: null, beta: null }));
    expect(m.graham.status).toBe('nm');
    expect(m.graham.reason).toMatch(/Aaa/);
    expect(m.dcf.defaults.discount).toBeCloseTo(4.5 + 5, 6); // fallback rf 4.5 + β 1.0 × 5
    expect(m.notes.join(' ')).toMatch(/fallback risk-free/);
  });
});
