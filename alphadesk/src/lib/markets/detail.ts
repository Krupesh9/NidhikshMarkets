import 'server-only';
import { cache } from '@/lib/cache';
import { log } from '@/lib/log';
import { meteredFetch } from '@/lib/usage-meter';
import { getMarketData } from '@/lib/data';
import type { HistoryRange, NewsItem, Quote } from '@/lib/data/types';
import { getIndexHistory, getIndexQuote, FMP_SITE } from '@/lib/data/fmp';
import { getHeadlines } from '@/lib/news';
import { parseFeed } from '@/lib/news/rss';
import { dedupeNews, googlePublisher, hashId, sortNewest, stripPublisherSuffix } from '@/lib/news/match';
import { getCalendarEvents, type CalendarEvent } from '@/lib/calendar';
import { todayET, addDays } from '@/lib/calendar/dates';
import { fredHistory, fredLatest } from './fred';
import type { MarketDef } from './global';

/** Data for /markets/[slug]: headline level, chart history, commodity / yield stats, news and macro dates. Never throws. */

export type ChartRange = '1M' | '3M' | '1Y' | '5Y';
export const CHART_RANGES: ChartRange[] = ['1M', '3M', '1Y', '5Y'];
const RANGE_DAYS: Record<ChartRange, number> = { '1M': 31, '3M': 92, '1Y': 366, '5Y': 1830 };
/** approx trading days per range (FRED returns observations, not calendar days) */
const RANGE_POINTS: Record<ChartRange, number> = { '1M': 22, '3M': 64, '1Y': 252, '5Y': 1260 };

export interface SourceLink { name: string; url?: string }

export interface MarketSnapshot {
  value: number | null;
  change: number | null;
  changePct: number | null;
  /** 'yield' values are percents and changes are in basis points */
  unit: 'price' | 'yield';
  asOf: string | null;
  code: string;
  note: string;
  source: SourceLink;
}

const fred = (series: string): SourceLink => ({ name: 'FRED', url: `https://fred.stlouisfed.org/series/${series}` });
const FMP: SourceLink = { name: 'FMP', url: FMP_SITE };

export async function getMarketSnapshot(m: MarketDef): Promise<MarketSnapshot> {
  try {
    if (m.kind === 'yield') {
      const y = await fredLatest(m.fred);
      return { value: y?.value ?? null, change: y ? y.change * 100 : null, changePct: null, unit: 'yield', asOf: y?.date ?? null, code: m.fred, note: y ? 'Treasury constant-maturity yield, daily close' : 'FRED unavailable', source: fred(m.fred) };
    }
    // Indices and commodities: live FMP quote (index level / futures) → FRED close → ETF fallback.
    const what = m.kind === 'index' ? 'Index level' : m.slug === 'gold' ? 'COMEX gold futures' : m.slug === 'brent' ? 'ICE Brent futures' : 'Futures';
    const live = m.fmp ? await getIndexQuote(m.fmp) : null;
    if (live) return { value: live.price, change: live.change, changePct: live.changePct, unit: 'price', asOf: live.ts, code: m.fmp!, note: `${what} · live`, source: FMP };
    if (m.fred) {
      const c = await fredLatest(m.fred);
      if (c) {
        const prev = c.value - c.change;
        const kindNote = m.kind === 'index' ? 'Index close' : 'Spot price, daily close';
        return { value: c.value, change: c.change, changePct: prev ? (c.change / prev) * 100 : 0, unit: 'price', asOf: c.date, code: m.fred, note: `${kindNote}${m.kind === 'index' ? '' : ' (FRED lags a few days)'}`, source: fred(m.fred) };
      }
    }
    const q = await getMarketData().getQuote(m.etf);
    const x = q.data;
    return {
      value: x?.price ?? null, change: x?.change ?? null, changePct: x?.changePct ?? null, unit: 'price', asOf: x?.ts ?? null, code: m.etf,
      note: m.kind === 'index' ? `${m.etf} ETF price (index level needs a paid feed)` : `${m.etf} ETF proxy (futures / spot feed unavailable)`,
      source: { name: q.meta.provider || 'market data', url: q.meta.source[0]?.url },
    };
  } catch (e) {
    log.debug('markets.snapshot_failed', { slug: m.slug, err: (e as Error).message });
    return { value: null, change: null, changePct: null, unit: m.kind === 'yield' ? 'yield' : 'price', asOf: null, code: m.slug, note: 'unavailable', source: { name: '—' } };
  }
}

