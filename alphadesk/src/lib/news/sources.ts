/**
 * Registry of public, free headline sources. Headline + link + publisher + time + short summary only:
 * no full-article scraping, no paywall bypass. Feed URLs verified live on 2026-11-17.
 */

export type NewsSourceKind = 'rss' | 'google-news' | 'api';

export interface NewsSource {
  id: string;
  /** publisher label shown in the UI */
  name: string;
  kind: NewsSourceKind;
  url: string;
  /** included when no `sources` filter is passed */
  default: boolean;
  /** per-ticker feed: `{T}` in the url is replaced with each requested ticker */
  perTicker?: boolean;
  /** how access works / what a paid plan would add */
  status: string;
}

/** Google News RSS search restricted to one publisher's domain (used where the publisher has no public RSS). */
export function googleNewsUrl(site: string, extra = '', window = '1d'): string {
  const q = `when:${window} site:${site}${extra ? ' ' + extra : ''}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q).replace(/%20/g, '+')}&hl=en-US&gl=US&ceid=US:en`;
}

export const NEWS_SOURCES: NewsSource[] = [
  { id: 'cnbc-top', name: 'CNBC', kind: 'rss', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', default: true, status: 'Official RSS (US top news). Free.' },
  { id: 'cnbc-markets', name: 'CNBC', kind: 'rss', url: 'https://www.cnbc.com/id/15839069/device/rss/rss.html', default: true, status: 'Official RSS (markets). Free.' },
  { id: 'cnbc-earnings', name: 'CNBC', kind: 'rss', url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html', default: false, status: 'Official RSS (earnings). Free.' },
  { id: 'wsj-markets', name: 'WSJ', kind: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain', default: true, status: 'Official Dow Jones public RSS (headlines + dek). Articles paywalled; full text needs a Dow Jones/Factiva licence.' },
  { id: 'wsj-business', name: 'WSJ', kind: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness', default: false, status: 'Official Dow Jones public RSS (US business).' },
  { id: 'marketwatch-top', name: 'MarketWatch', kind: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', default: true, status: 'Official Dow Jones public RSS. Free.' },
  { id: 'marketwatch-pulse', name: 'MarketWatch', kind: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse', default: true, status: 'Official Dow Jones public RSS (Market Pulse). Free.' },
  { id: 'nyt-business', name: 'New York Times', kind: 'rss', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', default: true, status: 'Official RSS. Free for headlines; NYT Developer APIs (free key) add search/archive.' },
  { id: 'nyt-economy', name: 'New York Times', kind: 'rss', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml', default: false, status: 'Official RSS (economy).' },
  { id: 'reuters', name: 'Reuters', kind: 'google-news', url: googleNewsUrl('reuters.com', 'markets'), default: true, status: 'No public RSS since 2020; via Google News search (links go through news.google.com). Direct feed needs a Reuters/LSEG licence.' },
  { id: 'bloomberg', name: 'Bloomberg', kind: 'google-news', url: googleNewsUrl('bloomberg.com', 'markets'), default: true, status: 'No public RSS; via Google News search. Direct access needs Bloomberg Terminal/B-PIPE or Enterprise licence.' },
  { id: 'yahoo', name: 'Yahoo Finance', kind: 'google-news', url: googleNewsUrl('finance.yahoo.com', 'stocks'), default: true, status: 'Yahoo’s general RSS index (finance.yahoo.com/news/rssindex) returns 404; via Google News search.' },
  { id: 'yahoo-ticker', name: 'Yahoo Finance', kind: 'rss', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s={T}&region=US&lang=en-US', default: true, perTicker: true, status: 'Unofficial per-ticker RSS; works but rate-limits (429) browser-like user agents. No SLA.' },
  { id: 'zacks', name: 'Zacks', kind: 'google-news', url: googleNewsUrl('zacks.com', '', '2d'), default: true, status: 'Zacks public RSS endpoints return 404; via Google News search. Zacks Data (paid, via Nasdaq Data Link) for estimates.' },
  { id: 'morningstar', name: 'Morningstar', kind: 'google-news', url: googleNewsUrl('morningstar.com', '', '3d'), default: true, status: 'No public RSS (404/403); via Google News search. Morningstar Direct/API is paid.' },
  { id: 'ft-markets', name: 'Financial Times', kind: 'rss', url: 'https://www.ft.com/markets?format=rss', default: true, status: 'Official RSS (headline + standfirst). Articles paywalled.' },
  { id: 'seeking-alpha', name: 'Seeking Alpha', kind: 'rss', url: 'https://seekingalpha.com/market_currents.xml', default: true, status: 'Official RSS (market currents, includes ticker tags). Free.' },
  { id: 'nasdaq', name: 'Nasdaq', kind: 'rss', url: 'https://www.nasdaq.com/feed/rssoutbound?category=Markets', default: true, status: 'Official RSS (syndicated: Motley Fool, RTTNews, Zacks…; includes ticker tags). Free.' },
  { id: 'benzinga', name: 'Benzinga', kind: 'rss', url: 'https://www.benzinga.com/feed', default: true, status: 'Official RSS. Benzinga News API (paid) adds real-time + ticker tagging.' },
  { id: 'investing', name: 'Investing.com', kind: 'rss', url: 'https://www.investing.com/rss/news_25.rss', default: true, status: 'Official RSS (stock market news). Free.' },
  { id: 'fed', name: 'Federal Reserve', kind: 'rss', url: 'https://www.federalreserve.gov/feeds/press_all.xml', default: false, status: 'Official RSS (all press releases). Free.' },
  { id: 'massive', name: 'Market data provider', kind: 'api', url: 'getMarketData().getNews', default: true, status: 'Massive (Polygon) news via the app data provider chain; falls back to local cache / mock (labelled).' },
];

export const DEFAULT_SOURCE_IDS = NEWS_SOURCES.filter((s) => s.default).map((s) => s.id);
