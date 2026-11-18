import 'server-only';
import { cache } from '@/lib/cache';
import { getCalendarEvents } from '@/lib/calendar';
import { getMarketData, resolveMockSource } from '@/lib/data';
import type { DataMeta, Estimates, FinancialStatementRow, Quote, SourceRef } from '@/lib/data/types';
import { FMP_PROFILE_URL, getFmpMetrics, getFmpProfile, getFmpRevenueGrowth, type FmpMetrics, type FmpProfile } from '@/lib/data/fmpProfile';
import { log } from '@/lib/log';
import { deriveValuation } from '@/components/company/lib/helpers';
import { daysUntil } from './engine';
import { buildWhyNow, epsRevision30dFrom, FUND_SECTOR, mapFmpSector, netInsiderDollars, revenueGrowthFrom, UNKNOWN_SECTOR } from './derive';
import type { ScreenResultRow } from './types';

/**
 * Live screener rows for an arbitrary ticker list — real sources only, never mock:
 *   price / change   Alpaca snapshots (batched, 30s cache)            sparkline   Alpaca daily bars (1M)
 *   name / sector    FMP profile (7-day memory + disk cache)          P/E, EV/EBITDA, revenue growth, shares → mkt cap: SEC XBRL
 *   insiders 90d     SEC Form 4                                        next earnings: Alpha Vantage earnings calendar
 *   EPS revision     Alpha Vantage estimates, only when already cached (25 calls/day)
 *   short interest, ESG: no free source → null
 * Slow sources race a request deadline; whatever misses it keeps loading in the background and the row is marked
 * 'partial' (cached 30s instead of 5 min) so the next refresh fills it in.
 */

const ROW_TTL = 5 * 60_000;
const PARTIAL_TTL = 30_000;
const CAL_TTL = 30 * 60_000;
const DEADLINE_MS = 6_000;
const BACKGROUND_DEADLINE_MS = 120_000;
const STALE_TTL = 30 * 60_000;
export const LIVE_SOURCES: SourceRef[] = [
  { id: 'src:alpaca', name: 'Alpaca market data (IEX)', url: 'https://alpaca.markets/data', kind: 'price' },
  { id: 'src:sec', name: 'SEC EDGAR (XBRL financials, Form 4)', url: 'https://www.sec.gov/edgar/search/', kind: 'filing' },
  { id: 'src:fmp', name: 'Financial Modeling Prep (profiles)', url: 'https://site.financialmodelingprep.com/', kind: 'estimate' },
  { id: 'src:av', name: 'Alpha Vantage (earnings calendar)', url: 'https://www.alphavantage.co/documentation/#earnings-calendar', kind: 'estimate' },
];

// ───────────────────────────── concurrency helpers ─────────────────────────────

function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    active++;
    try { return await fn(); } finally { active--; queue.shift()?.(); }
  };
}
const histLimit = limiter(6);
const fmpLimit = limiter(4);
const secLimit = limiter(3);
// Form 4 fetches are ~20 sequential SEC requests per ticker; one ticker at a time keeps us under SEC's 10 req/s.
const insiderLimit = limiter(1);

/** Share one in-flight promise per key so background work isn't queued twice across requests. */
const inflight = new Map<string, Promise<unknown>>();
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const p = inflight.get(key);
  if (p) return p as Promise<T>;
  const np = fn().finally(() => inflight.delete(key));
  inflight.set(key, np);
  return np;
}

type Soft<T> = { done: true; v: T } | { done: false };
function soft<T>(p: Promise<T>, deadline: number): Promise<Soft<T>> {
  const ms = Math.max(0, deadline - Date.now());
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ done: false }), ms);
    p.then((v) => { clearTimeout(t); resolve({ done: true, v }); }, (e) => {
      clearTimeout(t);
      log.debug('screener.live.task_failed', { err: (e as Error).message });
      resolve({ done: true, v: null as T });
    });
  });
}

// ───────────────────────────── per-ticker static part (cached) ─────────────────────────────

interface Fin { annual: FinancialStatementRow[]; quarterly: FinancialStatementRow[]; source: SourceRef | null }
interface Static {
  ticker: string;
  profile: FmpProfile | null;
  profileDone: boolean;
  fin: Fin | null;
  fmp: FmpMetrics | null;
  /** FMP revenue growth when SEC financials exist but revenue doesn't map (banks) */
  fmpGrowth: number | null;
  insider: { net: number; sources: SourceRef[] } | null;
  sparkline: number[];
  lastClose: number | null;
  complete: boolean;
}

const tail = (rows: FinancialStatementRow[], n: number) => rows.slice(-n);

