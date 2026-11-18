import 'server-only';
import { getMarketData } from '@/lib/data';
import { getAnalystView } from '@/lib/data/fmp';
import { hasFeature } from '@/lib/plans';
import { getCalendarEvents } from '@/lib/calendar';
import { addDays, todayET } from '@/lib/calendar/dates';
import type {
  Bar, Catalyst, DataMeta, Estimates, Filing, Financials, InsiderTxn, InstitutionalHolding, NewsItem, Profile, Quote, SourceRef,
} from '@/lib/data/types';
import {
  deriveForward, deriveValuation, filingsToEvents, insidersToEvents, mergeEvents, newsToEvents, periodSource, type ChartEvent, type ForwardValuation, type Valuation,
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

/**
 * What the viewer's plan may see. Gated data is never FETCHED for a Free user (not just hidden), so it can't leak
 * through props, the RSC payload or API JSON. Build with `companyAccess(user)`.
 */
export interface CompanyAccess { analystResearch: boolean; financials: boolean; ownership: boolean }
export const FULL_ACCESS: CompanyAccess = { analystResearch: true, financials: true, ownership: true };
export function companyAccess(user: { plan: string } | null | undefined): CompanyAccess {
  return { analystResearch: hasFeature(user, 'analystResearch'), financials: hasFeature(user, 'financials'), ownership: hasFeature(user, 'ownership') };
}

// ------------------------------------------------------------- core (header)

export interface CoreData {
  ticker: string;
  profile: Profile | null;
  quote: Quote | null;
  bars1Y: Bar[];
  week52: { high: number | null; low: number | null };
  marketCap: number | null;
  valuation: Valuation;
  /** Forward EPS / P/E from analyst consensus (null fields when no real or same-mode estimate is available). Null when the plan lacks analystResearch. */
  forward: ForwardValuation | null;
  /** evEbitda/ev are null (and evBasis empty) when the plan lacks `financials`. */
  sources: { price: SourceRef; marketCap: SourceRef; pe: SourceRef; evEbitda: SourceRef | null; range: SourceRef; profile: SourceRef; fwdEps: SourceRef | null; fwdPe: SourceRef | null };
  access: CompanyAccess;
  /** Header-critical data only (profile, quote, 1Y history, financials) — drives the page-level MockBanner. */
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

export async function loadCore(ticker: string, access: CompanyAccess = FULL_ACCESS): Promise<CoreData> {
  // 52-week range + fallback quote always come from DAILY 1Y bars (never the intraday 1D/1W ranges).
  const [p, q, h] = await Promise.all([md().getProfile(ticker), md().getQuote(ticker), md().getHistory(ticker, '1Y')]);
  const profile = p.data;
  const bars1Y = h.data ?? [];
  const quote = q.data ?? quoteFromBars(ticker, bars1Y);
  const found = !!(profile || q.data || bars1Y.length);
  // Only spend provider calls (incl. the 25/day Alpha Vantage quota) on statements/estimates once we know the symbol exists.
  const none = { data: null, meta: { source: [], isMock: true, asOf: new Date().toISOString(), provider: 'none' } };
  const [fa, fq, e] = found
    ? await Promise.all([md().getFinancials(ticker, 'annual'), md().getFinancials(ticker, 'quarterly'), access.analystResearch ? md().getEstimates(ticker) : Promise.resolve(none)])
    : [none, none, none];
  const hi = bars1Y.length ? Math.max(...bars1Y.map((b) => b.high)) : profile?.week52High || null;
  const lo = bars1Y.length ? Math.min(...bars1Y.map((b) => b.low)) : profile?.week52Low || null;
  // Prefer real shares (provider profile, else latest SEC diluted share count) × live price over a quote's estimated cap.
  const secShares = (fq.data?.rows.at(-1) ?? fa.data?.rows.at(-1))?.sharesOutstanding || 0;
  const shares = (p.meta.isMock ? 0 : profile?.sharesOutstanding) || (fq.meta.isMock ? 0 : secShares) || profile?.sharesOutstanding || 0;
  const marketCap = (shares && quote ? shares * quote.price : 0) || quote?.marketCap || profile?.marketCap || null;
  const valuationAll = deriveValuation({
    price: quote?.price ?? null, marketCap, annual: fa.data?.rows ?? [], quarterly: fq.data?.rows ?? [],
    fallbackPe: profile?.pe, fallbackEvEbitda: profile?.evEbitda,
  });
  // P/E (TTM) and EPS (TTM) are Free; EV/EBITDA is part of `financials`.
  const valuation: Valuation = access.financials ? valuationAll : { ...valuationAll, evEbitda: null, ev: null, evBasis: '' };
  // Use consensus only when it is real, or when the price itself is simulated (pure demo mode) — never mix mock into a live header.
  const priceMock = q.data ? q.meta.isMock : h.meta.isMock;
  const est = e.data && (!e.meta.isMock || priceMock) ? e.data : null;
  const estAsOf = e.meta.asOf.slice(0, 10);
  const estLabel = e.meta.isMock ? 'Simulated consensus' : `${e.meta.provider ?? 'Provider'} consensus, as of ${estAsOf}`;
  const forward = deriveForward({ price: quote?.price ?? null, forwardEps: est?.forwardEps, forwardPe: est?.forwardPe, basis: est?.forwardBasis, label: estLabel });
  const estSrc0 = e.meta.source.find((x) => x.kind === 'estimate') ?? e.meta.source[0];
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
    evEbitda: access.financials ? { id: `ev:${ticker}`, name: finSrc?.name ?? `${ticker} financial statements`, url: finSrc?.url, kind: kindFor(finMock, 'filing'), excerpt: valuation.evBasis, locator: 'Derived from balance sheet + income statement' } : null,
    range: { id: h.meta.source[0]?.id ?? `range:${ticker}`, name: h.meta.source[0]?.name ?? `${ticker} daily bars`, kind: kindFor(h.meta.isMock, 'price'), excerpt: hi && lo ? `52-week range $${lo.toFixed(2)} – $${hi.toFixed(2)} from ${bars1Y.length} daily bars (${prov(h.meta)}).` : '52-week range unavailable.', locator: 'Daily OHLC, trailing 1Y' },
    fwdEps: !access.analystResearch ? null : { id: `fwdeps:${ticker}`, name: estSrc0?.name ?? `${ticker} consensus estimates`, url: estSrc0?.url, kind: kindFor(!!est && e.meta.isMock, 'estimate'), excerpt: forward.epsBasis, locator: est?.forwardBasis ?? 'Forward EPS' },
    fwdPe: !access.analystResearch ? null : { id: `fwdpe:${ticker}`, name: estSrc0?.name ?? `${ticker} consensus estimates`, url: estSrc0?.url, kind: kindFor(!!est && e.meta.isMock, 'estimate'), excerpt: forward.peBasis, locator: 'Forward P/E' },
    profile: { id: p.meta.source[0]?.id ?? `profile:${ticker}`, name: p.meta.source[0]?.name ?? `${ticker} reference data`, url: profile?.website || undefined, kind: kindFor(p.meta.isMock, 'filing'), excerpt: profile?.description || 'No company description available.', locator: 'Company profile' },
  };
  // Provider profile multiples that belong to premium sections are zeroed so they can't leak via the aggregate API.
  const safeProfile = profile && (!access.financials || !access.analystResearch)
    ? { ...profile, evEbitda: access.financials ? profile.evEbitda : 0, forwardPe: access.analystResearch ? profile.forwardPe : 0 }
    : profile;
  return { ticker, profile: safeProfile, quote, bars1Y, week52: { high: hi, low: lo }, marketCap, valuation, forward: access.analystResearch ? forward : null, sources, access, meta: combineMeta(p.meta, q.meta, h.meta, fa.meta, fq.meta), found };
}

// ------------------------------------------------------------- chart events

export interface ChartEventsData { events: ChartEvent[]; meta: SectionMeta }

export async function loadChartEvents(ticker: string, access: CompanyAccess = FULL_ACCESS): Promise<ChartEventsData> {
  const [f, n, i] = await Promise.all([md().getFilings(ticker), md().getNews(ticker), access.ownership ? md().getInsiders(ticker) : Promise.resolve(null)]);
  const events = mergeEvents(filingsToEvents(f.data ?? []), insidersToEvents(i?.data ?? []), newsToEvents(n.data ?? [], 15));
  return { events, meta: i ? combineMeta(f.meta, n.meta, i.meta) : combineMeta(f.meta, n.meta) };
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
  const [e, fmp] = await Promise.all([md().getEstimates(ticker), getAnalystView(ticker)]);
  const s = e.meta.source.find((x) => x.kind === 'estimate') ?? e.meta.source[0] ?? null;
  let estimates = e.data;
  // Ratings, targets and grade changes come from FMP when configured (consensus EPS/revenue stay with the estimates provider).
  if (fmp) {
    const base: Estimates = estimates ?? { ticker, rating: { buy: 0, hold: 0, sell: 0 }, priceTarget: { mean: 0, high: 0, low: 0 }, periods: [] };
    estimates = {
      ...base,
      rating: fmp.rating ?? base.rating,
      priceTarget: fmp.priceTarget ? { mean: fmp.priceTarget.mean, high: fmp.priceTarget.high, low: fmp.priceTarget.low } : base.priceTarget,
      priceTargetMedian: fmp.priceTarget?.median,
      analystActions: fmp.actions,
      analystSource: { name: fmp.source.name, url: fmp.source.url, asOf: fmp.asOf },
    };
  }
  const providers = combineMeta(e.meta);
  if (fmp && !providers.providers.includes('FMP')) providers.providers.push('FMP');
  return { estimates, source: s ? { ...s, kind: e.meta.isMock ? 'mock' : s.kind } : null, meta: providers };
}

export interface OwnershipData { insiders: InsiderTxn[]; institutional: InstitutionalHolding[]; insiderSource: SourceRef | null; instSource: SourceRef | null; meta: SectionMeta; insiderMock: boolean; instMock: boolean }
export async function loadOwnership(ticker: string): Promise<OwnershipData> {
  const [i, h] = await Promise.all([md().getInsiders(ticker), md().getInstitutional(ticker)]);
  const pickSrc = (m: DataMeta) => m.source.find((s) => s.kind === 'ownership') ?? null;
  return { insiders: i.data ?? [], institutional: h.data ?? [], insiderSource: pickSrc(i.meta), instSource: pickSrc(h.meta), meta: combineMeta(i.meta, h.meta), insiderMock: i.meta.isMock, instMock: h.meta.isMock };
}

export interface NewsFilingsData { news: NewsItem[]; filings: Filing[]; catalysts: Catalyst[]; meta: SectionMeta; newsProvider?: string; filingsProvider?: string; catalystsMock: boolean }
export async function loadNewsFilings(ticker: string): Promise<NewsFilingsData> {
  const [n, f, cal] = await Promise.all([
    md().getNews(ticker), md().getFilings(ticker),
    getCalendarEvents({ categories: ['earnings'], watchlist: [ticker], from: todayET(), to: addDays(todayET(), 180) }).catch(() => null),
  ]);
  // Earnings dates from the real calendar (Alpha Vantage); fall back to provider catalysts only when it has none.
  const real: Catalyst[] = (cal?.events ?? [])
    .filter((e) => e.ticker === ticker.toUpperCase() && !e.estimated)
    .map((e) => ({ id: e.id, ticker: e.ticker, type: 'earnings', title: e.title, date: e.date, confirmed: true, description: [e.detail, e.source.name].filter(Boolean).join(' · ') }));
  const c = real.length ? null : await md().getCatalysts(ticker);
  const metas = c ? [n.meta, f.meta, c.meta] : [n.meta, f.meta];
  return { news: n.data ?? [], filings: f.data ?? [], catalysts: real.length ? real : c?.data ?? [], meta: combineMeta(...metas), newsProvider: n.meta.provider, filingsProvider: f.meta.provider, catalystsMock: c ? c.meta.isMock : false };
}

// ------------------------------------------------------------- aggregate (API / AI / sharing)

export async function loadAggregate(ticker: string, access: CompanyAccess = FULL_ACCESS) {
  const core = await loadCore(ticker, access);
  if (!core.found) return { ticker, found: false as const };
  const [chart, fin, est, own, nf] = await Promise.all([
    loadChartEvents(ticker, access),
    access.financials ? loadFinancials(ticker, core.profile?.cik) : Promise.resolve(null),
    access.analystResearch ? loadEstimates(ticker) : Promise.resolve(null),
    access.ownership ? loadOwnership(ticker) : Promise.resolve(null),
    loadNewsFilings(ticker),
  ]);
  const metas = [core.meta, chart.meta, fin?.meta, est?.meta, own?.meta, nf.meta].filter((m): m is SectionMeta => !!m);
  const locked = (Object.keys(access) as (keyof CompanyAccess)[]).filter((k) => !access[k]);
  return {
    ticker, found: true as const,
    profile: core.profile, quote: core.quote, marketCap: core.marketCap, week52: core.week52, valuation: core.valuation, forward: core.forward, headerSources: core.sources,
    events: chart.events,
    financials: fin ? { annual: fin.annual, quarterly: fin.quarterly, annualSources: fin.annualSources, quarterlySources: fin.quarterlySources } : null,
    estimates: est?.estimates ?? null,
    insiders: own?.insiders ?? null, institutional: own?.institutional ?? null,
    news: nf.news, filings: nf.filings, catalysts: nf.catalysts,
    /** Premium sections withheld for this viewer's plan (upgrade to unlock). */
    locked,
    meta: {
      isMock: metas.some((m) => m.isMock),
      providers: Array.from(new Set(metas.flatMap((m) => m.providers))),
      sections: { core: core.meta, events: chart.meta, financials: fin?.meta ?? null, estimates: est?.meta ?? null, ownership: own?.meta ?? null, newsFilings: nf.meta },
      asOf: new Date().toISOString(),
      disclaimer: 'Research only — not investment advice.',
    },
  };
}

/** All section metas (cached provider calls, so cheap after the sections load) — drives the page MockBanner. */
export async function loadAllMetas(ticker: string, cik?: string, includeBody = true, access: CompanyAccess = FULL_ACCESS): Promise<SectionMeta> {
  const core = await loadCore(ticker, access);
  if (!includeBody) return core.meta;
  const parts = await Promise.all([
    loadChartEvents(ticker, access), loadNewsFilings(ticker),
    ...(access.financials ? [loadFinancials(ticker, cik)] : []), ...(access.analystResearch ? [loadEstimates(ticker)] : []), ...(access.ownership ? [loadOwnership(ticker)] : []),
  ]);
  const all = [core.meta, ...parts.map((x) => x.meta)];
  return { isMock: all.some((m) => m.isMock), providers: Array.from(new Set(all.flatMap((m) => m.providers))), asOf: core.meta.asOf, sources: [] };
}
