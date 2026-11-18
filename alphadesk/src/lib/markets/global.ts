import 'server-only';
import { getMarketData } from '@/lib/data';
import { getIndexHistory, getIndexQuote } from '@/lib/data/fmp';
import { fredHistory, fredLatest } from './fred';

/**
 * Global markets shown on the home page, the market ticker and /markets/[slug].
 * Indices use real index levels (FMP live → FRED close); the S&P 100 level isn't free so it falls back to OEF.
 * Commodities: COMEX gold and ICE Brent futures from FMP, WTI spot from FRED, ETF only as a last resort; yields from FRED.
 */
export type MarketDef =
  | { slug: string; kind: 'index'; label: string; short: string; fmp?: string; fred?: string; etf: string; news: string }
  | { slug: string; kind: 'commodity'; label: string; short: string; fmp?: string; fred?: string; etf: string; news: string }
  | { slug: string; kind: 'yield'; label: string; short: string; fred: string; news: string };

export const MARKETS: MarketDef[] = [
  { slug: 'sp500', kind: 'index', label: 'S&P 500', short: 'S&P 500', fmp: '^GSPC', fred: 'SP500', etf: 'SPY', news: 'S&P 500' },
  { slug: 'sp100', kind: 'index', label: 'S&P 100', short: 'S&P 100', etf: 'OEF', news: 'S&P 100 OR "mega-cap stocks"' },
  { slug: 'nasdaq', kind: 'index', label: 'Nasdaq Composite', short: 'Nasdaq', fmp: '^IXIC', fred: 'NASDAQCOM', etf: 'ONEQ', news: 'Nasdaq Composite' },
  { slug: 'nasdaq100', kind: 'index', label: 'Nasdaq 100', short: 'Nasdaq 100', fmp: '^NDX', fred: 'NASDAQ100', etf: 'QQQ', news: 'Nasdaq 100' },
  { slug: 'dow', kind: 'index', label: 'Dow Jones Industrial Avg', short: 'Dow', fmp: '^DJI', fred: 'DJIA', etf: 'DIA', news: 'Dow Jones Industrial Average' },
  { slug: 'brent', kind: 'commodity', label: 'Brent crude (ICE)', short: 'Brent', fmp: 'BZUSD', etf: 'BNO', news: 'Brent crude oil price' },
  { slug: 'wti', kind: 'commodity', label: 'US oil (WTI spot)', short: 'WTI', fred: 'DCOILWTICO', etf: 'USO', news: 'WTI crude oil price' },
  { slug: 'gold', kind: 'commodity', label: 'Gold (COMEX)', short: 'Gold COMEX', fmp: 'GCUSD', etf: 'GLD', news: 'COMEX gold futures price' },
  { slug: 'us10y', kind: 'yield', label: 'US 10-yr yield', short: 'US 10Y', fred: 'DGS10', news: '10-year Treasury yield' },
  { slug: 'us30y', kind: 'yield', label: 'US 30-yr yield', short: 'US 30Y', fred: 'DGS30', news: '30-year Treasury yield' },
];

export const marketBySlug = (slug: string) => MARKETS.find((m) => m.slug === slug);

export interface MarketTile {
  slug: string; label: string; short: string; code: string; kind: MarketDef['kind'];
  value: number | null; change: number | null; changePct: number | null;
  /** 'bp' for yields (change in basis points), otherwise price units */
  unit: 'price' | 'pct-yield';
  note: string; sourceName: string; sourceUrl?: string; asOf?: string;
  /** recent closes, oldest → newest */
  spark: number[];
}

export async function getMarketTiles(): Promise<{ tiles: MarketTile[]; etfProvider: string; asOf: string }> {
  const md = getMarketData();
  const etfs = Array.from(new Set(MARKETS.flatMap((m) => (m.kind === 'yield' ? [] : [m.etf]))));
  const q = await md.getQuotes(etfs);
  const quote = Object.fromEntries(q.data.map((x) => [x.ticker, x]));
  const tiles = await Promise.all(MARKETS.map(async (m): Promise<MarketTile> => {
    const base = { slug: m.slug, label: m.label, short: m.short, kind: m.kind };
    if (m.kind === 'yield') {
      const [y, h] = await Promise.all([fredLatest(m.fred), fredHistory(m.fred)]);
      return { ...base, code: m.fred, value: y?.value ?? null, change: y ? y.change * 100 : null, changePct: y ? (y.change / (y.value - y.change || 1)) * 100 : null, unit: 'pct-yield',
        note: y ? `FRED close ${y.date}` : 'FRED unavailable', sourceName: 'FRED', sourceUrl: `https://fred.stlouisfed.org/series/${m.fred}`, asOf: y?.date, spark: h.map((p) => p.value) };
    }
    if (m.kind === 'index' || m.kind === 'commodity') {
      const live = m.fmp ? await getIndexQuote(m.fmp) : null;
      if (live) {
        const h = await getIndexHistory(m.fmp!);
        return { ...base, code: m.fmp!, value: live.price, change: live.change, changePct: live.changePct, unit: 'price', note: m.kind === 'index' ? 'Index · live' : 'Futures · live', sourceName: 'FMP', sourceUrl: 'https://site.financialmodelingprep.com', asOf: live.ts, spark: h.map((p) => p.close) };
      }
      if (m.fred) {
        const [c, h] = await Promise.all([fredLatest(m.fred), fredHistory(m.fred)]);
        if (c) {
          const prev = c.value - c.change;
          return { ...base, code: m.fred, value: c.value, change: c.change, changePct: prev ? (c.change / prev) * 100 : 0, unit: 'price', note: `${m.kind === 'index' ? 'Index' : 'Spot'} · close ${c.date}`, sourceName: 'FRED', sourceUrl: `https://fred.stlouisfed.org/series/${m.fred}`, asOf: c.date, spark: h.map((p) => p.value) };
        }
      }
    }
    // ETF fallback (commodities, and indices without a free level)
    const t = m.etf;
    const [x, h] = [quote[t], await md.getHistory(t, '1M').catch(() => null)];
    return { ...base, code: t, value: x?.price ?? null, change: x?.change ?? null, changePct: x?.changePct ?? null, unit: 'price',
      note: m.kind === 'index' ? `${t} ETF (index level needs a paid feed)` : `${t} ETF proxy`, sourceName: q.meta.provider || 'market data', asOf: x?.ts, spark: (h?.data ?? []).map((b) => b.close) };
  }));
  return { tiles, etfProvider: q.meta.provider || 'market data', asOf: q.meta.asOf };
}
