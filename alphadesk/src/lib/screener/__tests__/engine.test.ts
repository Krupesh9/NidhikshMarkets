import { describe, expect, it } from 'vitest';
import type { ScreenRow } from '@/lib/data/types';
import {
  activeFilterKeys, capFilters, daysUntil, fromSavedScreen, inRange, marketCapBucket, matchesRow, parseFilters,
  parseSort, PRESETS, runScreen, safeParseFilters, screenCacheKey, screenerLimits, sortRows, toSavedScreen,
} from '../engine';

const TODAY = new Date('2026-11-17T12:00:00Z');
function row(p: Partial<ScreenRow> & { ticker: string }): ScreenRow {
  return {
    name: `${p.ticker} Inc`, sector: 'Information Technology', industry: 'Software', country: 'US', marketCap: 50e9, price: 100,
    changePct: 0, pe: 20, evEbitda: 12, revenueGrowth: 5, epsRevision30d: 0, shortInterestPct: 2, insiderBuying90d: 0, esgScore: 60,
    nextEarnings: '2026-12-31', catalystFlags: [], sparkline: [1, 2], whyNow: { headline: 'h', estimateChange: 'e', risk: 'r', sourceIds: [] },
    ...p,
  };
}
const ROWS: ScreenRow[] = [
  row({ ticker: 'AAA', marketCap: 300e9, pe: 35, revenueGrowth: 15, epsRevision30d: 2, sector: 'Information Technology', nextEarnings: '2026-11-20', catalystFlags: ['earnings'] }),
  row({ ticker: 'BBB', marketCap: 5e9, pe: 12, revenueGrowth: 22, shortInterestPct: 9, sector: 'Health Care', industry: 'Biotechnology', catalystFlags: ['fda'], insiderBuying90d: 1_200_000 }),
  row({ ticker: 'CCC', marketCap: 800e6, pe: 8, revenueGrowth: -3, country: 'CA', sector: 'Energy', industry: 'Oil & Gas', insiderBuying90d: -50_000, nextEarnings: '2026-12-01' }),
  row({ ticker: 'DDD', marketCap: 150e9, pe: 25, revenueGrowth: 15, epsRevision30d: -1.5, catalystFlags: ['investor_day'], nextEarnings: '2026-11-10' }),
  row({ ticker: 'EEE', marketCap: 100e6, pe: NaN, revenueGrowth: 40, esgScore: 30, name: 'Echo Robotics', nextEarnings: '' }),
];
const tickers = (rs: ScreenRow[]) => rs.map((r) => r.ticker);

describe('ranges', () => {
  it('inRange handles min/max/inclusive bounds and missing values', () => {
    expect(inRange(10, { min: 10, max: 20 })).toBe(true);
    expect(inRange(20, { max: 20 })).toBe(true);
    expect(inRange(21, { max: 20 })).toBe(false);
    expect(inRange(NaN, { min: 0 })).toBe(false);
    expect(inRange(5, undefined)).toBe(true);
  });
  it('filters P/E range and excludes rows with missing P/E', () => {
    expect(tickers(runScreen(ROWS, { pe: { min: 10, max: 30 } }, [{ id: 'ticker', desc: false }]).rows)).toEqual(['BBB', 'DDD']);
  });
  it('buckets market cap', () => {
    expect(marketCapBucket(300e9)).toBe('mega');
    expect(marketCapBucket(150e9)).toBe('large');
    expect(marketCapBucket(5e9)).toBe('mid');
    expect(marketCapBucket(800e6)).toBe('small');
    expect(marketCapBucket(100e6)).toBe('micro');
    expect(tickers(runScreen(ROWS, { marketCap: ['small', 'micro'] }, [{ id: 'ticker', desc: false }]).rows)).toEqual(['CCC', 'EEE']);
  });
  it('combines several numeric ranges (AND)', () => {
    const r = runScreen(ROWS, { revenueGrowth: { min: 10 }, shortInterestPct: { min: 5 } });
    expect(tickers(r.rows)).toEqual(['BBB']);
  });
});

describe('multi-select, booleans, text', () => {
  it('sector / industry / country are OR within, AND across, case-insensitive', () => {
    expect(tickers(runScreen(ROWS, { sector: ['health care', 'Energy'] }, [{ id: 'ticker', desc: false }]).rows)).toEqual(['BBB', 'CCC']);
    expect(tickers(runScreen(ROWS, { sector: ['Health Care', 'Energy'], country: ['CA'] }).rows)).toEqual(['CCC']);
    expect(tickers(runScreen(ROWS, { industry: ['Biotechnology'] }).rows)).toEqual(['BBB']);
  });
  it('insider buying true/false', () => {
    expect(tickers(runScreen(ROWS, { insiderBuying: true }).rows)).toEqual(['BBB']);
    expect(tickers(runScreen(ROWS, { insiderBuying: false }).rows)).toEqual(['CCC']);
  });
  it('text search matches ticker and name', () => {
    expect(tickers(runScreen(ROWS, { q: 'robot' }).rows)).toEqual(['EEE']);
    expect(tickers(runScreen(ROWS, { q: 'ccc' }).rows)).toEqual(['CCC']);
  });
});