export interface HistoryPoint { date: string; value: number }
export interface MarketHistory { range: ChartRange; points: HistoryPoint[]; unit: 'price' | 'yield'; source: SourceLink; note: string; isMock?: boolean }

export async function getMarketHistory(m: MarketDef, range: ChartRange): Promise<MarketHistory> {
  return cache.wrap(`markets:hist:${m.slug}:${range}`, async () => {
    try {
      if (m.kind === 'yield') {
        const h = await fredHistory(m.fred, RANGE_POINTS[range]);
        return { range, points: h, unit: 'yield' as const, source: fred(m.fred), note: `${m.fred} daily close, %` };
      }
      if (m.fmp) {
        const h = await getIndexHistory(m.fmp, RANGE_DAYS[range]);
        if (h.length > 2) return { range, points: h.map((p) => ({ date: p.date, value: p.close })), unit: 'price' as const, source: FMP, note: `${m.fmp} ${m.kind === 'index' ? 'index level' : 'futures'}, daily close` };
      }
      if (m.fred) {
        const h = await fredHistory(m.fred, RANGE_POINTS[range]);
        if (h.length > 2) return { range, points: h, unit: 'price' as const, source: fred(m.fred), note: `${m.fred} ${m.kind === 'index' ? 'index level' : 'spot price'}, daily close` };
      }
      const r = await getMarketData().getHistory(m.etf, range as HistoryRange);
      return {
        range, points: r.data.map((b) => ({ date: b.date, value: b.close })), unit: 'price' as const,
        source: { name: r.meta.provider || 'market data', url: r.meta.source[0]?.url }, isMock: r.meta.isMock,
        note: `${m.etf} ETF${m.kind === 'commodity' ? ' proxy' : ''}, daily close`,
      };
    } catch (e) {
      log.debug('markets.history_failed', { slug: m.slug, err: (e as Error).message });
      return { range, points: [], unit: m.kind === 'yield' ? 'yield' as const : 'price' as const, source: { name: '—' }, note: 'unavailable' };
    }
  }, 10 * 60_000);
}

/* ------------------------------- commodity stats ------------------------------ */

export interface RangeStats {
  dayLow: number | null; dayHigh: number | null;
  low52: number | null; high52: number | null;
  /** % (prices) or bp (yields) */
  chg1M: number | null; chg3M: number | null; chgYTD: number | null; chg1Y: number | null;
  last: number | null; asOf: string | null;
}

/** Change stats from a daily series (oldest → newest). `mode` 'pct' for prices, 'bp' for yields (percent units). */
export function seriesStats(points: HistoryPoint[], mode: 'pct' | 'bp', today = new Date()): Omit<RangeStats, 'dayLow' | 'dayHigh'> {
  if (!points.length) return { low52: null, high52: null, chg1M: null, chg3M: null, chgYTD: null, chg1Y: null, last: null, asOf: null };
  const last = points[points.length - 1];
  const lastT = Date.parse(last.date);
  const yearAgo = lastT - 365 * 86_400_000;
  const in52 = points.filter((p) => Date.parse(p.date) >= yearAgo);
  const at = (msBack: number) => {
    const t = lastT - msBack;
    let best: HistoryPoint | null = null;
    for (const p of points) { if (Date.parse(p.date) <= t) best = p; else break; }
    return best;
  };
  const diff = (p: HistoryPoint | null) => (!p ? null : mode === 'bp' ? (last.value - p.value) * 100 : p.value ? ((last.value - p.value) / p.value) * 100 : null);
  const y0 = `${today.getUTCFullYear()}-01-01`;
  const ytdBase = [...points].reverse().find((p) => p.date < y0) ?? null;
  const covers = (ms: number) => Date.parse(points[0].date) <= lastT - ms + 5 * 86_400_000;
  return {
    low52: Math.min(...in52.map((p) => p.value)),
    high52: Math.max(...in52.map((p) => p.value)),
    chg1M: diff(at(30 * 86_400_000)),
    chg3M: diff(at(91 * 86_400_000)),
    chgYTD: diff(ytdBase),
    chg1Y: covers(365 * 86_400_000) ? diff(at(365 * 86_400_000)) : null,
    last: last.value,
    asOf: last.date,
  };
}

