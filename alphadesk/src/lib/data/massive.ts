import 'server-only';
import type {
  Bar, FinancialPeriod, Financials, FinancialStatementRow, GicsSector, HistoryRange, NewsItem, PartialProvider, Profile, Quote, SourceRef, WithMeta,
} from './types';
import { MOCK_BY_TICKER } from './mock/universe';
import { log } from '../log';

/**
 * Massive (formerly Polygon.io) REST adapter. Active only when MASSIVE_API_KEY (or legacy POLYGON_API_KEY) is set.
 * Auth via `Authorization: Bearer` header (never as a query param) so the key never appears in URLs/logs.
 * Host fallback: https://api.massive.com -> https://api.polygon.io. 8s timeout per request.
 */
const NAME = 'Massive (Polygon)';
const HOSTS = ['https://api.massive.com', 'https://api.polygon.io'];
const TIMEOUT_MS = 8000;

export function massiveKey(): string | undefined {
  return process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || undefined;
}
export function massiveEnabled(): boolean {
  return !!massiveKey() && process.env.ALPHADESK_FORCE_MOCK !== '1';
}

let preferredHost = 0;

async function get<T>(path: string): Promise<T> {
  const key = massiveKey();
  if (!key) throw new Error('massive: not configured');
  let lastErr: unknown;
  for (let i = 0; i < HOSTS.length; i++) {
    const hostIdx = (preferredHost + i) % HOSTS.length;
    const host = HOSTS[hostIdx];
    try {
      const res = await fetch(host + path, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
      if (res.status >= 500) {
        lastErr = new Error(`massive: HTTP ${res.status} from ${new URL(host).host}`);
        continue;
      }
      if (!res.ok) throw new Error(`massive: HTTP ${res.status} for ${path.split('?')[0]}`);
      preferredHost = hostIdx;
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      log.debug('massive.host_failed', { host: new URL(host).host, path: path.split('?')[0], err: (e as Error).message });
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('massive: request failed');
}

const meta = (sources: SourceRef[]) => ({ source: sources, isMock: false, asOf: new Date().toISOString(), provider: NAME });
const src = (id: string, name: string, kind: SourceRef['kind'] = 'price'): SourceRef => ({ id, name, kind });
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function rangeFrom(range: HistoryRange): string {
  const now = new Date();
  const d = new Date(now);
  switch (range) {
    case '1M': d.setUTCMonth(d.getUTCMonth() - 1); break;
    case '3M': d.setUTCMonth(d.getUTCMonth() - 3); break;
    case '6M': d.setUTCMonth(d.getUTCMonth() - 6); break;
    case 'YTD': return `${now.getUTCFullYear()}-01-01`;
    case '1Y': d.setUTCFullYear(d.getUTCFullYear() - 1); break;
    case '5Y': d.setUTCFullYear(d.getUTCFullYear() - 5); break;
    default: d.setUTCFullYear(d.getUTCFullYear() - 30);
  }
  return ymd(d);
}

interface Snapshot {
  ticker?: { ticker: string; todaysChange: number; todaysChangePerc: number; updated: number; day: { o: number; h: number; l: number; c: number; v: number }; prevDay: { c: number }; lastTrade?: { p: number } };
}

export const massiveProvider: PartialProvider = {
  name: NAME,

  async getQuote(t: string): Promise<WithMeta<Quote | null>> {
    const T = t.toUpperCase();
    const j = await get<Snapshot>(`/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(T)}`);
    const s = j.ticker;
    if (!s) return { data: null, meta: meta([]) };
    const price = s.lastTrade?.p || s.day.c || s.prevDay.c;
    const m = MOCK_BY_TICKER[T];
    return {
      data: {
        ticker: T, price, change: s.todaysChange, changePct: s.todaysChangePerc, open: s.day.o, high: s.day.h, low: s.day.l,
        prevClose: s.prevDay.c, volume: s.day.v, marketCap: m ? Math.round(((m.mcapB * 1e9) / m.price) * price) : 0,
        ts: new Date(Math.floor((s.updated || Date.now() * 1e6) / 1e6)).toISOString(),
      },
      meta: meta([src(`massive:snapshot:${T}`, `${T} snapshot (Massive)`)]),
    };
  },

  async getQuotes(ts: string[]): Promise<WithMeta<Quote[]>> {
    const list = ts.map((t) => t.toUpperCase()).join(',');
    const j = await get<{ tickers?: NonNullable<Snapshot['ticker']>[] }>(`/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${encodeURIComponent(list)}`);
    const data: Quote[] = (j.tickers ?? []).map((s) => {
      const price = s.lastTrade?.p || s.day.c || s.prevDay.c;
      const m = MOCK_BY_TICKER[s.ticker];
      return {
        ticker: s.ticker, price, change: s.todaysChange, changePct: s.todaysChangePerc, open: s.day.o, high: s.day.h, low: s.day.l,
        prevClose: s.prevDay.c, volume: s.day.v, marketCap: m ? Math.round(((m.mcapB * 1e9) / m.price) * price) : 0,
        ts: new Date(Math.floor((s.updated || Date.now() * 1e6) / 1e6)).toISOString(),
      };
    });
    return { data, meta: meta([src('massive:snapshot', 'Snapshots (Massive)')]) };
  },

  async getHistory(t: string, range: HistoryRange): Promise<WithMeta<Bar[]>> {
    const T = t.toUpperCase();
    const j = await get<{ results?: { t: number; o: number; h: number; l: number; c: number; v: number }[] }>(
      `/v2/aggs/ticker/${encodeURIComponent(T)}/range/1/day/${rangeFrom(range)}/${ymd(new Date())}?adjusted=true&sort=asc&limit=50000`,
    );
    const data = (j.results ?? []).map((r) => ({ date: ymd(new Date(r.t)), open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }));
    return { data, meta: meta([src(`massive:aggs:${T}`, `${T} daily aggregates (Massive)`)]) };
  },

  async getProfile(t: string): Promise<WithMeta<Profile | null>> {
    const T = t.toUpperCase();
    const j = await get<{ results?: { name: string; description?: string; market_cap?: number; total_employees?: number; homepage_url?: string; list_date?: string; primary_exchange?: string; cik?: string; sic_description?: string; share_class_shares_outstanding?: number; weighted_shares_outstanding?: number; address?: { city?: string; state?: string } } }>(
      `/v3/reference/tickers/${encodeURIComponent(T)}`,
    );
    const r = j.results;
    if (!r) return { data: null, meta: meta([]) };
    const m = MOCK_BY_TICKER[T];
    const sector: GicsSector = m?.sector ?? 'Industrials';
    return {
      data: {
        ticker: T, name: r.name, sector, industry: r.sic_description ?? m?.industry ?? '', country: m?.country ?? 'US', exchange: r.primary_exchange ?? '',
        description: r.description ?? '', employees: r.total_employees ?? 0, founded: r.list_date ? Number(r.list_date.slice(0, 4)) : 0,
        hq: [r.address?.city, r.address?.state].filter(Boolean).join(', '), website: r.homepage_url ?? '', ceo: m?.ceo ?? '', cik: r.cik,
        marketCap: r.market_cap ?? 0, sharesOutstanding: r.weighted_shares_outstanding ?? r.share_class_shares_outstanding ?? 0,
        beta: m?.beta ?? 1, dividendYield: m?.divYield ?? 0, pe: m?.pe ?? 0, forwardPe: 0, evEbitda: m?.evEbitda ?? 0, priceToSales: 0, week52High: 0, week52Low: 0,
      },
      meta: meta([src(`massive:ref:${T}`, `${T} reference data (Massive)`, 'filing')]),
    };
  },

  async getFinancials(t: string, period: FinancialPeriod): Promise<WithMeta<Financials | null>> {
    const T = t.toUpperCase();
    type V = { value?: number } | undefined;
    const j = await get<{ results?: { fiscal_year: string; fiscal_period: string; end_date: string; financials: Record<string, Record<string, V>> }[] }>(
      `/vX/reference/financials?ticker=${encodeURIComponent(T)}&timeframe=${period === 'annual' ? 'annual' : 'quarterly'}&limit=${period === 'annual' ? 40 : 16}&order=desc&sort=period_of_report_date`,
    );
    const res = j.results ?? [];
    if (!res.length) return { data: null, meta: meta([]) };
    const rows: FinancialStatementRow[] = res.map((r) => {
      const f = r.financials;
      const v = (s: string, k: string) => f[s]?.[k]?.value ?? 0;
      const revenue = v('income_statement', 'revenues');
      const grossProfit = v('income_statement', 'gross_profit');
      const operatingIncome = v('income_statement', 'operating_income_loss');
      const netIncome = v('income_statement', 'net_income_loss');
      const assets = v('balance_sheet', 'assets');
      const liabilities = v('balance_sheet', 'liabilities');
      const ocf = v('cash_flow_statement', 'net_cash_flow_from_operating_activities');
      const capex = 0; // capex not broken out in this endpoint
      const pct = (a: number) => (revenue ? Math.round((a / revenue) * 1000) / 10 : 0);
      return {
        fiscalYear: Number(r.fiscal_year), fiscalPeriod: r.fiscal_period, periodEnd: r.end_date, revenue, grossProfit, operatingIncome, netIncome,
        ebitda: operatingIncome, eps: v('income_statement', 'diluted_earnings_per_share') || v('income_statement', 'basic_earnings_per_share'),
        totalAssets: assets, totalLiabilities: liabilities, totalEquity: v('balance_sheet', 'equity') || assets - liabilities,
        cash: v('balance_sheet', 'cash'), totalDebt: v('balance_sheet', 'long_term_debt'), operatingCashFlow: ocf, capex, freeCashFlow: ocf - capex,
        sharesOutstanding: v('income_statement', 'diluted_average_shares'), grossMargin: pct(grossProfit), operatingMargin: pct(operatingIncome), netMargin: pct(netIncome),
        sourceId: `massive:financials:${T}:${r.fiscal_year}${r.fiscal_period}`,
      };
    }).reverse();
    return { data: { ticker: T, period, currency: 'USD', rows }, meta: meta([src(`massive:financials:${T}`, `${T} financials (Massive, from SEC XBRL)`, 'filing')]) };
  },

  async getNews(t?: string): Promise<WithMeta<NewsItem[]>> {
    const q = t ? `ticker=${encodeURIComponent(t.toUpperCase())}&` : '';
    const j = await get<{ results?: { id: string; title: string; description?: string; article_url: string; published_utc: string; tickers?: string[]; publisher?: { name?: string }; insights?: { sentiment?: string }[] }[] }>(
      `/v2/reference/news?${q}limit=30&order=desc&sort=published_utc`,
    );
    const data: NewsItem[] = (j.results ?? []).map((n) => ({
      id: `massive:news:${n.id}`, ticker: t?.toUpperCase() ?? n.tickers?.[0], tickers: n.tickers ?? [], title: n.title, summary: n.description,
      publisher: n.publisher?.name ?? 'Unknown', url: n.article_url, publishedAt: n.published_utc,
      sentiment: (['positive', 'neutral', 'negative'] as const).find((s) => s === n.insights?.[0]?.sentiment),
    }));
    return { data, meta: meta(data.slice(0, 5).map((n) => ({ id: n.id, name: `${n.publisher}: ${n.title}`, url: n.url, kind: 'news' as const }))) };
  },
};