describe('catalysts', () => {
  it('daysUntil counts whole UTC days', () => {
    expect(daysUntil('2026-11-20', TODAY)).toBe(3);
    expect(daysUntil('2026-11-17', TODAY)).toBe(0);
    expect(Number.isNaN(daysUntil('', TODAY))).toBe(true);
  });
  it('earnings within N days excludes past and blank dates', () => {
    const r = runScreen(ROWS, { earningsWithinDays: 14 }, [{ id: 'ticker', desc: false }], { today: TODAY });
    expect(tickers(r.rows)).toEqual(['AAA', 'CCC']);
    expect(tickers(runScreen(ROWS, { earningsWithinDays: 3 }, undefined, { today: TODAY }).rows)).toEqual(['AAA']);
  });
  it('catalyst flags match ANY selected', () => {
    expect(tickers(runScreen(ROWS, { catalysts: ['fda', 'investor_day'] }, [{ id: 'ticker', desc: false }]).rows)).toEqual(['BBB', 'DDD']);
  });
});

describe('sorting', () => {
  it('multi-key sort with tiebreak', () => {
    const s = sortRows(ROWS, [{ id: 'revenueGrowth', desc: true }, { id: 'pe', desc: false }]);
    expect(tickers(s)).toEqual(['EEE', 'BBB', 'DDD', 'AAA', 'CCC']);
  });
  it('missing values sort last in both directions', () => {
    expect(tickers(sortRows(ROWS, [{ id: 'pe', desc: false }])).at(-1)).toBe('EEE');
    expect(tickers(sortRows(ROWS, [{ id: 'pe', desc: true }])).at(-1)).toBe('EEE');
  });
  it('parseSort falls back to default on junk', () => {
    expect(parseSort([{ id: 'nope', desc: true }])).toEqual([{ id: 'marketCap', desc: true }]);
  });
});

describe('FREE-tier caps', () => {
  const free = screenerLimits('FREE');
  it('FREE allows 3 filters and 25 rows; PRO is uncapped on filters', () => {
    expect(free).toEqual({ maxFilters: 3, maxRows: 25 });
    expect(screenerLimits('PRO').maxFilters).toBe(Infinity);
    expect(screenerLimits(undefined)).toEqual(free);
  });
  it('drops filters beyond the cap in insertion order', () => {
    const f = { revenueGrowth: { min: 0 }, pe: { max: 100 }, sector: ['Energy'], q: 'zzz' };
    const { applied, dropped } = capFilters(f, 3);
    expect(Object.keys(applied)).toEqual(['revenueGrowth', 'pe', 'sector']);
    expect(dropped).toEqual(['q']);
    const r = runScreen(ROWS, f, undefined, free);
    expect(r.droppedFilters).toEqual(['q']);
    expect(tickers(r.rows)).toEqual([]); // CCC has negative growth so fails revenueGrowth ≥ 0
  });
  it('caps rows and reports rowCapped', () => {
    const many = Array.from({ length: 60 }, (_, i) => row({ ticker: `T${String(i).padStart(2, '0')}`, marketCap: 1e9 + i }));
    const r = runScreen(many, {}, undefined, free);
    expect(r.rows).toHaveLength(25);
    expect(r.matched).toBe(60);
    expect(r.rowCapped).toBe(true);
    expect(runScreen(many, {}, undefined, { ...free, limit: 10 }).rowCapped).toBe(false);
  });
  it('empty values do not count as filters', () => {
    expect(activeFilterKeys({ q: '  ', sector: [], pe: { min: null, max: null }, esgScore: { min: 50 } })).toEqual(['esgScore']);
  });
});

describe('schema + serialisation', () => {
  it('safeParseFilters preserves caller key order and rejects bad input', () => {
    const r = safeParseFilters({ shortInterestPct: { min: 3 }, pe: { max: 20 } });
    expect(r.ok && Object.keys(r.filters)).toEqual(['shortInterestPct', 'pe']);
    expect(safeParseFilters({ marketCap: ['giant'] }).ok).toBe(false);
    expect(parseFilters('garbage')).toEqual({});
  });
  it('round-trips through SavedScreen shape', () => {
    const saved = toSavedScreen('  My screen ', { filters: { pe: { max: 20 }, q: '' }, columns: ['ticker', 'pe'], sort: [{ id: 'pe', desc: false }] });
    expect(saved.name).toBe('My screen');
    expect(saved.filters).toEqual({ pe: { max: 20 } });
    const back = fromSavedScreen(JSON.parse(JSON.stringify(saved)));
    expect(back).toEqual({ filters: { pe: { max: 20 } }, columns: ['ticker', 'pe'], sort: [{ id: 'pe', desc: false }], tickers: null, groups: {} });
  });
  it('migrates legacy seeded filter shapes', () => {
    const r = safeParseFilters({ insiderBuying90d: { min: 0 }, catalystFlags: { any: ['earnings', 'fda', 'bogus'] } });
    expect(r.ok && r.filters).toEqual({ insiderBuying: true, catalysts: ['earnings', 'fda'] });
  });
  it('cache key is independent of filter key order', () => {
    expect(screenCacheKey({ pe: { max: 1 }, q: 'a' }, [], 0)).toBe(screenCacheKey({ q: 'a', pe: { max: 1 } }, [], 0));
  });
  it('all presets are valid filter states', () => {
    for (const p of PRESETS) expect(safeParseFilters(p.filters).ok).toBe(true);
  });
  it('matchesRow with no filters passes everything', () => {
    expect(ROWS.every((r) => matchesRow(r, {}))).toBe(true);
  });
});
