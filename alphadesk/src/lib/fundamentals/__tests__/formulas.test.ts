import { describe, expect, it } from 'vitest';
import {
  bookValuePerShare, cagr, capGrowth, capmCostOfEquity, dcf, debtToEquity, grahamNumber, grahamValue, isFinancialCompany,
  marginOfSafety, peg, pegBand, priceToBook, regressionBeta, upsidePct,
} from '../formulas';

describe('Graham', () => {
  it('revised formula V = EPS × (8.5 + 2g) × 4.4 / Y', () => {
    // 5 × (8.5 + 20) × 4.4 / 5.5 = 5 × 28.5 × 0.8 = 114
    expect(grahamValue(5, 10, 5.5)).toBeCloseTo(114, 10);
    // zero growth: 2 × 8.5 × 4.4 / 4.4 = 17
    expect(grahamValue(2, 0, 4.4)).toBeCloseTo(17, 10);
  });
  it('not meaningful for negative/zero EPS, missing or zero yield', () => {
    expect(grahamValue(-1, 10, 5)).toBeNull();
    expect(grahamValue(0, 10, 5)).toBeNull();
    expect(grahamValue(3, 10, 0)).toBeNull();
    expect(grahamValue(null, 10, 5)).toBeNull();
    expect(grahamValue(3, null, 5)).toBeNull();
  });
  it('negative growth that makes the multiplier negative returns null', () => {
    expect(grahamValue(3, -5, 5)).toBeNull(); // 8.5 − 10 < 0
  });
  it('Graham Number √(22.5 × EPS × BVPS)', () => {
    expect(grahamNumber(4, 10)).toBeCloseTo(30, 10); // √900
    expect(grahamNumber(-4, 10)).toBeNull();
    expect(grahamNumber(4, -10)).toBeNull();
  });
  it('margin of safety and upside', () => {
    expect(marginOfSafety(100, 80)).toBeCloseTo(20, 10);
    expect(marginOfSafety(100, 125)).toBeCloseTo(-25, 10);
    expect(marginOfSafety(null, 80)).toBeNull();
    expect(upsidePct(100, 80)).toBeCloseTo(25, 10);
    expect(upsidePct(100, 0)).toBeNull();
  });
});

describe('growth helpers', () => {
  it('cagr', () => {
    expect(cagr(100, 121, 2)).toBeCloseTo(10, 10);
    expect(cagr(-1, 2, 2)).toBeNull();
    expect(cagr(1, 2, 0)).toBeNull();
  });
  it('capGrowth clamps to −10…+25', () => {
    expect(capGrowth(40)).toEqual({ value: 25, capped: true });
    expect(capGrowth(-30)).toEqual({ value: -10, capped: true });
    expect(capGrowth(8)).toEqual({ value: 8, capped: false });
  });
});

describe('CAPM + beta', () => {
  it('rf + β × ERP', () => {
    expect(capmCostOfEquity(4, 1.2, 5)).toBeCloseTo(10, 10);
  });
  it('regression beta recovers a 2x levered series', () => {
    const m = [100];
    const a = [100];
    for (let i = 1; i < 80; i++) {
      const r = Math.sin(i) * 0.02;
      m.push(m[i - 1] * (1 + r));
      a.push(a[i - 1] * (1 + 2 * r));
    }
    expect(regressionBeta(a, m)).toBeCloseTo(2, 6);
    expect(regressionBeta(a.slice(0, 10), m.slice(0, 10))).toBeNull(); // too few observations
  });
});

