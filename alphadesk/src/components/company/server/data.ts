import 'server-only';
import { getMarketData } from '@/lib/data';
import type {
  Bar, Catalyst, DataMeta, Estimates, Filing, Financials, InsiderTxn, InstitutionalHolding, NewsItem, Profile, Quote, SourceRef,
} from '@/lib/data/types';
import {
  deriveValuation, filingsToEvents, insidersToEvents, mergeEvents, newsToEvents, periodSource, type ChartEvent, type Valuation,
} from '../lib/helpers';

/** Compact meta summary used for per-section badges + the page MockBanner. */
export interface SectionMeta { isMock: boolean; providers: string[]; asOf: string; sources: SourceRef[] }

export function combineMeta(...metas: DataMeta[]): SectionMeta {
  const providers = Array.from(new Set(metas.map((m) => m.provider).filter((p): p is string => !!p && p !== 'none')));
  return {
    isMock: metas.some((m) => m.isMock && m.provider !== 'none'),
    providers,
    asOf: metas.map((m) => m.asOf).sort().pop() ?? new Date().toISOString(),
    sources: metas.flatMap((m) => m.source).slice(0, 8),
  };
}

const md = () => getMarketData();

// ------------------------------------------------------------- core (header)

export interface CoreData {
  ticker: string;
  profile: Profile | null;
  quote: Quote | null;
  bars1Y: Bar[];
  week52: { high: number | null; low: number | null };
  marketCap: number | null;
  valuation: Valuation;
  sources: { price: SourceRef; marketCap: SourceRef; pe: SourceRef; evEbitda: SourceRef; range: SourceRef; profile: SourceRef };
  meta: SectionMeta;
  found: boolean;
}

function quoteFromBars(ticker: string, bars: Bar[]): Quote | null {
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2] ?? last;
  const change = last.close - prev.close;
  return {
    ticker, price: last.close, change, changePct: prev.close ? (change / prev.close) * 100 : 0, open: last.open, high: last.high, low: last.low,
    prevClose: prev.close, volume: last.volume, marketCap: 0, ts: `${last.date}T21:00:00.000Z`,
  };
}

