/**
 * Critical path: composite market-data provider fallback order, forced mock mode and isMock labelling;
 * plus the deterministic 50-ticker mock universe. Real providers are replaced with scripted fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as string[],
  massiveOn: true,
  secOn: true,
  massive: 'throw' as 'throw' | 'empty' | 'ok',
  nidhiksh: 'empty' as 'throw' | 'empty' | 'ok',
  sec: 'ok' as 'throw' | 'empty' | 'ok',
}));

function fake(name: string, mode: () => 'throw' | 'empty' | 'ok', isMock = false) {
  const meta = () => ({ source: [{ id: `${name}:src`, name, kind: 'filing' as const }], isMock, asOf: '2026-01-01T00:00:00Z' });
  const respond = (data: unknown) => {
    h.calls.push(name);
    const m = mode();
    if (m === 'throw') throw new Error(`${name} down`);
    return { data: m === 'empty' ? (Array.isArray(data) ? [] : null) : data, meta: meta() };
  };
  return {
    name,
    getFilings: async (t: string) => respond([{ id: `${name}-${t}`, ticker: t, form: '10-K' }]),
    getQuote: async (t: string) => respond({ ticker: t, price: 1 }),
  };
}

vi.mock('@/lib/data/massive', () => ({ massiveEnabled: () => h.massiveOn, massiveProvider: fake('Massive (Polygon)', () => h.massive) }));
vi.mock('@/lib/data/nidhiksh', () => ({ nidhikshProvider: fake('Nidhiksh local cache', () => h.nidhiksh) }));
vi.mock('@/lib/data/sec', () => ({ secEnabled: () => h.secOn, secProvider: fake('SEC EDGAR', () => h.sec) }));

import { compositeProvider } from '@/lib/data/composite';
import { mockProvider } from '@/lib/data/mock';
import { MOCK_BY_TICKER, MOCK_UNIVERSE } from '@/lib/data/mock/universe';
import { cache } from '@/lib/cache';

const prevForce = process.env.ALPHADESK_FORCE_MOCK;
beforeEach(() => {
  cache.clear();
  h.calls.length = 0;
  Object.assign(h, { massiveOn: true, secOn: true, massive: 'throw', nidhiksh: 'empty', sec: 'ok' });
  delete process.env.ALPHADESK_FORCE_MOCK;
});
afterEach(() => {
  process.env.ALPHADESK_FORCE_MOCK = prevForce;
});

describe('composite provider chain', () => {
  it('walks Massive -> Nidhiksh -> SEC and the first provider with data wins', async () => {
    const r = await compositeProvider.getFilings('nvda');
    expect(h.calls).toEqual(['Massive (Polygon)', 'Nidhiksh local cache', 'SEC EDGAR']);
    expect(r.meta.provider).toBe('SEC EDGAR');
    expect(r.meta.isMock).toBe(false);
    expect((r.data as { ticker: string }[])[0].ticker).toBe('NVDA'); // tickers are upper-cased
  });

  it('stops at the first provider that returns data', async () => {
    h.massive = 'ok';
    const r = await compositeProvider.getFilings('AAPL');
    expect(h.calls).toEqual(['Massive (Polygon)']);
    expect(r.meta.provider).toBe('Massive (Polygon)');
  });

  it('skips disabled providers', async () => {
    h.massiveOn = false;
    h.nidhiksh = 'ok';
    const r = await compositeProvider.getFilings('AAPL');
    expect(h.calls).toEqual(['Nidhiksh local cache']);
    expect(r.meta.provider).toBe('Nidhiksh local cache');
  });

  it('falls through to Mock (labelled isMock) when every real provider is empty or failing', async () => {
    h.sec = 'throw';
    const r = await compositeProvider.getFilings('MSFT');
    expect(h.calls).toEqual(['Massive (Polygon)', 'Nidhiksh local cache', 'SEC EDGAR']);
    expect(r.meta.provider).toBe('Mock');
    expect(r.meta.isMock).toBe(true);
    expect(r.data.length).toBeGreaterThan(0);
  });

  it('ALPHADESK_FORCE_MOCK=1 never touches real providers', async () => {
    process.env.ALPHADESK_FORCE_MOCK = '1';
    h.massive = 'ok';
    const f = await compositeProvider.getFilings('AAPL');
    const q = await compositeProvider.getQuote('AAPL');
    expect(h.calls).toEqual([]);
    expect(f.meta).toMatchObject({ provider: 'Mock', isMock: true });
    expect(q.meta).toMatchObject({ provider: 'Mock', isMock: true });
    expect(q.data?.ticker).toBe('AAPL');
  });

  it('never throws for unknown tickers: returns null data labelled mock/none', async () => {
    process.env.ALPHADESK_FORCE_MOCK = '1';
    const q = await compositeProvider.getQuote('ZZZZZ');
    expect(q.data).toBeNull();
    expect(q.meta).toMatchObject({ isMock: true, provider: 'none', source: [] });
  });

  it('getQuotes flags isMock if any ticker came from mock, and de-duplicates', async () => {
    h.massive = 'ok';
    const r = await compositeProvider.getQuotes(['AAPL', 'aapl']);
    expect(r.data).toHaveLength(1);
    expect(r.meta.isMock).toBe(false);
    cache.clear();
    process.env.ALPHADESK_FORCE_MOCK = '1';
    const m = await compositeProvider.getQuotes(['AAPL', 'MSFT']);
    expect(m.data).toHaveLength(2);
    expect(m.meta.isMock).toBe(true);
  });

  it('caches by method + args', async () => {
    h.massive = 'ok';
    await compositeProvider.getFilings('AAPL');
    await compositeProvider.getFilings('aapl');
    expect(h.calls).toEqual(['Massive (Polygon)']);
  });
});

describe('mock universe', () => {
  it('has exactly 50 unique, well-formed tickers', () => {
    expect(MOCK_UNIVERSE).toHaveLength(50);
    const tickers = MOCK_UNIVERSE.map((m) => m.ticker);
    expect(new Set(tickers).size).toBe(50);
    for (const t of tickers) expect(t).toMatch(/^[A-Z][A-Z0-9.\-]{0,9}$/);
    expect(Object.keys(MOCK_BY_TICKER)).toHaveLength(50);
  });

  it('getUniverse and getScreenRows cover all 50 names', async () => {
    expect((await mockProvider.getUniverse()).data).toHaveLength(50);
    expect((await mockProvider.getScreenRows()).data).toHaveLength(50);
  });

  it('is deterministic across calls and labels every result isMock', async () => {
    for (const t of ['AAPL', 'JPM', 'XOM']) {
      const [a, b] = [await mockProvider.getQuote(t), await mockProvider.getQuote(t)];
      expect(a.data).toEqual(b.data);
      expect(a.meta.isMock).toBe(true);
    }
    const [n1, n2] = [await mockProvider.getNews('NVDA'), await mockProvider.getNews('NVDA')];
    expect(n1.data).toEqual(n2.data);
    expect(n1.meta.isMock).toBe(true);
  });
});