describe('DCF (3-year)', () => {
  const inputs = { baseFcf: 100, cash: 50, totalDebt: 150, shares: 10, price: 100 };
  it('hand-computed example: g 10%, r 10%, gT 2%', () => {
    const r = dcf(inputs, { growth: 10, discount: 10, terminal: 2 });
    if (!r.ok) throw new Error(r.reason);
    // FCF 110, 121, 133.1; PV = 100 each (g = r)
    expect(r.years.map((y) => y.fcf)).toEqual([expect.closeTo(110, 9), expect.closeTo(121, 9), expect.closeTo(133.1, 9)]);
    expect(r.years.every((y) => Math.abs(y.pv - 100) < 1e-9)).toBe(true);
    expect(r.sumPvFcf).toBeCloseTo(300, 9);
    // TV = 133.1 × 1.02 / 0.08 = 1697.025; PV = 1697.025 / 1.331 = 1275
    expect(r.terminalValue).toBeCloseTo(1697.025, 9);
    expect(r.pvTerminal).toBeCloseTo(1275, 9);
    expect(r.netCash).toBe(-100);
    expect(r.equityValue).toBeCloseTo(1475, 9);
    expect(r.perShare).toBeCloseTo(147.5, 9);
    expect(r.upsidePct).toBeCloseTo(47.5, 9);
    expect(r.terminalSharePct).toBeCloseTo((1275 / 1575) * 100, 9);
  });
  it('zero growth, r 8%, gT 0%', () => {
    const r = dcf({ ...inputs, cash: 0, totalDebt: 0 }, { growth: 0, discount: 8, terminal: 0 });
    if (!r.ok) throw new Error(r.reason);
    // perpetuity of 100 at 8% = 1250 regardless of the split → 125/share
    expect(r.equityValue).toBeCloseTo(1250, 9);
    expect(r.perShare).toBeCloseTo(125, 9);
  });
  it('rejects r ≤ gT, negative FCF and missing shares', () => {
    expect(dcf(inputs, { growth: 5, discount: 3, terminal: 3 }).ok).toBe(false);
    expect(dcf(inputs, { growth: 5, discount: 2, terminal: 3 }).ok).toBe(false);
    expect(dcf({ ...inputs, baseFcf: -5 }, { growth: 5, discount: 9, terminal: 2 }).ok).toBe(false);
    expect(dcf({ ...inputs, baseFcf: 0 }, { growth: 5, discount: 9, terminal: 2 }).ok).toBe(false);
    expect(dcf({ ...inputs, shares: 0 }, { growth: 5, discount: 9, terminal: 2 }).ok).toBe(false);
  });
});

describe('ratios', () => {
  it('PEG', () => {
    expect(peg(30, 15)).toBeCloseTo(2, 10);
    expect(peg(-10, 15)).toBeNull();
    expect(peg(20, 0)).toBeNull();
    expect(peg(20, -5)).toBeNull();
    expect(pegBand(0.8)).toBe('below1');
    expect(pegBand(1.5)).toBe('fair');
    expect(pegBand(2)).toBe('fair');
    expect(pegBand(2.4)).toBe('rich');
  });
  it('P/B', () => {
    expect(bookValuePerShare(1000, 100)).toBe(10);
    expect(bookValuePerShare(1000, 0)).toBeNull();
    expect(priceToBook(25, 10)).toBe(2.5);
    expect(priceToBook(25, -3)).toBeNull(); // negative book
  });
  it('D/E incl. negative equity', () => {
    expect(debtToEquity(50, 100)).toEqual({ kind: 'ratio', value: 0.5 });
    expect(debtToEquity(50, -10)).toEqual({ kind: 'negative-equity' });
    expect(debtToEquity(50, 0)).toEqual({ kind: 'negative-equity' });
    expect(debtToEquity(null, 100)).toEqual({ kind: 'missing' });
  });
});

describe('financial-company detection', () => {
  it('matches banks, insurers, brokers by industry / SIC description', () => {
    expect(isFinancialCompany({ industries: ['Banks - Diversified'] })).toBe(true);
    expect(isFinancialCompany({ industries: [null, 'NATIONAL COMMERCIAL BANKS'] })).toBe(true);
    expect(isFinancialCompany({ industries: ['Insurance - Property & Casualty'] })).toBe(true);
    expect(isFinancialCompany({ industries: ['SECURITY BROKERS, DEALERS & FLOTATION COMPANIES'] })).toBe(true);
    expect(isFinancialCompany({ industries: ['Financial - Capital Markets'] })).toBe(true);
  });
  it('does not flag payment networks, data vendors, car dealers or tech', () => {
    expect(isFinancialCompany({ sector: 'Financial Services', industries: ['Financial - Credit Services'] })).toBe(false);
    expect(isFinancialCompany({ sector: 'Financials', industries: ['Transaction & Payment Processing'] })).toBe(false);
    expect(isFinancialCompany({ industries: ['RETAIL-AUTO DEALERS & GASOLINE STATIONS'] })).toBe(false);
    expect(isFinancialCompany({ industries: ['ELECTRONIC COMPUTERS'] })).toBe(false);
  });
  it('falls back to sector when no industry is known', () => {
    expect(isFinancialCompany({ sector: 'Financials', industries: [] })).toBe(true);
    expect(isFinancialCompany({ sector: 'Information Technology' })).toBe(false);
  });
});
