import { describe, expect, it } from 'vitest';
import type { FinancialStatementRow, SourceRef } from '@/lib/data/types';
import { buildFundamentals, type BuildInput } from '../build';
import {
  FACTORY_VALUATION_DEFAULTS, factoryDefaults, parseValuationDefaults, presetBodySchema, valuationDefaultsSchema, type ValuationDefaults,
} from '../defaults';
import { grahamValue, pegBand, pegBandText } from '../formulas';

const src: SourceRef = { id: 's', name: 'src', kind: 'filing' };
const rowSource = (r: FinancialStatementRow): SourceRef => ({ id: `row:${r.fiscalYear}-${r.fiscalPeriod}`, name: `10-K FY${r.fiscalYear}`, kind: 'filing' });
const row = (p: Partial<FinancialStatementRow> & { fiscalYear: number; fiscalPeriod: string; periodEnd: string }): FinancialStatementRow => ({
  revenue: 0, grossProfit: 0, operatingIncome: 0, netIncome: 0, ebitda: 0, eps: 0, totalAssets: 0, totalLiabilities: 0, totalEquity: 1000, cash: 200,
  totalDebt: 500, operatingCashFlow: 0, capex: 0, freeCashFlow: 0, sharesOutstanding: 100, grossMargin: 0, operatingMargin: 0, netMargin: 0, ...p,
});
/** EPS 1.00 → 1.61 over FY2020–25 (10%/yr historical), TTM EPS 2.00, TTM FCF 200, cash 200, debt 500, 100 shares. */
function input(defaults?: ValuationDefaults, over: Partial<BuildInput> = {}): BuildInput {
  return {
    ticker: 'TST', price: 30, priceSource: src, rowSource, estimates: null, estimatesSource: null, bars: [], isFund: false, isFinancial: false,
    annual: [0, 1, 2, 3, 4, 5].map((i) => row({ fiscalYear: 2020 + i, fiscalPeriod: 'FY', periodEnd: `${2020 + i}-12-31`, eps: Math.pow(1.1, i), operatingCashFlow: 220, capex: 20, freeCashFlow: 200 })),
    quarterly: [['Q1', '2025-03-31'], ['Q2', '2025-06-30'], ['Q3', '2025-09-30'], ['Q4', '2025-12-31']].map(([q, d]) => row({ fiscalYear: 2025, fiscalPeriod: q, periodEnd: d, eps: 0.5, operatingCashFlow: 60, capex: 10 })),
    riskFree: { value: 4, date: '2026-11-16', series: 'DGS10' }, aaa: { value: 5.5, date: '2026-11-16', series: 'DAAA' },
    beta: { value: 1.2, basis: 'test', source: src }, defaults, ...over,
  };
}
const clone = (): ValuationDefaults => factoryDefaults();

