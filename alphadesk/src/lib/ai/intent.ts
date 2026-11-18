// Lightweight intent parser used by the Mock provider (and for thread titles / ticker tagging).
// Pure — pass the ticker universe in so it is testable and client-safe.
import type { GicsSector } from '@/lib/data/types';

export type Metric =
  | 'revenue' | 'revenue_growth' | 'gross_margin' | 'operating_margin' | 'net_margin' | 'fcf_margin' | 'eps' | 'pe' | 'ev_ebitda' | 'market_cap';

export const METRICS: Metric[] = ['revenue', 'revenue_growth', 'gross_margin', 'operating_margin', 'net_margin', 'fcf_margin', 'eps', 'pe', 'ev_ebitda', 'market_cap'];

export const METRIC_LABEL: Record<Metric, string> = {
  revenue: 'Revenue', revenue_growth: 'Revenue growth', gross_margin: 'Gross margin', operating_margin: 'Operating margin', net_margin: 'Net margin',
  fcf_margin: 'FCF margin', eps: 'EPS', pe: 'P/E', ev_ebitda: 'EV/EBITDA', market_cap: 'Market cap',
};

export interface ScreenIntent {
  sector?: GicsSector;
  minMarketCapB?: number;
  maxPe?: number;
  minRevenueGrowth?: number;
  minEpsRevision?: number;
  maxShortInterest?: number;
  insiderBuying?: boolean;
  sortBy?: 'marketCap' | 'revenueGrowth' | 'pe' | 'epsRevision30d' | 'insiderBuying90d';
}

export type IntentKind = 'compare' | 'company' | 'screen' | 'theme' | 'news' | 'portfolio' | 'general';

export interface Intent {
  kind: IntentKind;
  tickers: string[];
  metrics: Metric[];
  years: number;
  sector?: GicsSector;
  theme?: { id: string; label: string; query: string };
  screen?: ScreenIntent;
  wantsDocs: boolean;
}

export interface UniverseLike { ticker: string; name: string; sector?: string }

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };

const ALIASES: Record<string, string> = {
  google: 'GOOGL', alphabet: 'GOOGL', facebook: 'META', meta: 'META', amazon: 'AMZN', apple: 'AAPL', microsoft: 'MSFT', nvidia: 'NVDA',
  tesla: 'TSLA', netflix: 'NFLX', broadcom: 'AVGO', oracle: 'ORCL', salesforce: 'CRM', 'jp morgan': 'JPM', jpmorgan: 'JPM', 'j.p. morgan': 'JPM',
  'berkshire': 'BRK.B', 'eli lilly': 'LLY', lilly: 'LLY', 'exxon': 'XOM', exxonmobil: 'XOM', chevron: 'CVX', walmart: 'WMT', costco: 'COST',
  visa: 'V', mastercard: 'MA', 'unitedhealth': 'UNH', 'johnson & johnson': 'JNJ', 'j&j': 'JNJ', 'procter': 'PG', 'coca-cola': 'KO', coke: 'KO', pepsi: 'PEP',
  adobe: 'ADBE', amd: 'AMD', intel: 'INTC', 'goldman': 'GS', 'morgan stanley': 'MS', caterpillar: 'CAT', boeing: 'BA', disney: 'DIS', nike: 'NKE',
};

const NAME_STOP = new Set(['the', 'american', 'general', 'united', 'first', 'bank', 'international', 'national', 'global', 'advanced', 'texas', 'digital', 'public', 'real', 'home']);

const SECTOR_ALIASES: [RegExp, GicsSector][] = [
  [/\b(information technology|tech(nology)?|semis?|semiconductors?|software)\b/i, 'Information Technology'],
  [/\b(communication services|media|telecom|internet)\b/i, 'Communication Services'],
  [/\b(consumer discretionary|retail(ers)?|autos?)\b/i, 'Consumer Discretionary'],
  [/\b(consumer staples|staples)\b/i, 'Consumer Staples'],
  [/\b(energy|oil|gas producers?)\b/i, 'Energy'],
  [/\b(financials?|banks?|insurers?)\b/i, 'Financials'],
  [/\b(health ?care|pharma(ceuticals)?|biotech|medtech)\b/i, 'Health Care'],
  [/\b(industrials?|aerospace|defen[cs]e)\b/i, 'Industrials'],
  [/\b(materials|chemicals|miners?|mining)\b/i, 'Materials'],
  [/\b(real estate|reits?)\b/i, 'Real Estate'],
  [/\b(utilities|utility)\b/i, 'Utilities'],
];