async function loadFin(T: string): Promise<Fin | null> {
  const md = getMarketData();
  const [a, q] = await Promise.all([md.getFinancials(T, 'annual'), md.getFinancials(T, 'quarterly')]);
  const annual = a.meta.isMock ? [] : a.data?.rows ?? [];
  const quarterly = q.meta.isMock ? [] : q.data?.rows ?? [];
  if (!annual.length && !quarterly.length) return null;
  const source = (!q.meta.isMock && q.meta.source[0]) || (!a.meta.isMock && a.meta.source[0]) || null;
  // keep only what valuation/growth need (8 quarters for TTM vs prior TTM, 3 years)
  return { annual: tail(annual, 3), quarterly: tail(quarterly, 8), source };
}

async function loadInsider(T: string): Promise<Static['insider']> {
  const r = await getMarketData().getInsiders(T);
  // mock fallback, or nothing served at all ('none' = every provider failed): unknown, not $0
  if (r.meta.isMock || r.meta.provider === 'none') return null;
  return { net: netInsiderDollars(r.data), sources: r.meta.source.slice(0, 2) };
}

async function buildStatic(T: string, deadline: number): Promise<Static> {
  const md = getMarketData();
  const profileP = once(`p:${T}`, () => fmpLimit(() => getFmpProfile(T)));
  const histP = once(`h:${T}`, () => histLimit(() => md.getHistory(T, '1M')));
  const profile = await soft(profileP, Math.min(deadline, Date.now() + 4000));
  const isEtf = profile.done && !!profile.v && (profile.v.isEtf || profile.v.isFund);
  const unknown = profile.done && !profile.v;

  // ETFs have no company financials / Form 4; unknown symbols skip the SEC round-trips too.
  const finP = isEtf ? Promise.resolve(null) : once(`f:${T}`, () => secLimit(() => loadFin(T)));
  const insP = isEtf || unknown ? Promise.resolve(null) : once(`i:${T}`, () => insiderLimit(async () => {
    const t0 = Date.now();
    try { return await loadInsider(T); } finally {
      // after a real SEC round-trip (not a cache hit), breathe before the next ticker's ~20 Form 4 requests
      if (Date.now() - t0 > 400) await new Promise((r) => setTimeout(r, 1000));
    }
  }));
  const [hist, fin, ins] = await Promise.all([soft(histP, deadline), soft(finP, deadline), soft(insP, deadline)]);

  let fmp: Soft<FmpMetrics | null> = { done: true, v: null };
  if (fin.done && !fin.v && !isEtf && profile.done && profile.v) {
    fmp = await soft(once(`m:${T}`, () => fmpLimit(() => getFmpMetrics(T))), deadline);
  }
  let fmpGrowth: Soft<number | null> = { done: true, v: null };
  if (fin.done && fin.v && !isEtf && revenueGrowthFrom(fin.v.annual, fin.v.quarterly).value == null) {
    fmpGrowth = await soft(once(`g:${T}`, () => fmpLimit(() => getFmpRevenueGrowth(T))), deadline);
  }

  const bars = hist.done && hist.v && !hist.v.meta.isMock ? hist.v.data : [];
  const closes = bars.map((b) => b.close).filter((c) => Number.isFinite(c)).slice(-30);
  return {
    ticker: T,
    profile: profile.done ? profile.v : null,
    profileDone: profile.done,
    fin: fin.done ? fin.v : null,
    fmp: fmp.done ? fmp.v : null,
    fmpGrowth: fmpGrowth.done ? fmpGrowth.v : null,
    insider: ins.done ? ins.v : null,
    sparkline: closes,
    lastClose: closes.at(-1) ?? null,
    complete: profile.done && hist.done && fin.done && ins.done && fmp.done && fmpGrowth.done,
  };
}

function store(T: string, s: Static) {
  cache.set(`screener:live:${T}`, s, s.complete ? ROW_TTL : PARTIAL_TTL);
  cache.set(`screener:live:stale:${T}`, s, STALE_TTL);
}

/**
 * Fresh row → return it. Expired but seen in the last 30 min → return the stale row at once and rebuild in the
 * background (with a generous deadline so it completes). Never seen → build now, racing the request deadline.
 */
async function getStatic(T: string, deadline: number): Promise<{ s: Static; hit: boolean }> {
  const hit = cache.get<Static>(`screener:live:${T}`);
  if (hit) return { s: hit, hit: true };
  const stale = cache.get<Static>(`screener:live:stale:${T}`);
  if (stale) {
    void once(`s:${T}`, () => buildStatic(T, Date.now() + BACKGROUND_DEADLINE_MS)).then((s) => store(T, s), () => undefined);
    return { s: stale, hit: true };
  }
  const s = await once(`s:${T}`, () => buildStatic(T, deadline));
  store(T, s);
  return { s, hit: false };
}