describe('valuation defaults: factory values + validation', () => {
  it('factory defaults are the owner-chosen values and validate', () => {
    expect(FACTORY_VALUATION_DEFAULTS.dcf).toMatchObject({ growthMode: 'fixed', fixedGrowth: 10, discountMode: 'fixed', fixedDiscount: 10, terminal: 2, erp: 5, growthCapMin: -10, growthCapMax: 25 });
    expect(FACTORY_VALUATION_DEFAULTS.graham).toMatchObject({ requiredMos: 20, growthMode: 'model', basePe: 8.5, growthMultiplier: 2, baseYield: 4.4, aaaOverride: null });
    expect(FACTORY_VALUATION_DEFAULTS.peg).toEqual({ fairFrom: 1, richAbove: 2 });
    expect(valuationDefaultsSchema.safeParse(FACTORY_VALUATION_DEFAULTS).success).toBe(true);
    // slider ranges include the factory defaults
    const r = FACTORY_VALUATION_DEFAULTS.dcf.ranges;
    expect(10).toBeGreaterThanOrEqual(r.growth[0]); expect(10).toBeLessThanOrEqual(r.growth[1]);
    expect(10).toBeGreaterThanOrEqual(r.discount[0]); expect(10).toBeLessThanOrEqual(r.discount[1]);
    expect(2).toBeGreaterThanOrEqual(r.terminal[0]); expect(2).toBeLessThanOrEqual(r.terminal[1]);
  });

  it.each([
    ['ERP above 12%', (d: ValuationDefaults) => { d.dcf.erp = 20; }],
    ['negative required margin', (d: ValuationDefaults) => { d.graham.requiredMos = -1; }],
    ['required margin above 90%', (d: ValuationDefaults) => { d.graham.requiredMos = 95; }],
    ['fixed discount ≤ terminal growth', (d: ValuationDefaults) => { d.dcf.fixedDiscount = 4; d.dcf.terminal = 4; }],
    ['slider range min ≥ max', (d: ValuationDefaults) => { d.dcf.ranges.growth = [10, 10]; }],
    ['PEG fair ≥ rich', (d: ValuationDefaults) => { d.peg.fairFrom = 2; d.peg.richAbove = 1.5; }],
    ['growth cap ceiling below 5%', (d: ValuationDefaults) => { d.dcf.growthCapMax = 2; }],
    ['NaN', (d: ValuationDefaults) => { d.dcf.fixedGrowth = Number.NaN; }],
    ['unknown mode', (d: ValuationDefaults) => { (d.dcf as { growthMode: string }).growthMode = 'magic'; }],
    ['unknown key (strict)', (d: ValuationDefaults) => { (d.graham as Record<string, unknown>).extra = 1; }],
  ])('rejects %s', (_n, mutate) => {
    const d = clone();
    mutate(d);
    expect(valuationDefaultsSchema.safeParse(d).success).toBe(false);
  });

  it('accepts the edges of each bound and a fixed discount in CAPM mode below terminal (not used)', () => {
    const d = clone();
    d.dcf.erp = 12; d.dcf.riskFreeOverride = 0; d.graham.requiredMos = 90; d.graham.aaaOverride = 20;
    d.dcf.discountMode = 'capm'; d.dcf.fixedDiscount = 3; d.dcf.terminal = 4;
    expect(valuationDefaultsSchema.safeParse(d).success).toBe(true);
  });

  it('parseValuationDefaults: partial JSON merges onto factory; junk → factory', () => {
    const p = parseValuationDefaults(JSON.stringify({ dcf: { erp: 6 } }));
    expect(p.valid).toBe(true);
    expect(p.defaults.dcf.erp).toBe(6);
    expect(p.defaults.dcf.fixedGrowth).toBe(10);
    expect(p.defaults.graham.requiredMos).toBe(20);
    expect(parseValuationDefaults('{nope').defaults).toEqual(FACTORY_VALUATION_DEFAULTS);
    expect(parseValuationDefaults({ dcf: { erp: 99 } })).toEqual({ defaults: FACTORY_VALUATION_DEFAULTS, valid: false });
  });

  it('preset body: bounded, discount must exceed terminal', () => {
    expect(presetBodySchema.safeParse({ growth: 10, discount: 10, terminal: 2, requiredMos: 20 }).success).toBe(true);
    expect(presetBodySchema.safeParse({ growth: 10, discount: 2, terminal: 2, requiredMos: 20 }).success).toBe(false);
    expect(presetBodySchema.safeParse({ growth: 500, discount: 10, terminal: 2, requiredMos: 20 }).success).toBe(false);
    expect(presetBodySchema.safeParse({ growth: 10, discount: 10, terminal: 2, requiredMos: 120 }).success).toBe(false);
  });
});

describe('pure formulas take constants as params', () => {
  it('Graham constants and PEG thresholds', () => {
    expect(grahamValue(2, 10, 4.4)).toBeCloseTo(2 * 28.5, 9);
    expect(grahamValue(2, 10, 4.4, { basePe: 7, growthMultiplier: 1.5, baseYield: 4.4 })).toBeCloseTo(2 * 22, 9);
    expect(pegBand(1.2)).toBe('fair');
    expect(pegBand(1.2, { fairFrom: 1.5, richAbove: 3 })).toBe('below1');
    expect(pegBandText('rich', { fairFrom: 1.5, richAbove: 3 })).toMatch(/^Above 3/);
  });
});

