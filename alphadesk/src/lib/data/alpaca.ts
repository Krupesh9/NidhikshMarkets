import 'server-only';
import type { Bar, HistoryRange, PartialProvider, Quote, SourceRef, WithMeta } from './types';
import { isIntradayRange } from './types';
import { intradaySpec, intradayStart, isoMinute, lastSessions } from './intraday';
import { MOCK_BY_TICKER } from './mock/universe';
import { log } from '../log';

/**
 * Alpaca Market Data adapter (data API only — no trading/order endpoints are ever called).
 * Enabled when ALPACA_API_KEY + ALPACA_SECRET_KEY are set and ALPHADESK_FORCE_MOCK !== '1'.
 * Keys travel only in APCA-API-KEY-ID / APCA-API-SECRET-KEY headers, never in URLs or logs.
 *  - Quotes: /v2/stocks/snapshots (IEX feed — the free plan rejects recent SIP snapshots).
 *  - Bars: /v2/stocks/{sym}/bars on ALPACA_FEED (default sip; end is held 16 min back for SIP, per Alpaca's
 *    free-plan delay rule), adjustment=split, paginated via next_page_token.
 */
const NAME = 'Alpaca';
const BASE = 'https://data.alpaca.markets';
const TIMEOUT_MS = 8000;
const SIP_DELAY_MS = 16 * 60_000;

export function alpacaEnabled(): boolean {
  return !!process.env.ALPACA_API_KEY && !!process.env.ALPACA_SECRET_KEY && process.env.ALPHADESK_FORCE_MOCK !== '1';
}

const barFeed = () => ((process.env.ALPACA_FEED || 'sip').toLowerCase() === 'iex' ? 'iex' : 'sip');

