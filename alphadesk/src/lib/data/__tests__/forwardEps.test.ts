import { describe, expect, it } from 'vitest';
import { mapAlphaVantage } from '../alphavantage';
import { deriveForward } from '@/components/company/lib/helpers';

const row = (date: string, horizon: string, eps: string, extra: Record<string, string | null> = {}) => ({
  date, horizon, eps_estimate_average: eps, eps_estimate_high: null, eps_estimate_low: null, eps_estimate_analyst_count: '40.0000',
  revenue_estimate_average: '1000000000.00', ...extra,
});
const EST = {
  symbol: 'NVDA',
  estimates: [
    row('2028-01-31', 'fiscal year', '15.8537', { eps_estimate_analyst_count: '51.0000', eps_estimate_average_30_days_ago: '15.0000', eps_estimate_average_90_days_ago: '12.8206' }),
    row('2027-01-31', 'fiscal year', '9.3270'),
    row('2026-01-31', 'fiscal year', '4.5000'), // already reported → dropped
    row('2027-01-31', 'fiscal quarter', '2.7583'),
    row('2026-10-31', 'fiscal quarter', '2.4712'), // past → dropped
  ],
};
const NOW = new Date('2026-11-17T12:00:00Z');

describe('Alpha Vantage consensus mapping', () => {
  it('forward EPS = explicit next-fiscal-year estimate (the FY after the one in progress)', () => {
    const e = mapAlphaVantage('nvda', null, EST, NOW)!;
    expect(e.ticker).toBe('NVDA');
    expect(e.forwardEps).toBeCloseTo(15.8537, 4);
    expect(e.forwardBasis).toContain('FY2028');
    expect(e.forwardBasis).toContain('51 analysts');
    expect(e.forwardPe).toBeUndefined(); // OVERVIEW is premium on the free key
  });

  it('keeps future periods only, labels FY by end year and quarters within their fiscal year', () => {
    const e = mapAlphaVantage('NVDA', null, EST, NOW)!;
    const eps = e.periods.filter((p) => p.metric === 'eps').map((p) => p.period);
    expect(eps).toEqual(['FY2027', 'FY2028', 'Q4 FY2027']);
    const fy28 = e.periods.find((p) => p.period === 'FY2028' && p.metric === 'eps')!;
    expect(fy28.numAnalysts).toBe(51);
    expect(fy28.high).toBeCloseTo(15.8537, 4); // missing high/low default to consensus
    expect(fy28.revisions.at(-1)).toEqual({ date: '2026-11-17', value: 15.8537 });
    expect(fy28.change30dPct).toBeCloseTo(5.69, 2);
    expect(fy28.change90dPct).toBeCloseTo(23.66, 2);
  });

  it('falls back to the only future fiscal year when no later one exists', () => {
    const e = mapAlphaVantage('X', null, { estimates: [row('2026-12-31', 'fiscal year', '8.0844')] }, NOW)!;
    expect(e.forwardEps).toBeCloseTo(8.0844, 4);
  });

  it('maps premium OVERVIEW fields (ratings, target, ForwardPE) when present', () => {
    const e = mapAlphaVantage('X', { ForwardPE: '25.5', AnalystTargetPrice: '200', AnalystRatingStrongBuy: '10', AnalystRatingBuy: '5', AnalystRatingHold: '3', AnalystRatingSell: '1', AnalystRatingStrongSell: 'None', EPS: '4.1' }, null, NOW)!;
    expect(e.rating).toEqual({ buy: 15, hold: 3, sell: 1 });
    expect(e.priceTarget.mean).toBe(200);
    expect(e.forwardPe).toBe(25.5);
    expect(e.forwardEps).toBeUndefined();
    expect(e.trailingEps).toBe(4.1);
  });

  it('returns null when AV has nothing usable', () => {
    expect(mapAlphaVantage('X', null, null, NOW)).toBeNull();
    expect(mapAlphaVantage('X', {}, { estimates: [] }, NOW)).toBeNull();
  });
});

describe('deriveForward', () => {
  it('uses the explicit estimate: P/E = live price ÷ forward EPS', () => {
    const f = deriveForward({ price: 158.3, forwardEps: 15.85, forwardPe: 30, label: 'Alpha Vantage consensus, as of 2026-11-17' });
    expect(f.eps).toBe(15.85);
    expect(f.pe).toBeCloseTo(9.99, 2);
    expect(f.peBasis).toContain('Alpha Vantage consensus, as of 2026-11-17');
  });

  it('falls back to price ÷ reported forward P/E when there is no explicit estimate', () => {
    const f = deriveForward({ price: 100, forwardPe: 25 });
    expect(f.eps).toBe(4);
    expect(f.pe).toBe(25);
  });

  it('negative forward EPS → P/E not meaningful; nothing → nulls', () => {
    expect(deriveForward({ price: 10, forwardEps: -1 }).pe).toBeNull();
    const none = deriveForward({ price: 10 });
    expect([none.eps, none.pe]).toEqual([null, null]);
  });
});