describe('defaults applied in buildFundamentals', () => {
  it('factory: DCF 10% growth / 10% discount / 2% terminal, Graham g from the model', () => {
    const m = buildFundamentals(input());
    expect(m.valuation).toEqual(FACTORY_VALUATION_DEFAULTS);
    expect(m.dcf.defaults).toEqual({ growth: 10, discount: 10, terminal: 2 });
    expect(m.dcf.params).toEqual(m.dcf.defaults);
    if (!m.dcf.result?.ok) throw new Error('dcf');
    // FCF 220, 242, 266.2 discounted at 10% → 200 each; TV = 266.2 × 1.02 / 0.08; + cash 200 − debt 500; ÷ 100
    const pvTv = (266.2 * 1.02) / 0.08 / 1.331;
    expect(m.dcf.result.sumPvFcf).toBeCloseTo(600, 6);
    expect(m.dcf.result.perShare).toBeCloseTo((600 + pvTv - 300) / 100, 6);
    expect(m.dcf.discountBasis).toMatch(/fixed/);
    // Graham g = historical EPS CAGR 10% → 2 × (8.5 + 20) × 4.4 / 5.5 = 45.6
    expect(m.graham.growthMode).toBe('model');
    expect(m.graham.g).toBeCloseTo(10, 6);
    expect(m.graham.value).toBeCloseTo(45.6, 6);
  });

  it('CAPM mode: changing the ERP changes the default discount rate', () => {
    const d = clone(); d.dcf.discountMode = 'capm';
    expect(buildFundamentals(input(d)).dcf.defaults.discount).toBeCloseTo(4 + 1.2 * 5, 6);
    d.dcf.erp = 6;
    expect(buildFundamentals(input(d)).dcf.defaults.discount).toBeCloseTo(4 + 1.2 * 6, 6);
    d.dcf.riskFreeOverride = 3;
    const m = buildFundamentals(input(d));
    expect(m.dcf.defaults.discount).toBeCloseTo(3 + 1.2 * 6, 6);
    expect(m.riskFree.series).toBe('override');
  });

  it('fixed vs model growth mode, and the growth cap', () => {
    const d = clone(); d.dcf.fixedGrowth = 4;
    expect(buildFundamentals(input(d)).dcf.defaults.growth).toBe(4);
    d.dcf.growthMode = 'model';
    expect(buildFundamentals(input(d)).dcf.defaults.growth).toBeCloseTo(10, 6); // historical EPS CAGR
    d.dcf.growthCapMax = 6;
    const m = buildFundamentals(input(d));
    expect(m.dcf.defaults.growth).toBe(6);
    expect(m.growth.capped).toBe(true);
    expect(m.graham.g).toBe(6); // Graham uses the capped estimate too
  });

  it('Graham constants, fixed g, Aaa override and PEG thresholds', () => {
    const d = clone();
    d.graham = { ...d.graham, basePe: 7, growthMultiplier: 1.5, baseYield: 4.4, aaaOverride: 4.4, growthMode: 'fixed', fixedGrowth: 5 };
    d.peg = { fairFrom: 1.6, richAbove: 3 };
    const m = buildFundamentals(input(d));
    expect(m.graham.g).toBe(5);
    expect(m.graham.y).toBe(4.4);
    expect(m.aaa.series).toBe('override');
    expect(m.graham.value).toBeCloseTo(2 * (7 + 1.5 * 5), 6);
    expect(m.graham.constants).toEqual({ basePe: 7, growthMultiplier: 1.5, baseYield: 4.4 });
    // P/E 15 ÷ growth 10 = 1.5 → below the 1.6 "fair from" threshold
    expect(m.peg.value).toBeCloseTo(1.5, 6);
    expect(m.peg.band).toBe('below1');
    expect(m.peg.thresholds).toEqual({ fairFrom: 1.6, richAbove: 3 });
  });
});