// ───────────────────────────── shared lookups ─────────────────────────────

async function earningsMap(tickers: string[], today: string): Promise<Map<string, { date: string; source: SourceRef }>> {
  const key = `screener:earnings:${today}:${[...tickers].sort().join(',')}`;
  return cache.wrap(key, async () => {
    const m = new Map<string, { date: string; source: SourceRef }>();
    const r = await getCalendarEvents({ categories: ['earnings'], watchlist: tickers, from: today });
    for (const e of r.events) {
      if (!e.ticker || e.category !== 'earnings') continue;
      if (e.source.name.toLowerCase().includes('demo')) continue; // never surface mock-estimated dates
      const T = e.ticker.toUpperCase();
      if (m.has(T)) continue; // events are date-sorted: first = next
      m.set(T, {
        date: e.date,
        source: { id: `cal:${T}:${e.date}`, name: `${T} earnings ${e.date}${e.estimated ? ' (estimated)' : ''} · ${e.source.name}`, url: e.source.url ?? 'https://www.alphavantage.co/documentation/#earnings-calendar', kind: 'estimate' },
      });
    }
    return m;
  }, CAL_TTL);
}

/** EPS revision only from estimates the app has already fetched (composite cache) — never spends AV quota here. */
function cachedEstimates(T: string): Estimates | null {
  const hit = cache.get<{ data: Estimates | null; meta: DataMeta }>(`md:getEstimates:${JSON.stringify([T])}`);
  return hit && !hit.meta.isMock ? hit.data : null;
}

// ───────────────────────────── assembly ─────────────────────────────

function assemble(s: Static, quote: Quote | undefined, earn: { date: string; source: SourceRef } | undefined, group: string | undefined, today: Date): ScreenResultRow {
  const p = s.profile;
  const isEtf = !!p && (p.isEtf || p.isFund);
  const price = quote?.price ?? s.lastClose ?? null;
  const changePct = quote ? quote.changePct : null;
  const lastQ = s.fin?.quarterly.at(-1) ?? s.fin?.annual.at(-1);
  const shares = !isEtf && lastQ?.sharesOutstanding && lastQ.sharesOutstanding > 0 ? lastQ.sharesOutstanding : null;
  const marketCap = (shares && price ? shares * price : null) ?? p?.marketCap ?? (quote?.marketCap || null);

  let pe: number | null = null;
  let evEbitda: number | null = null;
  let revenueGrowth: number | null = null;
  let revenueBasis = '';
  if (s.fin) {
    const v = deriveValuation({ price, marketCap, annual: s.fin.annual, quarterly: s.fin.quarterly });
    pe = v.pe;
    // EV/EBITDA isn't meaningful for banks/insurers/brokers (debt is operating funding), so it's left blank there.
    evEbitda = p && mapFmpSector(p.sector) === 'Financials' && !/credit services|payment|data|software/i.test(p.industry) ? null : v.evEbitda;
    const g = revenueGrowthFrom(s.fin.annual, s.fin.quarterly);
    revenueGrowth = g.value ?? s.fmpGrowth ?? null;
    revenueBasis = g.value != null ? g.basis : s.fmpGrowth != null ? 'latest FY, FMP' : g.basis;
  } else if (s.fmp) {
    pe = s.fmp.pe;
    evEbitda = s.fmp.evEbitda;
    revenueGrowth = s.fmp.revenueGrowth;
    revenueBasis = 'latest FY, FMP';
  }
  const epsRevision30d = isEtf ? null : epsRevision30dFrom(cachedEstimates(s.ticker), today);
  const nextEarnings = isEtf ? '' : earn?.date ?? '';
  const inDays = nextEarnings ? daysUntil(nextEarnings, today) : NaN;
  const insider = s.insider ? s.insider.net : null;

  const notFound = !quote && s.profileDone && !p && !s.sparkline.length;
  const sources: SourceRef[] = [];
  if (quote) sources.push({ id: `alpaca:snapshot:${s.ticker}`, name: `${s.ticker} last trade (Alpaca, IEX feed)`, url: 'https://alpaca.markets/data', kind: 'price', excerpt: `As of ${quote.ts.slice(0, 19).replace('T', ' ')} UTC` });
  if (s.fin?.source) sources.push(s.fin.source);
  if (s.insider) sources.push(...s.insider.sources);
  if (earn) sources.push(earn.source);
  if (p) sources.push({ id: `fmp:profile:${s.ticker}`, name: `${s.ticker} company profile (Financial Modeling Prep)`, url: FMP_PROFILE_URL(s.ticker), kind: 'estimate' });

  const why = notFound
    ? { headline: 'Ticker not found at Alpaca or FMP — check the symbol', estimateChange: '—', risk: '—' }
    : buildWhyNow({ ticker: s.ticker, isEtf, changePct, revenueGrowth, revenueBasis, insiderBuying90d: insider, nextEarnings, earningsInDays: inDays, pe, epsRevision30d });

  return {
    ticker: s.ticker,
    name: notFound ? 'Not found' : p?.companyName || s.ticker,
    sector: notFound ? UNKNOWN_SECTOR : p ? mapFmpSector(p.sector, isEtf) : UNKNOWN_SECTOR,
    industry: isEtf ? 'Exchange-traded fund' : p?.industry || '—',
    country: p?.country || '—',
    marketCap,
    price,
    changePct,
    pe,
    evEbitda,
    revenueGrowth,
    epsRevision30d,
    shortInterestPct: null,
    insiderBuying90d: insider,
    esgScore: null,
    nextEarnings,
    catalystFlags: Number.isFinite(inDays) && inDays >= 0 && inDays <= 45 ? ['earnings'] : [],
    sparkline: s.sparkline,
    whyNow: { ...why, sourceIds: sources.map((x) => x.id) },
    whyNowSources: sources,
    group: group ?? null,
    status: notFound ? 'not_found' : s.complete ? 'ok' : 'partial',
    isEtf,
  };
}