async function get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  if (!alpacaEnabled()) throw new Error('alpaca: not configured');
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { 'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) {
    log.debug('alpaca.http_error', { path, status: res.status });
    throw new Error(`alpaca: HTTP ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

const meta = (source: SourceRef[], asOf?: string) => ({ source, isMock: false, asOf: asOf ?? new Date().toISOString(), provider: NAME });
const ymd = (d: Date) => d.toISOString().slice(0, 10);

interface RawBar { t: string; o: number; h: number; l: number; c: number; v: number }
interface Snapshot { latestTrade?: { p: number; t: string }; dailyBar?: RawBar; prevDailyBar?: RawBar; minuteBar?: RawBar }

/** Map an Alpaca snapshot into our Quote shape (exported for tests). */
export function snapshotToQuote(ticker: string, s: Snapshot): Quote | null {
  const price = s.latestTrade?.p ?? s.minuteBar?.c ?? s.dailyBar?.c;
  if (!price) return null;
  const prevClose = s.prevDailyBar?.c ?? s.dailyBar?.o ?? price;
  const change = price - prevClose;
  const m = MOCK_BY_TICKER[ticker];
  return {
    ticker, price, change: Math.round(change * 10000) / 10000, changePct: prevClose ? Math.round((change / prevClose) * 1e6) / 1e4 : 0,
    open: s.dailyBar?.o ?? price, high: s.dailyBar?.h ?? price, low: s.dailyBar?.l ?? price, prevClose, volume: s.dailyBar?.v ?? 0,
    // shares outstanding is not in Alpaca data; header derives market cap from profile/SEC shares when available
    marketCap: m ? Math.round(((m.mcapB * 1e9) / m.price) * price) : 0,
    ts: s.latestTrade?.t ?? s.minuteBar?.t ?? new Date().toISOString(),
  };
}

/** Meta for a single Alpaca quote (also used by the composite when it batches quotes). */
export const alpacaQuoteMeta = (q: Quote) => meta([quoteSrc(q.ticker, q.ts)], q.ts);

const quoteSrc = (t: string, ts?: string): SourceRef => ({
  id: `alpaca:snapshot:${t}`, name: `${t} last trade (Alpaca, IEX feed)`, kind: 'price', url: 'https://alpaca.markets/data',
  excerpt: `Last IEX trade vs previous daily close${ts ? `, as of ${ts.slice(0, 19).replace('T', ' ')} UTC` : ''}. Volume is IEX-venue volume (partial).`,
});

function dailyStart(range: HistoryRange): string {
  const d = new Date();
  switch (range) {
    case '1M': d.setUTCMonth(d.getUTCMonth() - 1); break;
    case '3M': d.setUTCMonth(d.getUTCMonth() - 3); break;
    case '6M': d.setUTCMonth(d.getUTCMonth() - 6); break;
    case 'YTD': return `${d.getUTCFullYear()}-01-01`;
    case '1Y': d.setUTCFullYear(d.getUTCFullYear() - 1); break;
    case '5Y': d.setUTCFullYear(d.getUTCFullYear() - 5); break;
    default: return '2000-01-01'; // MAX: Alpaca history begins 2016 for most symbols
  }
  return ymd(d);
}

async function fetchBars(sym: string, timeframe: string, start: string, end: string): Promise<RawBar[]> {
  const out: RawBar[] = [];
  let token: string | undefined;
  for (let page = 0; page < 20; page++) {
    const j = await get<{ bars: RawBar[] | null; next_page_token?: string | null }>(`/v2/stocks/${encodeURIComponent(sym)}/bars`, {
      timeframe, start, end, adjustment: 'split', feed: barFeed(), limit: 10000, sort: 'asc', page_token: token,
    });
    out.push(...(j.bars ?? []));
    token = j.next_page_token ?? undefined;
    if (!token) break;
  }
  return out;
}

export const alpacaProvider: PartialProvider = {
  name: NAME,

  async getQuote(t: string): Promise<WithMeta<Quote | null>> {
    const r = await alpacaProvider.getQuotes!([t]);
    const q = r.data[0] ?? null;
    return { data: q, meta: q ? alpacaQuoteMeta(q) : meta([]) };
  },

  async getQuotes(ts: string[]): Promise<WithMeta<Quote[]>> {
    const syms = Array.from(new Set(ts.map((t) => t.toUpperCase())));
    const data: Quote[] = [];
    for (let i = 0; i < syms.length; i += 100) {
      const chunk = syms.slice(i, i + 100);
      const j = await get<Record<string, Snapshot>>('/v2/stocks/snapshots', { symbols: chunk.join(','), feed: 'iex' });
      for (const s of chunk) {
        const q = j[s] ? snapshotToQuote(s, j[s]) : null;
        if (q) data.push(q);
      }
    }
    return { data, meta: meta(data.length ? [{ id: 'alpaca:snapshots', name: 'Snapshots (Alpaca, IEX feed)', kind: 'price', url: 'https://alpaca.markets/data' }] : []) };
  },

  async getHistory(t: string, range: HistoryRange): Promise<WithMeta<Bar[]>> {
    const T = t.toUpperCase();
    const end = new Date(Date.now() - (barFeed() === 'sip' ? SIP_DELAY_MS : 0)).toISOString();
    if (isIntradayRange(range)) {
      const spec = intradaySpec(range);
      const raw = await fetchBars(T, `${spec.minutes}Min`, intradayStart(range).toISOString(), end);
      const bars = lastSessions(raw.map((b) => ({ date: isoMinute(Date.parse(b.t)), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v })), spec.sessions);
      return {
        data: bars,
        meta: meta(bars.length ? [{ id: `alpaca:bars:${T}:${range}`, name: `${T} ${spec.minutes}-minute bars, regular session (Alpaca, ${barFeed().toUpperCase()} feed)`, kind: 'price', url: 'https://alpaca.markets/data' }] : [], bars.at(-1)?.date),
      };
    }
    const raw = await fetchBars(T, '1Day', dailyStart(range), end);
    // daily bars are stamped at 04:00/05:00Z of the session date → keep the date part
    const bars = raw.map((b) => ({ date: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
    return {
      data: bars,
      meta: meta(bars.length ? [{ id: `alpaca:bars:${T}`, name: `${T} daily bars, split-adjusted (Alpaca, ${barFeed().toUpperCase()} feed)`, kind: 'price', url: 'https://alpaca.markets/data' }] : []),
    };
  },
};
