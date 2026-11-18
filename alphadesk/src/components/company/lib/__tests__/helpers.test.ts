import { describe, expect, it } from 'vitest';
import type { Bar, Filing, FinancialStatementRow, InsiderTxn, NewsItem } from '@/lib/data/types';
import {
  deriveValuation, downsampleBars, filingsToEvents, insidersToEvents, matchFilingForPeriod, mergeEvents, monogram, newsToEvents,
  pctChange, periodLabel, periodSource, pickNextEstimates, ppChange, rangePosition, revisionChange, revisionCounts, snapEventsToBars,
  sumLast, upcomingCatalysts, yoyGrowth, yoyLag, type ChartEvent,
} from '../helpers';

const filing = (p: Partial<Filing>): Filing => ({ id: 'f', ticker: 'AAPL', form: '10-K', title: 'Annual report', filedAt: '2024-11-01', url: 'https://sec.gov/x', ...p });
const row = (p: Partial<FinancialStatementRow>): FinancialStatementRow => ({
  fiscalYear: 2024, fiscalPeriod: 'FY', periodEnd: '2024-09-28', revenue: 100, grossProfit: 40, operatingIncome: 30, netIncome: 20, ebitda: 35, eps: 2,
  totalAssets: 500, totalLiabilities: 300, totalEquity: 200, cash: 50, totalDebt: 100, operatingCashFlow: 25, capex: 5, freeCashFlow: 20,
  sharesOutstanding: 10, grossMargin: 40, operatingMargin: 30, netMargin: 20, ...p,
});
const ev = (id: string, date: string, kind: ChartEvent['kind'] = 'news'): ChartEvent => ({ id, date, kind, title: id, source: { id, name: id, kind: 'news' } });

describe('growth', () => {
  it('pctChange handles zero / missing', () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(-50, -100)).toBeCloseTo(50);
    expect(pctChange(1, 0)).toBeNull();
    expect(pctChange(null, 5)).toBeNull();
  });
  it('yoyGrowth respects lag', () => {
    expect(yoyGrowth([100, 110, 121], 1).map((v) => v && Math.round(v))).toEqual([null, 10, 10]);
    const q = yoyGrowth([10, 11, 12, 13, 20], 4);
    expect(q.slice(0, 4)).toEqual([null, null, null, null]);
    expect(q[4]).toBeCloseTo(100);
    expect(yoyLag('annual')).toBe(1);
    expect(yoyLag('quarterly')).toBe(4);
  });
  it('ppChange gives percentage-point deltas', () => {
    expect(ppChange([40, 42.5], 1)).toEqual([null, 2.5]);
  });
  it('sumLast needs n rows', () => {
    expect(sumLast([row({ eps: 1 }), row({ eps: 2 })], 'eps', 4)).toBeNull();
    expect(sumLast([row({ eps: 1 }), row({ eps: 2 }), row({ eps: 3 }), row({ eps: 4 }), row({ eps: 5 })], 'eps', 4)).toBe(14);
  });
});