export const THEMES: { id: string; label: string; re: RegExp; query: string }[] = [
  { id: 'ai', label: 'AI exposure', re: /\b(AI|A\.I\.|artificial intelligence|machine learning|gen(erative)?[ -]?ai|llms?|gpus?|accelerators?)(?![\w.])/i, query: 'AI artificial intelligence accelerator data center cloud machine learning GPU' },
  { id: 'datacenter', label: 'Data center demand', re: /\bdata ?cent(er|re)s?\b/i, query: 'data center capacity demand load leasing' },
  { id: 'cloud', label: 'Cloud', re: /\bcloud\b/i, query: 'cloud subscription software enterprise' },
  { id: 'glp1', label: 'GLP-1', re: /\bglp-?1|obesity|weight[- ]loss\b/i, query: 'GLP-1 obesity demand' },
  { id: 'ev', label: 'EV', re: /\b(ev|electric vehicles?)\b/i, query: 'EV electric vehicle demand' },
  { id: 'tariffs', label: 'Trade / export controls', re: /\b(tariffs?|export controls?|trade policy|china)\b/i, query: 'export controls trade policy tariffs' },
  { id: 'buyback', label: 'Capital returns', re: /\b(buybacks?|repurchases?|dividends?|capital returns?)\b/i, query: 'repurchased shares dividend buyback capital returns' },
];

function cleanName(name: string): string {
  return name
    .replace(/,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|plc|Ltd\.?|Limited|N\.V\.|S\.A\.|Holdings?|Group|Class [A-C])\b/gi, '')
    .replace(/[.,]/g, '')
    .trim()
    .toLowerCase();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Find tickers mentioned by symbol ($AAPL / AAPL) or company name, ordered by first mention. */
export function findTickers(text: string, universe: UniverseLike[]): string[] {
  const known = new Map(universe.map((u) => [u.ticker.toUpperCase(), u]));
  const hits: { t: string; at: number }[] = [];
  const push = (t: string, at: number) => {
    if (!known.has(t)) return;
    const h = hits.find((x) => x.t === t);
    if (h) h.at = Math.min(h.at, at);
    else hits.push({ t, at });
  };
  // symbols: $xyz (any case) or ALL-CAPS tokens of length >= 2 (avoid "AI" which is not a ticker in most universes)
  for (const m of text.matchAll(/\$([A-Za-z]{1,5}(?:\.[A-Za-z])?)\b|\b([A-Z]{2,5}(?:\.[A-Z])?)\b/g)) {
    const sym = (m[1] ?? m[2]).toUpperCase();
    if (m[2] && (sym === 'AI' || sym === 'EV' || sym === 'FCF' || sym === 'EPS' || sym === 'CEO' || sym === 'CFO' || sym === 'BQL' || sym === 'USA' || sym === 'US')) continue;
    push(sym, m.index ?? 0);
  }
  const lower = text.toLowerCase();
  for (const [alias, t] of Object.entries(ALIASES)) {
    const re = new RegExp(`(^|[^a-z])${escapeRe(alias)}(?=$|[^a-z])`, 'i');
    const m = re.exec(lower);
    if (m) push(t, m.index);
  }
  for (const u of universe) {
    const full = cleanName(u.name);
    if (full.length >= 3) {
      const i = lower.search(new RegExp(`(^|[^a-z])${escapeRe(full)}(?=$|[^a-z])`));
      if (i >= 0) { push(u.ticker.toUpperCase(), i); continue; }
    }
    const first = full.split(/\s+/)[0];
    if (first && first.length >= 4 && !NAME_STOP.has(first)) {
      const i = lower.search(new RegExp(`(^|[^a-z])${escapeRe(first)}(?=$|[^a-z'])`));
      if (i >= 0) push(u.ticker.toUpperCase(), i);
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.t);
}

export function findMetrics(text: string): Metric[] {
  const t = text.toLowerCase();
  const out = new Set<Metric>();
  if (/(revenue|sales|top[- ]line)\s+growth|growth in (revenue|sales)|\bgrowth\b/.test(t)) out.add('revenue_growth');
  if (/gross margin/.test(t)) out.add('gross_margin');
  if (/operating margin|ebit margin/.test(t)) out.add('operating_margin');
  if (/net margin|profit margin|net income/.test(t)) out.add('net_margin');
  if (/\bmargins?\b/.test(t) && !/gross margin|operating margin|net margin|profit margin|ebit margin/.test(t)) { out.add('gross_margin'); out.add('operating_margin'); }
  if (/free cash flow|\bfcf\b|cash generation/.test(t)) out.add('fcf_margin');
  if (/\beps\b|earnings per share/.test(t)) out.add('eps');
  if (/valuation|p\/e|\bpe\b|multiple|cheap|expensive/.test(t)) { out.add('pe'); out.add('ev_ebitda'); }
  if (/ev\/ebitda/.test(t)) out.add('ev_ebitda');
  if (/market cap|size/.test(t)) out.add('market_cap');
  if (/\b(revenue|sales)\b/.test(t) && !out.has('revenue_growth')) out.add('revenue');
  return METRICS.filter((m) => out.has(m));
}

export function findYears(text: string): number {
  const t = text.toLowerCase();
  if (/\bdecade\b/.test(t)) return 10;
  const m = t.match(/(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)[- ]?(?:years?|yrs?|y)\b/);
  if (m) {
    const n = NUM_WORDS[m[1]] ?? Number(m[1]);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 30);
  }
  if (/\b(last|past) year\b|\byoy\b|year over year/.test(t)) return 1;
  return 5;
}

