/** Pure helpers for the news aggregator: title normalisation, de-duplication, ticker matching. */
import type { NewsItem } from '@/lib/data/types';

/** Google News appends " - Publisher" to titles; strip it when it matches the known publisher. */
export function stripPublisherSuffix(title: string, publisher?: string): string {
  if (!publisher) return title;
  const i = title.lastIndexOf(' - ');
  if (i > 0 && title.slice(i + 3).trim().toLowerCase() === publisher.trim().toLowerCase()) return title.slice(0, i).trim();
  return title;
}

/** Lowercase, drop punctuation/quotes/publisher suffixes and collapse whitespace, for dedupe. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+[-|–—]\s+[^-|–—]{2,40}$/, '') // trailing " - Reuters" / " | Morningstar"
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’“”'"`]/g, '')
    .replace(/[^a-z0-9$%]+/g, ' ')
    .trim();
}

/** Keep the first occurrence of each normalised title (input should already be sorted by preference), merging tickers. */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seen = new Map<string, NewsItem>();
  for (const it of items) {
    const k = normalizeTitle(it.title);
    if (!k) continue;
    const prev = seen.get(k);
    if (!prev) { seen.set(k, { ...it, tickers: [...it.tickers] }); continue; }
    for (const t of it.tickers) if (!prev.tickers.includes(t)) prev.tickers.push(t);
    if (!prev.summary && it.summary) prev.summary = it.summary;
  }
  return [...seen.values()];
}

export function sortNewest(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
}

const SUFFIX = /\b(incorporated|inc|corporation|corp|company|co|ltd|limited|plc|holdings?|group|class [abc]|the|sa|nv|ag|se|llc|lp)\b\.?/gi;
/** Common short names that differ from the legal name. */
const ALIASES: Record<string, string[]> = {
  GOOGL: ['Google', 'Alphabet'], GOOG: ['Google', 'Alphabet'], META: ['Meta Platforms', 'Facebook'], BRK_B: ['Berkshire'],
  'BRK.B': ['Berkshire'], JPM: ['JPMorgan', 'JP Morgan'], GS: ['Goldman Sachs', 'Goldman'], MS: ['Morgan Stanley'], BAC: ['Bank of America'],
  NVDA: ['Nvidia'], AMZN: ['Amazon'], AAPL: ['Apple'], MSFT: ['Microsoft'], TSLA: ['Tesla'], AMD: ['AMD'], AVGO: ['Broadcom'],
  WMT: ['Walmart'], COST: ['Costco'], NFLX: ['Netflix'], CRM: ['Salesforce'], ORCL: ['Oracle'], LLY: ['Eli Lilly', 'Lilly'], UNH: ['UnitedHealth'],
  XOM: ['Exxon'], CVX: ['Chevron'], KO: ['Coca-Cola'], PEP: ['PepsiCo'], DIS: ['Disney'], INTC: ['Intel'], PLTR: ['Palantir'], TGT: ['Target Corp'],
};

/** Ambiguous English words that are also tickers: only match them as "$T" or "(T)" or "NASDAQ:T". */
const AMBIGUOUS = new Set(['A', 'ALL', 'ARE', 'BE', 'CAN', 'CAT', 'DD', 'EAT', 'FAST', 'FOR', 'GO', 'HAS', 'HE', 'IT', 'KEY', 'LOW', 'MA', 'MAN', 'NOW', 'ON', 'ONE', 'OUT', 'PM', 'RE', 'SO', 'SEE', 'TV', 'TWO', 'UP', 'US', 'WELL', 'AI', 'CEO', 'IPO', 'GDP', 'CPI', 'ETF', 'FED', 'SEC', 'EV', 'AM', 'OR', 'AN', 'AT', 'BY', 'IN', 'OF', 'TO', 'NEW', 'BIG', 'TOP', 'HOT', 'OPEN', 'REAL', 'TRUE', 'LIFE', 'PLAY', 'J', 'C', 'F', 'T', 'V', 'K', 'O', 'D', 'X', 'GE', 'GM', 'MS']);

export interface TickerMatcher { ticker: string; patterns: RegExp[] }

function esc(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function coreName(name: string): string {
  return name.replace(SUFFIX, ' ').replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Build matchers from tickers and (optional) company names. */
export function buildTickerMatchers(tickers: string[], names: Record<string, string | undefined> = {}): TickerMatcher[] {
  return [...new Set(tickers.map((t) => t.toUpperCase()))].map((t) => {
    const patterns: RegExp[] = [new RegExp(`(?:\\$|\\(|\\b(?:NASDAQ|NYSE|NYSEARCA|AMEX)\\s?:\\s?)${esc(t)}\\b`)];
    if (!AMBIGUOUS.has(t) && t.length >= 2) patterns.push(new RegExp(`(?<![A-Za-z0-9$])${esc(t)}(?![A-Za-z0-9])`));
    const ns = new Set<string>(ALIASES[t] ?? []);
    const n = names[t];
    if (n) {
      const c = coreName(n);
      // Single generic words ("Target", "Visa") stay case-sensitive to cut false positives.
      if (c.length >= 3) ns.add(c.split(' ').length > 3 ? c.split(' ').slice(0, 2).join(' ') : c);
    }
    for (const name of ns) {
      // Multi-word names match case-insensitively; single words ("Target", "Apple") only as written or in ALL CAPS.
      const multi = name.includes(' ');
      const body = multi ? esc(name) : `(?:${esc(name)}|${esc(name.toUpperCase())})`;
      patterns.push(new RegExp(`\\b${body}(?:'s|’s)?\\b`, multi ? 'i' : ''));
    }
    return { ticker: t, patterns };
  });
}

export function matchTickers(text: string, matchers: TickerMatcher[]): string[] {
  const out: string[] = [];
  for (const m of matchers) if (m.patterns.some((p) => p.test(text))) out.push(m.ticker);
  return out;
}

/** Stable short id from a string (djb2). */
export function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** "Bloomberg.com" / "Zacks Investment Research" -> registry name; other syndicated publishers keep their own label. */
export function googlePublisher(source: string | undefined, registryName: string): string {
  if (!source) return registryName;
  const first = registryName.toLowerCase().split(/\s+/)[0];
  return source.toLowerCase().replace(/[^a-z]/g, '').startsWith(first.replace(/[^a-z]/g, '')) ? registryName : source;
}