export async function loadCore(ticker: string): Promise<CoreData> {
  const [p, q, h] = await Promise.all([md().getProfile(ticker), md().getQuote(ticker), md().getHistory(ticker, '1Y')]);
  const profile = p.data;
  const bars1Y = h.data ?? [];
  const quote = q.data ?? quoteFromBars(ticker, bars1Y);
  const found = !!(profile || q.data || bars1Y.length);
  // Only spend provider calls on statements once we know the symbol exists.
  const emptyFin = { data: null, meta: { source: [], isMock: true, asOf: new Date().toISOString(), provider: 'none' } };
  const [fa, fq] = found ? await Promise.all([md().getFinancials(ticker, 'annual'), md().getFinancials(ticker, 'quarterly')]) : [emptyFin, emptyFin];
  const hi = bars1Y.length ? Math.max(...bars1Y.map((b) => b.high)) : profile?.week52High || null;
  const lo = bars1Y.length ? Math.min(...bars1Y.map((b) => b.low)) : profile?.week52Low || null;
  const shares = profile?.sharesOutstanding || 0;
  const marketCap = quote?.marketCap || (shares && quote ? shares * quote.price : 0) || profile?.marketCap || null;
  const valuation = deriveValuation({
    price: quote?.price ?? null, marketCap, annual: fa.data?.rows ?? [], quarterly: fq.data?.rows ?? [],
    fallbackPe: profile?.pe, fallbackEvEbitda: profile?.evEbitda,
  });
  const priceSrc0 = q.meta.source.find((s) => s.kind === 'price') ?? h.meta.source[0];
  const finSrc = fq.meta.source[0] ?? fa.meta.source[0];
  const finMock = (fq.data ? fq.meta.isMock : fa.meta.isMock) ?? true;
  const kindFor = (mock: boolean, k: SourceRef['kind']): SourceRef['kind'] => (mock ? 'mock' : k);
  const prov = (m: DataMeta) => m.provider ?? 'provider';
  const priceText = quote ? `Last price $${quote.price.toFixed(2)} (${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}, ${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}%) as of ${quote.ts.slice(0, 16).replace('T', ' ')} UTC via ${prov(q.data ? q.meta : h.meta)}.` : 'No quote available.';
  const sources: CoreData['sources'] = {
    price: { id: priceSrc0?.id ?? `price:${ticker}`, name: priceSrc0?.name ?? `${ticker} price`, url: priceSrc0?.url, kind: kindFor(q.data ? q.meta.isMock : h.meta.isMock, 'price'), excerpt: priceText, locator: 'Quote' },
    marketCap: { id: `mcap:${ticker}`, name: `${ticker} market capitalisation`, kind: kindFor(q.meta.isMock || p.meta.isMock, 'price'), excerpt: marketCap ? `Market cap ≈ $${(marketCap / 1e9).toFixed(1)}B${shares && quote ? ` = ${(shares / 1e6).toFixed(0)}M shares × $${quote.price.toFixed(2)}` : ''} (${prov(q.meta)}${p.data ? ` / ${prov(p.meta)}` : ''}).` : 'Market cap unavailable.', locator: 'Derived' },
    pe: { id: `pe:${ticker}`, name: finSrc?.name ?? `${ticker} financial statements`, url: finSrc?.url, kind: kindFor(finMock, 'filing'), excerpt: valuation.peBasis, locator: 'Derived from income statement' },
    evEbitda: { id: `ev:${ticker}`, name: finSrc?.name ?? `${ticker} financial statements`, url: finSrc?.url, kind: kindFor(finMock, 'filing'), excerpt: valuation.evBasis, locator: 'Derived from balance sheet + income statement' },
    range: { id: h.meta.source[0]?.id ?? `range:${ticker}`, name: h.meta.source[0]?.name ?? `${ticker} daily bars`, kind: kindFor(h.meta.isMock, 'price'), excerpt: hi && lo ? `52-week range $${lo.toFixed(2)} – $${hi.toFixed(2)} from ${bars1Y.length} daily bars (${prov(h.meta)}).` : '52-week range unavailable.', locator: 'Daily OHLC, trailing 1Y' },
    profile: { id: p.meta.source[0]?.id ?? `profile:${ticker}`, name: p.meta.source[0]?.name ?? `${ticker} reference data`, url: profile?.website || undefined, kind: kindFor(p.meta.isMock, 'filing'), excerpt: profile?.description || 'No company description available.', locator: 'Company profile' },
  };
  return { ticker, profile, quote, bars1Y, week52: { high: hi, low: lo }, marketCap, valuation, sources, meta: combineMeta(p.meta, q.meta, h.meta), found };
}

// ------------------------------------------------------------- chart events

export interface ChartEventsData { events: ChartEvent[]; meta: SectionMeta }

export async function loadChartEvents(ticker: string): Promise<ChartEventsData> {
  const [f, n, i] = await Promise.all([md().getFilings(ticker), md().getNews(ticker), md().getInsiders(ticker)]);
  const events = mergeEvents(filingsToEvents(f.data ?? []), insidersToEvents(i.data ?? []), newsToEvents(n.data ?? [], 15));
  return { events, meta: combineMeta(f.meta, n.meta, i.meta) };
}

// ------------------------------------------------------------- financials

export interface FinancialsData {
  annual: Financials | null;
  quarterly: Financials | null;
  /** periodKey (`${fiscalYear}-${fiscalPeriod}`) → source */
  annualSources: Record<string, SourceRef>;
  quarterlySources: Record<string, SourceRef>;
  provider: { annual?: string; quarterly?: string };
  meta: SectionMeta;
}

export const periodKey = (r: { fiscalYear: number; fiscalPeriod: string }) => `${r.fiscalYear}-${r.fiscalPeriod}`;

export async function loadFinancials(ticker: string, cik?: string): Promise<FinancialsData> {
  const [a, q, f] = await Promise.all([md().getFinancials(ticker, 'annual'), md().getFinancials(ticker, 'quarterly'), md().getFilings(ticker)]);
  const filings = f.data ?? [];
  const build = (fin: Financials | null, meta: DataMeta) => {
    const out: Record<string, SourceRef> = {};
    for (const r of fin?.rows ?? []) out[periodKey(r)] = periodSource(r, filings, ticker, { isMock: meta.isMock, cik, provider: meta.provider });
    return out;
  };
  return {
    annual: a.data, quarterly: q.data,
    annualSources: build(a.data, a.meta), quarterlySources: build(q.data, q.meta),
    provider: { annual: a.meta.provider, quarterly: q.meta.provider },
    meta: combineMeta(a.meta, q.meta),
  };
}