export function findSector(text: string): GicsSector | undefined {
  for (const [re, s] of SECTOR_ALIASES) if (re.test(text)) return s;
  return undefined;
}

export function findTheme(text: string): Intent['theme'] {
  const th = THEMES.find((x) => x.re.test(text));
  return th ? { id: th.id, label: th.label, query: th.query } : undefined;
}

function parseScreen(text: string, sector?: GicsSector): ScreenIntent {
  const t = text.toLowerCase();
  const s: ScreenIntent = { sector };
  const pe = t.match(/(?:p\/e|pe|multiple)\s*(?:under|below|<|less than)\s*(\d+)/) ?? t.match(/(?:under|below)\s*(\d+)\s*x/);
  if (pe) s.maxPe = Number(pe[1]);
  else if (/\b(cheap|value|inexpensive|low p\/e|low pe)\b/.test(t)) s.maxPe = 20;
  const g = t.match(/(?:growth|growing)\s*(?:above|over|>|of at least|at least)\s*(\d+)\s*%/) ?? t.match(/(\d+)\s*%\+?\s*(?:revenue\s*)?growth/);
  if (g) s.minRevenueGrowth = Number(g[1]);
  else if (/\b(growth|growing|high[- ]growth|compounders?)\b/.test(t)) s.minRevenueGrowth = 10;
  if (/insider (buying|purchases)/.test(t)) s.insiderBuying = true;
  if (/(estimate|eps) revisions?|upward revisions?|revisions? up/.test(t)) s.minEpsRevision = 0.01;
  if (/low short interest/.test(t)) s.maxShortInterest = 3;
  if (/\b(mega|large)[- ]caps?\b/.test(t)) s.minMarketCapB = /mega/.test(t) ? 500 : 100;
  const mc = t.match(/market cap (?:above|over|>)\s*\$?(\d+)\s*(b|bn|billion)/);
  if (mc) s.minMarketCapB = Number(mc[1]);
  s.sortBy = s.insiderBuying ? 'insiderBuying90d' : s.minEpsRevision != null ? 'epsRevision30d' : s.minRevenueGrowth != null ? 'revenueGrowth' : s.maxPe != null ? 'pe' : 'marketCap';
  return s;
}

/** Parse a research question into an intent. `contextTicker` (e.g. current company page) is used when nothing else is named. */
export function parseIntent(text: string, universe: UniverseLike[], contextTicker?: string): Intent {
  const tickers = findTickers(text, universe);
  const metrics = findMetrics(text);
  const years = findYears(text);
  const sector = findSector(text);
  const theme = findTheme(text);
  const t = text.toLowerCase();
  const wantsDocs = !!theme || /\b(risk|risks|guidance|outlook|management|said|say|call|transcript|10-k|10-q|filing|commentary|why|exposure|demand|thesis)\b/.test(t);

  const base = { tickers, metrics, years, sector, theme, wantsDocs };
  const isScreen = /\b(screen|screener|find|filter|ideas|which (stocks|companies|names)|show me (stocks|companies|names)|list (stocks|companies))\b/.test(t);

  if (/\b(my )?portfolio|my positions|my holdings|portfolio risk|concentration\b/.test(t) && tickers.length === 0) return { ...base, kind: 'portfolio' };
  if (isScreen && tickers.length < 2) return { ...base, kind: 'screen', screen: parseScreen(text, sector) };
  if (tickers.length >= 2) {
    return { ...base, kind: 'compare', metrics: metrics.length ? metrics : ['revenue_growth', 'gross_margin', 'operating_margin', 'pe'] };
  }
  if (/\b(news|headlines|what happened|latest on|what's new|whats new)\b/.test(t)) {
    return { ...base, kind: 'news', tickers: tickers.length ? tickers : contextTicker ? [contextTicker] : [] };
  }
  if (tickers.length === 1) return { ...base, kind: 'company' };
  if (theme || sector) return { ...base, kind: 'theme' };
  if (contextTicker && universe.some((u) => u.ticker === contextTicker)) return { ...base, kind: 'company', tickers: [contextTicker] };
  return { ...base, kind: 'general' };
}

/** Short thread title from the first question. */
export function threadTitle(q: string): string {
  const s = q.replace(/\s+/g, ' ').trim();
  return s.length > 80 ? s.slice(0, 77).trimEnd() + '…' : s || 'New research thread';
}