export interface LiveRowsResult { rows: ScreenResultRow[]; meta: DataMeta; cached: boolean; pending: string[] }

/** Build rows for `tickers` (already validated). Never throws; unknown tickers come back as status 'not_found'. */
export async function getLiveRows(tickers: string[], groups: Record<string, string> = {}): Promise<LiveRowsResult> {
  const now = new Date();
  if (process.env.ALPHADESK_FORCE_MOCK === '1') return mockRows(tickers, groups);
  const deadline = Date.now() + DEADLINE_MS;
  const md = getMarketData();
  const todayIso = now.toISOString().slice(0, 10);
  const [quotes, earn, statics] = await Promise.all([
    soft(md.getQuotes(tickers), deadline),
    soft(earningsMap(tickers, todayIso), deadline),
    Promise.all(tickers.map((t) => getStatic(t, deadline))),
  ]);
  const qmap = new Map<string, Quote>();
  if (quotes.done && quotes.v) for (const q of quotes.v.data) qmap.set(q.ticker, q);
  // a quote served by the mock fallback is not a real price (the composite caches each ticker's quote with its meta)
  if (quotes.done && quotes.v?.meta.isMock) {
    for (const t of tickers) {
      const e = cache.get<{ meta: DataMeta }>(`md:getQuote:${JSON.stringify([t])}`);
      if (!e || e.meta.isMock) qmap.delete(t);
    }
  }
  const emap = earn.done && earn.v ? earn.v : new Map();
  const rows = statics.map(({ s }) => assemble(s, qmap.get(s.ticker), emap.get(s.ticker), groups[s.ticker], now));
  const pending = rows.filter((r) => r.status === 'partial').map((r) => r.ticker);
  return {
    rows,
    cached: statics.every((x) => x.hit),
    pending,
    meta: { source: LIVE_SOURCES, isMock: false, asOf: now.toISOString(), provider: 'Alpaca · SEC EDGAR · FMP · Alpha Vantage' },
  };
}

/** Demo mode (ALPHADESK_FORCE_MOCK=1): the seeded universe, filtered to the list. Labelled mock. */
async function mockRows(tickers: string[], groups: Record<string, string>): Promise<LiveRowsResult> {
  const { data, meta } = await getMarketData().getScreenRows();
  const by = new Map(data.map((r) => [r.ticker, r]));
  const rows: ScreenResultRow[] = tickers.map((t) => {
    const r = by.get(t);
    if (!r) {
      return {
        ticker: t, name: 'Not found', sector: UNKNOWN_SECTOR, industry: '—', country: '—', marketCap: null, price: null, changePct: null, pe: null, evEbitda: null,
        revenueGrowth: null, epsRevision30d: null, shortInterestPct: null, insiderBuying90d: null, esgScore: null, nextEarnings: '', catalystFlags: [], sparkline: [],
        whyNow: { headline: 'Not in the demo universe', estimateChange: '—', risk: '—', sourceIds: [] }, whyNowSources: [], group: groups[t] ?? null, status: 'not_found',
      };
    }
    return { ...r, group: groups[t] ?? null, status: 'ok', whyNowSources: (r.whyNow?.sourceIds ?? []).map((id) => resolveMockSource(id) ?? { id, name: id, kind: 'mock' as const }) };
  });
  return { rows, meta, cached: true, pending: [] };
}

export { FUND_SECTOR };