export async function getRangeStats(m: MarketDef): Promise<{ stats: RangeStats; quote: Quote | null; source: SourceLink }> {
  const h = await getMarketHistory(m, '1Y');
  const s = seriesStats(h.points, m.kind === 'yield' ? 'bp' : 'pct');
  let quote: Quote | null = null;
  // Day range only exists for the ETF fallback (FMP/FRED series used here are close-only).
  if (m.kind === 'commodity' && !m.fmp && !m.fred) quote = (await getMarketData().getQuote(m.etf).catch(() => null))?.data ?? null;
  return { stats: { ...s, dayLow: quote?.low ?? null, dayHigh: quote?.high ?? null }, quote, source: h.source };
}

/* ------------------------------------ news ----------------------------------- */

/** Google News RSS search for a free-text query (last 2 days). Cached 10 min. */
export async function googleNewsSearch(query: string, limit = 20): Promise<NewsItem[]> {
  return cache.wrap(`markets:gnews:${query}`, async () => {
    try {
      const q = `${query} when:2d`;
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const r = await meteredFetch('news', url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; NidhikshPulse/1.0; research headlines)' }, cache: 'no-store', signal: AbortSignal.timeout(6_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parseFeed(await r.text()).filter((it) => it.publishedAt).slice(0, limit).map((it): NewsItem => {
        const publisher = googlePublisher(it.source, 'Google News');
        return { id: `gnq:${hashId(it.link)}`, tickers: [], title: stripPublisherSuffix(it.title, it.source ?? publisher), publisher, url: it.link, publishedAt: it.publishedAt! };
      });
    } catch (e) {
      log.debug('markets.gnews_failed', { query, err: (e as Error).message });
      return [];
    }
  }, 10 * 60_000);
}

const KEYWORDS: Record<string, RegExp> = {
  brent: /\b(crude|oil|opec\+?|brent|wti|barrel|petroleum|refiner)/i,
  wti: /\b(crude|oil|opec\+?|brent|wti|barrel|petroleum|refiner|shale)/i,
  gold: /\b(gold|bullion|precious metal|silver)/i,
  us10y: /\b(treasur(y|ies)|yields?|bonds?|fed|fomc|powell|rate cut|rate hike|inflation|cpi)\b/i,
  us30y: /\b(treasur(y|ies)|yields?|bonds?|fed|fomc|powell|rate cut|rate hike|inflation|cpi|long bond)\b/i,
};

export interface MarketNews { items: NewsItem[]; sources: string }

/** Related headlines: Google News search on the market's query + publisher feeds (keyword-filtered, or matching the top-10 tickers for indices). */
export async function getMarketNews(m: MarketDef, tickers: string[] = [], limit = 12): Promise<MarketNews> {
  try {
    const [search, feeds] = await Promise.all([
      googleNewsSearch(m.news),
      m.kind === 'index'
        ? getHeadlines({ tickers, limit: 12, onlyMatching: tickers.length > 0 })
        : getHeadlines({ limit: 200 }).then((all) => all.filter((n) => (KEYWORDS[m.slug] ?? /$^/).test(n.title))),
    ]);
    // Interleave so neither source crowds the other out, then dedupe + newest first.
    const mixed: NewsItem[] = [];
    for (let i = 0; i < Math.max(search.length, feeds.length); i++) { if (feeds[i]) mixed.push(feeds[i]); if (search[i]) mixed.push(search[i]); }
    // At most 2 headlines per lead ticker so one busy name (per-ticker feeds) can't fill the list.
    const perTicker = new Map<string, number>();
    const items = sortNewest(dedupeNews(mixed)).filter((n) => {
      const t = n.ticker ?? n.tickers[0];
      if (!t) return true;
      const c = (perTicker.get(t) ?? 0) + 1;
      perTicker.set(t, c);
      return c <= 2;
    }).slice(0, limit);
    const kinds = [search.length ? `Google News search “${m.news}”` : null, feeds.length ? (m.kind === 'index' ? 'publisher feeds mentioning the top holdings' : 'publisher feeds filtered by keyword') : null].filter(Boolean);
    return { items, sources: kinds.join(' + ') };
  } catch (e) {
    log.debug('markets.news_failed', { slug: m.slug, err: (e as Error).message });
    return { items: [], sources: '' };
  }
}

/* --------------------------------- macro dates -------------------------------- */

export async function getNextMacro(): Promise<{ fomc: CalendarEvent | null; cpi: CalendarEvent | null }> {
  try {
    const today = todayET();
    const { events } = await getCalendarEvents({ from: today, to: addDays(today, 120), categories: ['fed', 'inflation'] });
    const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
    return { fomc: sorted.find((e) => e.kind === 'fomc') ?? null, cpi: sorted.find((e) => e.kind === 'cpi') ?? null };
  } catch {
    return { fomc: null, cpi: null };
  }
}