describe('annotations', () => {
  it('maps filings to earnings / 8-K events and ignores other forms', () => {
    const evs = filingsToEvents([filing({ id: 'a', form: '10-Q' }), filing({ id: 'b', form: '8-K' }), filing({ id: 'c', form: 'DEF 14A' })]);
    expect(evs.map((e) => e.kind)).toEqual(['earnings', 'filing']);
    expect(evs[0].source.url).toBe('https://sec.gov/x');
  });
  it('keeps only insider buys', () => {
    const t = (type: InsiderTxn['type']): InsiderTxn => ({ id: type, ticker: 'X', insider: 'A B', title: 'CEO', date: '2025-01-02', type, shares: 100, price: 10, value: 1000, sharesOwnedAfter: 500 });
    expect(insidersToEvents([t('Buy'), t('Sell'), t('Option Exercise')]).map((e) => e.id)).toEqual(['evt:Buy']);
  });
  it('picks major news, one per day, capped', () => {
    const n = (id: string, at: string, s?: NewsItem['sentiment']): NewsItem => ({ id, tickers: [], title: id, publisher: 'P', url: 'u', publishedAt: at, sentiment: s });
    const evs = newsToEvents([
      n('1', '2025-01-01T10:00:00Z', 'positive'), n('2', '2025-01-01T12:00:00Z', 'negative'), n('3', '2025-01-02T00:00:00Z', 'neutral'),
      n('4', '2025-01-03T00:00:00Z', 'negative'), n('5', '2025-01-04T00:00:00Z', 'positive'),
    ], 2);
    expect(evs.map((e) => e.id)).toEqual(['evt:5', 'evt:4']);
  });
  it('merge dedupes and sorts', () => {
    const m = mergeEvents([ev('b', '2025-02-01'), ev('a', '2025-01-01')], [ev('a', '2025-01-01'), ev('c', '2025-01-01', 'earnings')]);
    expect(m.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
  it('snaps weekend events to the next session and drops out-of-range', () => {
    const dates = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07'];
    const m = snapEventsToBars([ev('sat', '2025-01-04'), ev('fri', '2025-01-03'), ev('old', '2024-12-01'), ev('future', '2025-02-01'), ev('first', '2025-01-02'), ev('today', '2025-01-08')], dates);
    expect(m.get('2025-01-07')?.map((e) => e.id)).toEqual(['today']);
    expect(m.get('2025-01-06')?.map((e) => e.id)).toEqual(['sat']);
    expect(m.get('2025-01-03')?.map((e) => e.id)).toEqual(['fri']);
    expect(m.get('2025-01-02')?.map((e) => e.id)).toEqual(['first']);
    expect([...m.values()].flat().length).toBe(4);
  });
  it('downsamples into OHLCV buckets', () => {
    const bars: Bar[] = Array.from({ length: 10 }, (_, i) => ({ date: `2025-01-${String(i + 1).padStart(2, '0')}`, open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 10 }));
    const d = downsampleBars(bars, 5);
    expect(d).toHaveLength(5);
    expect(d[0]).toEqual({ date: '2025-01-02', open: 0, high: 2, low: -1, close: 1.5, volume: 20 });
    expect(downsampleBars(bars, 50)).toBe(bars);
  });
});

describe('statement sources', () => {
  it('matches filings by period of report, then by filing date', () => {
    const fs = [filing({ id: 'k', form: '10-K', periodOfReport: '2024-09-28' }), filing({ id: 'q', form: '10-Q', filedAt: '2024-08-02' })];
    expect(matchFilingForPeriod({ fiscalPeriod: 'FY', periodEnd: '2024-09-30' }, fs)?.id).toBe('k');
    expect(matchFilingForPeriod({ fiscalPeriod: 'Q3', periodEnd: '2024-06-29' }, fs)?.id).toBe('q');
    expect(matchFilingForPeriod({ fiscalPeriod: 'Q3', periodEnd: '2023-06-29' }, fs)).toBeNull();
  });
  it('falls back to an EDGAR index link, mock-labelled when simulated', () => {
    const s = periodSource(row({ fiscalYear: 1999, periodEnd: '1999-12-31' }), [], 'AAPL', { isMock: true });
    expect(s.kind).toBe('mock');
    expect(s.url).toContain('dateb=2000');
    expect(periodLabel(row({ fiscalPeriod: 'Q2', fiscalYear: 2025 }))).toBe("Q2 '25");
  });
});

describe('valuation', () => {
  it('uses TTM EPS from quarters and computes EV/EBITDA', () => {
    const q = [1, 2, 3, 4].map((i) => row({ fiscalPeriod: `Q${i}`, eps: 1, ebitda: 25, cash: 50, totalDebt: 150 }));
    const v = deriveValuation({ price: 40, marketCap: 1000, annual: [row({})], quarterly: q });
    expect(v.pe).toBeCloseTo(10);
    expect(v.ev).toBe(1100);
    expect(v.evEbitda).toBeCloseTo(11);
  });
  it('falls back to provider multiples when earnings are negative', () => {
    const v = deriveValuation({ price: 40, marketCap: 1000, annual: [row({ eps: -1, ebitda: -5 })], quarterly: [], fallbackPe: 22, fallbackEvEbitda: 0 });
    expect(v.pe).toBe(22);
    expect(v.evEbitda).toBeNull();
  });
});

describe('estimates', () => {
  const revs = [
    { date: '2025-01-01', value: 10 }, { date: '2025-02-01', value: 10.5 }, { date: '2025-03-01', value: 10.2 }, { date: '2025-04-01', value: 11 },
  ];
  it('revisionChange looks back from the latest date', () => {
    expect(revisionChange(revs, 30)).toBeCloseTo(((11 - 10.2) / 10.2) * 100);
    expect(revisionChange(revs, 365)).toBeCloseTo(10);
  });
  it('counts up/down moves in window', () => {
    expect(revisionCounts(revs, 90)).toEqual({ up: 2, down: 1, flat: 0 });
    expect(revisionCounts(revs, 30)).toEqual({ up: 1, down: 0, flat: 0 });
  });
  it('picks next FY and next quarter', () => {
    const p = (period: string, metric: 'eps' | 'revenue') => ({ period, metric, consensus: 1, high: 1, low: 1, numAnalysts: 1, revisions: [], change30dPct: 0, change90dPct: 0 });
    const r = pickNextEstimates([p('FY2027', 'eps'), p('FY2026', 'eps'), p('FY2025', 'eps'), p('FY2026', 'revenue')], 'eps', new Date('2026-05-01'));
    expect(r.fy?.period).toBe('FY2026');
    expect(r.q).toBeNull();
    expect(pickNextEstimates([p('Q1 FY2027', 'eps')], 'eps').q?.period).toBe('Q1 FY2027');
  });
});

describe('misc', () => {
  it('rangePosition clamps', () => {
    expect(rangePosition(150, 100, 200)).toBe(50);
    expect(rangePosition(250, 100, 200)).toBe(100);
    expect(rangePosition(5, 10, 10)).toBe(50);
  });
  it('monogram skips suffixes', () => {
    expect(monogram('Apple Inc.', 'AAPL')).toBe('AP');
    expect(monogram('JPMorgan Chase & Co.', 'JPM')).toBe('JC');
    expect(monogram('', 'NVDA')).toBe('NV');
  });
  it('upcomingCatalysts filters past', () => {
    const c = (id: string, date: string) => ({ id, type: 'earnings' as const, title: id, date, confirmed: true });
    expect(upcomingCatalysts([c('b', '2026-12-01'), c('old', '2026-01-01'), c('a', '2026-11-20')], new Date('2026-11-17')).map((x) => x.id)).toEqual(['a', 'b']);
  });
});
