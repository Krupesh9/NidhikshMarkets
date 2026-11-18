import { describe, expect, it } from 'vitest';
import type { FinancialStatementRow, InsiderTxn } from '@/lib/data/types';
import {
  addTickers, defaultList, isValidTicker, MAX_LIST, removeTicker, sameGroups, sameList, sanitizeGroups, sanitizeTickers, SP100, SP500_TOP25, splitTickerInput,
} from '../list';
import { fromSavedScreen, LIST_KEY, matchesRow, runScreen, sortRows, toSavedScreen } from '../engine';
import { buildWhyNow, FUND_SECTOR, mapFmpSector, netInsiderDollars, revenueGrowthFrom, UNKNOWN_SECTOR } from '../derive';
import type { LiveScreenRow } from '../types';

describe('ticker list editing', () => {
  it('validates tickers', () => {
    expect(isValidTicker('BRK.B')).toBe(true);
    expect(isValidTicker('BF-B')).toBe(true);
    expect(isValidTicker('1ABC')).toBe(false);
    expect(isValidTicker('TOOLONGTICKER')).toBe(false);
    expect(isValidTicker('')).toBe(false);
  });
  it('splits pasted input on commas, spaces, newlines and upper-cases it', () => {
    expect(splitTickerInput(' pltr, amd\nnvda;tsla  brk/b ')).toEqual(['PLTR', 'AMD', 'NVDA', 'TSLA', 'BRK.B']);
  });
  it('adds, de-duplicates and reports invalid entries', () => {
    const r = addTickers(['AAPL'], 'msft, aapl, 9bad, MSFT nvda');
    expect(r.list).toEqual(['AAPL', 'MSFT', 'NVDA']);
    expect(r.added).toEqual(['MSFT', 'NVDA']);
    expect(r.duplicates).toEqual(['AAPL', 'MSFT']);
    expect(r.invalid).toEqual(['9BAD']);
  });
  it('caps the list at 100', () => {
    const big = Array.from({ length: MAX_LIST - 1 }, (_, i) => `T${i}`);
    const r = addTickers(big, 'AAA BBB CCC');
    expect(r.list).toHaveLength(MAX_LIST);
    expect(r.added).toEqual(['AAA']);
    expect(r.overCap).toEqual(['BBB', 'CCC']);
    expect(sanitizeTickers([...big, 'X1', 'X2', 'X3'])).toHaveLength(MAX_LIST);
  });
  it('removes a ticker (case-insensitive) and keeps order', () => {
    expect(removeTicker(['AAPL', 'NVDA', 'MSFT'], 'nvda')).toEqual(['AAPL', 'MSFT']);
    expect(removeTicker(['AAPL'], 'ZZZ')).toEqual(['AAPL']);
  });
  it('sanitises groups to listed tickers', () => {
    expect(sanitizeGroups({ aapl: ' Technology ', SPY: 'Index Fund', ZZZ: 'x', MSFT: '', NVDA: 3 }, ['AAPL', 'SPY', 'MSFT', 'NVDA'])).toEqual({ AAPL: 'Technology', SPY: 'Index Fund' });
    expect(sanitizeGroups(null)).toEqual({});
    expect(sameGroups({ A: 'x' }, { A: 'x' })).toBe(true);
    expect(sameGroups({ A: 'x' }, { A: 'y' })).toBe(false);
  });
  it('default list = watchlist when it has ≥ 10 names, else watchlist + the S&P 100', () => {
    const wl = ['AAPL', 'AMZN', 'AVGO', 'META', 'MSFT', 'GOOGL', 'NVDA', 'MU', 'TSLA', 'JPM', 'VOO'];
    expect(defaultList(wl)).toEqual(wl);
    const short = defaultList(['PLTR', 'NVDA']);
    expect(short.slice(0, 2)).toEqual(['PLTR', 'NVDA']);
    expect(short.filter((t) => t === 'NVDA')).toHaveLength(1);
    // PLTR and NVDA are both S&P 100 members, so nothing is added twice
    expect(short).toHaveLength(SP100.length);
    expect(defaultList([])).toEqual([...SP100]);
    expect(sameList(short, [...short])).toBe(true);
  });
});

