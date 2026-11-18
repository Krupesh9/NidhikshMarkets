import 'server-only';
import type { MarketDataProvider, PartialProvider, Quote, WithMeta } from './types';
import { mockProvider } from './mock';
import { massiveEnabled, massiveProvider } from './massive';
import { nidhikshProvider } from './nidhiksh';
import { secEnabled, secProvider } from './sec';
import { cache } from '../cache';
import { log } from '../log';

type Method = Exclude<keyof MarketDataProvider, 'name'>;

function hasData(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object' && 'rows' in (v as object)) return ((v as { rows: unknown[] }).rows ?? []).length > 0;
  return true;
}

function chain(): PartialProvider[] {
  if (process.env.ALPHADESK_FORCE_MOCK === '1') return [mockProvider];
  const out: PartialProvider[] = [];
  if (massiveEnabled()) out.push(massiveProvider);
  out.push(nidhikshProvider);
  if (secEnabled()) out.push(secProvider);
  out.push(mockProvider);
  return out;
}

/** TTL per method (ms). Quotes refresh quickly; reference data is long-lived. */
const TTL: Partial<Record<Method, number>> = {
  getQuote: 30_000, getQuotes: 30_000, getScreenRows: 60_000, getNews: 5 * 60_000,
  getHistory: 10 * 60_000, getFilings: 60 * 60_000, getProfile: 60 * 60_000, getFinancials: 60 * 60_000,
};

const NULLABLE = new Set<Method>(['getQuote', 'getProfile', 'getFinancials', 'getEstimates']);

async function first<T>(method: Method, args: unknown[]): Promise<WithMeta<T>> {
  const key = `md:${method}:${JSON.stringify(args)}`;
  return cache.wrap(
    key,
    async () => {
      for (const p of chain()) {
        const fn = p[method] as ((...a: unknown[]) => Promise<WithMeta<T>>) | undefined;
        if (!fn) continue;
        try {
          const r = await fn.apply(p, args);
          if (hasData(r.data)) return { data: r.data, meta: { ...r.meta, provider: r.meta.provider ?? p.name } };
        } catch (e) {
          log.debug('marketdata.provider_failed', { provider: p.name, method, err: (e as Error).message });
        }
      }
      // never throw to the UI: return an empty, mock-labelled result
      return { data: (NULLABLE.has(method) ? null : []) as T, meta: { source: [], isMock: true, asOf: new Date().toISOString(), provider: 'none' } };
    },
    TTL[method] ?? 5 * 60_000,
  );
}

class CompositeProvider implements MarketDataProvider {
  readonly name = 'Composite';
  getUniverse() { return first<Awaited<ReturnType<MarketDataProvider['getUniverse']>>['data']>('getUniverse', []); }
  getQuote(t: string) { return first<Quote | null>('getQuote', [t.toUpperCase()]); }
  /** Per-ticker fall-through: each ticker is served by the first provider that has it. */
  async getQuotes(ts: string[]): Promise<WithMeta<Quote[]>> {
    const tickers = Array.from(new Set(ts.map((t) => t.toUpperCase())));
    const results = await Promise.all(tickers.map((t) => this.getQuote(t)));
    const data = results.map((r) => r.data).filter((q): q is Quote => !!q);
    const isMock = results.some((r) => r.data && r.meta.isMock);
    const providers = Array.from(new Set(results.filter((r) => r.data).map((r) => r.meta.provider)));
    return { data, meta: { source: results.flatMap((r) => r.meta.source).slice(0, 10), isMock, asOf: new Date().toISOString(), provider: providers.join(' + ') } };
  }
  getHistory(t: string, range: Parameters<MarketDataProvider['getHistory']>[1]) { return first('getHistory', [t.toUpperCase(), range]) as ReturnType<MarketDataProvider['getHistory']>; }
  getProfile(t: string) { return first('getProfile', [t.toUpperCase()]) as ReturnType<MarketDataProvider['getProfile']>; }
  getFinancials(t: string, period: Parameters<MarketDataProvider['getFinancials']>[1]) { return first('getFinancials', [t.toUpperCase(), period]) as ReturnType<MarketDataProvider['getFinancials']>; }
  getEstimates(t: string) { return first('getEstimates', [t.toUpperCase()]) as ReturnType<MarketDataProvider['getEstimates']>; }
  getInsiders(t: string) { return first('getInsiders', [t.toUpperCase()]) as ReturnType<MarketDataProvider['getInsiders']>; }
  getInstitutional(t: string) { return first('getInstitutional', [t.toUpperCase()]) as ReturnType<MarketDataProvider['getInstitutional']>; }
  getNews(t?: string) { return first('getNews', [t?.toUpperCase()]) as ReturnType<MarketDataProvider['getNews']>; }
  getFilings(t: string) { return first('getFilings', [t.toUpperCase()]) as ReturnType<MarketDataProvider['getFilings']>; }
  getCatalysts(t?: string) { return first('getCatalysts', [t?.toUpperCase()]) as ReturnType<MarketDataProvider['getCatalysts']>; }
  getScreenRows() { return first('getScreenRows', []) as ReturnType<MarketDataProvider['getScreenRows']>; }
  getTranscripts(t: string) { return first('getTranscripts', [t.toUpperCase()]) as ReturnType<MarketDataProvider['getTranscripts']>; }
}

export const compositeProvider: MarketDataProvider = new CompositeProvider();