// ------------------------------------------------------------- estimates / ownership / news

export interface EstimatesData { estimates: Estimates | null; source: SourceRef | null; meta: SectionMeta }
export async function loadEstimates(ticker: string): Promise<EstimatesData> {
  const e = await md().getEstimates(ticker);
  const s = e.meta.source.find((x) => x.kind === 'estimate') ?? e.meta.source[0] ?? null;
  return { estimates: e.data, source: s ? { ...s, kind: e.meta.isMock ? 'mock' : s.kind } : null, meta: combineMeta(e.meta) };
}

export interface OwnershipData { insiders: InsiderTxn[]; institutional: InstitutionalHolding[]; insiderSource: SourceRef | null; instSource: SourceRef | null; meta: SectionMeta; insiderMock: boolean; instMock: boolean }
export async function loadOwnership(ticker: string): Promise<OwnershipData> {
  const [i, h] = await Promise.all([md().getInsiders(ticker), md().getInstitutional(ticker)]);
  const pickSrc = (m: DataMeta) => m.source.find((s) => s.kind === 'ownership') ?? null;
  return { insiders: i.data ?? [], institutional: h.data ?? [], insiderSource: pickSrc(i.meta), instSource: pickSrc(h.meta), meta: combineMeta(i.meta, h.meta), insiderMock: i.meta.isMock, instMock: h.meta.isMock };
}

export interface NewsFilingsData { news: NewsItem[]; filings: Filing[]; catalysts: Catalyst[]; meta: SectionMeta; newsProvider?: string; filingsProvider?: string; catalystsMock: boolean }
export async function loadNewsFilings(ticker: string): Promise<NewsFilingsData> {
  const [n, f, c] = await Promise.all([md().getNews(ticker), md().getFilings(ticker), md().getCatalysts(ticker)]);
  return { news: n.data ?? [], filings: f.data ?? [], catalysts: c.data ?? [], meta: combineMeta(n.meta, f.meta, c.meta), newsProvider: n.meta.provider, filingsProvider: f.meta.provider, catalystsMock: c.meta.isMock };
}

// ------------------------------------------------------------- aggregate (API / AI / sharing)

export async function loadAggregate(ticker: string) {
  const core = await loadCore(ticker);
  if (!core.found) return { ticker, found: false as const };
  const [chart, fin, est, own, nf] = await Promise.all([
    loadChartEvents(ticker), loadFinancials(ticker, core.profile?.cik), loadEstimates(ticker), loadOwnership(ticker), loadNewsFilings(ticker),
  ]);
  const metas = [core.meta, chart.meta, fin.meta, est.meta, own.meta, nf.meta];
  return {
    ticker, found: true as const,
    profile: core.profile, quote: core.quote, marketCap: core.marketCap, week52: core.week52, valuation: core.valuation, headerSources: core.sources,
    events: chart.events,
    financials: { annual: fin.annual, quarterly: fin.quarterly, annualSources: fin.annualSources, quarterlySources: fin.quarterlySources },
    estimates: est.estimates,
    insiders: own.insiders, institutional: own.institutional,
    news: nf.news, filings: nf.filings, catalysts: nf.catalysts,
    meta: {
      isMock: metas.some((m) => m.isMock),
      providers: Array.from(new Set(metas.flatMap((m) => m.providers))),
      sections: { core: core.meta, events: chart.meta, financials: fin.meta, estimates: est.meta, ownership: own.meta, newsFilings: nf.meta },
      asOf: new Date().toISOString(),
      disclaimer: 'Research only — not investment advice.',
    },
  };
}

/** All section metas (cached provider calls, so cheap after the sections load) — drives the page MockBanner. */
export async function loadAllMetas(ticker: string, cik?: string, includeBody = true): Promise<SectionMeta> {
  const core = await loadCore(ticker);
  if (!includeBody) return core.meta;
  const parts = await Promise.all([loadChartEvents(ticker), loadFinancials(ticker, cik), loadEstimates(ticker), loadOwnership(ticker), loadNewsFilings(ticker)]);
  const all = [core.meta, ...parts.map((x) => x.meta)];
  return { isMock: all.some((m) => m.isMock), providers: Array.from(new Set(all.flatMap((m) => m.providers))), asOf: core.meta.asOf, sources: [] };
}