describe('saved screen definitions with lists', () => {
  it('round-trips tickers + groups through the filters JSON', () => {
    const saved = toSavedScreen('My stocks', { filters: { pe: { max: 30 } }, columns: ['ticker'], sort: [{ id: 'group', desc: false }], tickers: ['aapl', 'SPY', 'AAPL'], groups: { AAPL: 'Technology', SPY: 'Index Fund', NOPE: 'x' } });
    expect(saved.filters[LIST_KEY]).toEqual({ tickers: ['AAPL', 'SPY'], groups: { AAPL: 'Technology', SPY: 'Index Fund' } });
    const back = fromSavedScreen(JSON.parse(JSON.stringify(saved)));
    expect(back.tickers).toEqual(['AAPL', 'SPY']);
    expect(back.groups).toEqual({ AAPL: 'Technology', SPY: 'Index Fund' });
    expect(back.filters).toEqual({ pe: { max: 30 } });
    expect(back.sort).toEqual([{ id: 'group', desc: false }]);
  });
  it('old definitions without tickers load as the default list', () => {
    const back = fromSavedScreen({ filters: { revenueGrowth: { min: 10 } }, columns: [], sort: [] });
    expect(back.tickers).toBeNull();
    expect(back.groups).toEqual({});
    expect(back.filters).toEqual({ revenueGrowth: { min: 10 } });
  });
  it('omits the list key when no list is given and tolerates junk', () => {
    expect(LIST_KEY in toSavedScreen('x', { filters: {}, columns: [], sort: [] }).filters).toBe(false);
    expect(fromSavedScreen({ filters: { [LIST_KEY]: { tickers: 'AAPL' } } }).tickers).toBeNull();
    expect(fromSavedScreen({ filters: { [LIST_KEY]: { tickers: ['ok', 42, '!!'] } } }).tickers).toEqual(['OK']);
  });
});

function live(p: Partial<LiveScreenRow> & { ticker: string }): LiveScreenRow {
  return {
    name: p.ticker, sector: 'Information Technology', industry: 'Software', country: 'US', marketCap: 50e9, price: 100, changePct: 0,
    pe: 20, evEbitda: 12, revenueGrowth: 5, epsRevision30d: null, shortInterestPct: null, insiderBuying90d: null, esgScore: null,
    nextEarnings: '', catalystFlags: [], sparkline: [], whyNow: { headline: '', estimateChange: '', risk: '', sourceIds: [] }, group: null,
    ...p,
  };
}

describe('null-safe filtering and sorting', () => {
  const rows = [
    live({ ticker: 'AAA', pe: 15, group: 'Tech' }),
    live({ ticker: 'SPY', pe: null, evEbitda: null, revenueGrowth: null, marketCap: 700e9, sector: FUND_SECTOR, group: 'Index Fund', isEtf: true }),
    live({ ticker: 'BBB', pe: 40, marketCap: null, insiderBuying90d: 2e6, group: 'Tech' }),
    live({ ticker: 'CCC', pe: -5, insiderBuying90d: -1e6 }),
  ];
  it('excludes n/a values from numeric filters', () => {
    expect(runScreen(rows, { pe: { max: 20 } }).rows.map((r) => r.ticker).sort()).toEqual(['AAA', 'CCC']);
    expect(runScreen(rows, { marketCap: ['large', 'mega'] }).rows.map((r) => r.ticker).sort()).toEqual(['AAA', 'CCC', 'SPY']);
    expect(matchesRow(rows[1], { revenueGrowth: { min: -100 } })).toBe(false);
  });
  it('insider filters treat null as no activity', () => {
    expect(runScreen(rows, { insiderBuying: true }).rows.map((r) => r.ticker)).toEqual(['BBB']);
    expect(runScreen(rows, { insiderBuying: false }).rows.map((r) => r.ticker)).toEqual(['CCC']);
  });
  it('filters and searches by group', () => {
    expect(runScreen(rows, { group: ['tech'] }).rows.map((r) => r.ticker).sort()).toEqual(['AAA', 'BBB']);
    expect(runScreen(rows, { q: 'index fund' }).rows.map((r) => r.ticker)).toEqual(['SPY']);
  });
  it('sorts nulls last in both directions', () => {
    expect(sortRows(rows, [{ id: 'pe', desc: true }]).map((r) => r.ticker)).toEqual(['BBB', 'AAA', 'CCC', 'SPY']);
    expect(sortRows(rows, [{ id: 'pe', desc: false }]).map((r) => r.ticker)).toEqual(['CCC', 'AAA', 'BBB', 'SPY']);
    expect(sortRows(rows, [{ id: 'marketCap', desc: false }]).at(-1)?.ticker).toBe('BBB');
    // groups follow the user's own order (first appearance in the list), not the alphabet; ungrouped rows last
    expect(sortRows(rows, [{ id: 'group', desc: false }]).map((r) => r.ticker)).toEqual(['AAA', 'BBB', 'SPY', 'CCC']);
  });
});

const fr = (fiscalYear: number, fiscalPeriod: string, periodEnd: string, revenue: number): FinancialStatementRow => ({
  fiscalYear, fiscalPeriod, periodEnd, revenue, grossProfit: 0, operatingIncome: 0, netIncome: 0, ebitda: 0, eps: 0, totalAssets: 0, totalLiabilities: 0,
  totalEquity: 0, cash: 0, totalDebt: 0, operatingCashFlow: 0, capex: 0, freeCashFlow: 0, sharesOutstanding: 0, grossMargin: 0, operatingMargin: 0, netMargin: 0,
});

describe('revenue growth derivation', () => {
  const annual = [fr(2024, 'FY', '2024-12-31', 100), fr(2025, 'FY', '2025-12-31', 120)];
  const quarters = ['2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'];
  it('uses TTM vs prior TTM with 8 consecutive quarters', () => {
    const q = quarters.map((d, i) => fr(2025, `Q${(i % 4) + 1}`, d, i < 4 ? 25 : 30));
    const g = revenueGrowthFrom(annual, q);
    expect(g.value).toBeCloseTo(20);
    expect(g.basis).toMatch(/TTM/);
  });
  it('falls back to FY vs prior FY when quarters are missing or not consecutive', () => {
    expect(revenueGrowthFrom(annual, []).value).toBeCloseTo(20);
    const gappy = quarters.map((d, i) => fr(2025, 'Q1', i === 3 ? '2025-11-30' : d, 30));
    expect(revenueGrowthFrom(annual, gappy).basis).toBe('FY2025 vs FY2024');
  });
  it('returns null without a clean comparison', () => {
    expect(revenueGrowthFrom([annual[1]], []).value).toBeNull();
    expect(revenueGrowthFrom([fr(2023, 'FY', '2023-12-31', 100), fr(2025, 'FY', '2025-12-31', 130)], []).value).toBeNull();
  });
});

describe('sector mapping', () => {
  it('maps FMP sectors to GICS', () => {
    expect(mapFmpSector('Technology')).toBe('Information Technology');
    expect(mapFmpSector('Consumer Cyclical')).toBe('Consumer Discretionary');
    expect(mapFmpSector('Consumer Defensive')).toBe('Consumer Staples');
    expect(mapFmpSector('Financial Services')).toBe('Financials');
    expect(mapFmpSector('Healthcare')).toBe('Health Care');
    expect(mapFmpSector('Basic Materials')).toBe('Materials');
    expect(mapFmpSector('communication services')).toBe('Communication Services');
  });
  it('labels funds and unknowns', () => {
    expect(mapFmpSector('Financial Services', true)).toBe(FUND_SECTOR);
    expect(mapFmpSector('')).toBe(UNKNOWN_SECTOR);
    expect(mapFmpSector(undefined)).toBe(UNKNOWN_SECTOR);
    expect(mapFmpSector('Conglomerates')).toBe(UNKNOWN_SECTOR);
  });
});

describe('insiders + why now', () => {
  const today = new Date('2026-11-18T12:00:00Z');
  const tx = (date: string, type: InsiderTxn['type'], value: number): InsiderTxn => ({ id: date + type, ticker: 'X', insider: 'A', title: 'CEO', date, type, shares: 1, price: value, value, sharesOwnedAfter: 0 });
  it('nets buys minus sells over 90 days, ignoring options/gifts and old trades', () => {
    expect(netInsiderDollars([tx('2026-11-01', 'Buy', 500_000), tx('2026-10-01', 'Sell', 200_000), tx('2026-10-02', 'Option Exercise', 9e6), tx('2026-06-01', 'Buy', 1e9)], today)).toBe(300_000);
    expect(netInsiderDollars([], today)).toBe(0);
  });
  it('builds a factual headline from real signals', () => {
    const w = buildWhyNow({ ticker: 'X', changePct: 6.2, revenueGrowth: 35, insiderBuying90d: 2e6, nextEarnings: '2026-11-25', earningsInDays: 7, pe: 80, epsRevision30d: null });
    expect(w.headline).toContain('Up 6.2% today');
    expect(w.risk).toMatch(/earnings/);
    expect(buildWhyNow({ ticker: 'SPY', isEtf: true, changePct: 0.2, revenueGrowth: null, insiderBuying90d: null, nextEarnings: '', earningsInDays: NaN, pe: null, epsRevision30d: null }).headline).toMatch(/Index fund/);
  });
});
