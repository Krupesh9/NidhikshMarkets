import 'server-only';
import { cache } from '@/lib/cache';
import { log } from '@/lib/log';
import { getMarketData } from '@/lib/data';
import type { NewsItem } from '@/lib/data/types';
import { parseFeed } from './rss';
import { NEWS_SOURCES, DEFAULT_SOURCE_IDS, type NewsSource } from './sources';
import { buildTickerMatchers, dedupeNews, googlePublisher, hashId, matchTickers, sortNewest, stripPublisherSuffix } from './match';

export { NEWS_SOURCES, DEFAULT_SOURCE_IDS } from './sources';
export type { NewsSource, NewsSourceKind } from './sources';

export interface HeadlinesOptions {
  /** watchlist / focus tickers: adds per-ticker feeds + provider news and tags matching headlines */
  tickers?: string[];
  /** NEWS_SOURCES ids; default = every source with `default: true` */
  sources?: string[];
  /** max items returned (default 60, max 300) */
  limit?: number;
  /** only keep headlines that mention one of `tickers` */
  onlyMatching?: boolean;
}

export interface SourceStatus { id: string; name: string; ok: boolean; count: number; error?: string }
export interface HeadlinesResult { items: NewsItem[]; sources: SourceStatus[]; asOf: string }

const FEED_TIMEOUT_MS = 6_000;
const FEED_TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 60_000;
const MAX_TICKER_FEEDS = 10;
// Plain UA: Yahoo rate-limits browser-like UAs; every other feed accepts this.
const UA = 'Mozilla/5.0 (compatible; NidhikshPulse/1.0; research headlines)';

interface FeedResult { ok: boolean; items: NewsItem[]; error?: string }

async function fetchFeed(src: NewsSource, url: string, ticker?: string): Promise<FeedResult> {
  const key = `news:feed:${url}`;
  const hit = cache.get<FeedResult>(key);
  if (hit) return hit;
  let res: FeedResult;
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
      cache: 'no-store',
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const xml = await r.text();
    const raw = parseFeed(xml);
    const items: NewsItem[] = [];
    for (const it of raw) {
      if (!it.publishedAt) continue;
      // Google News: the real publisher is in <source>; for direct feeds keep the registry name.
      const publisher = src.kind === 'google-news' ? googlePublisher(it.source, src.name) : src.name;
      const title = stripPublisherSuffix(it.title, it.source ?? publisher);
      items.push({
        id: `${src.id}:${hashId(it.link)}`,
        ...(ticker ? { ticker } : {}),
        tickers: [...new Set([...(ticker ? [ticker] : []), ...(it.tickers ?? [])])],
        title,
        // Google News descriptions only repeat the title + publisher.
        summary: src.kind === 'google-news' ? undefined : it.summary,
        publisher,
        url: it.link,
        publishedAt: it.publishedAt,
      });
    }
    if (!items.length && !raw.length) throw new Error('no items');
    res = { ok: true, items };
  } catch (e) {
    const msg = (e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message;
    log.debug('news.feed_failed', { source: src.id, err: msg });
    res = { ok: false, items: [], error: msg };
  }
  cache.set(key, res, res.ok ? FEED_TTL_MS : FAIL_TTL_MS);
  return res;
}

async function providerNews(tickers: string[]): Promise<FeedResult> {
  try {
    const md = getMarketData();
    const lists = await Promise.all(
      (tickers.length ? tickers.slice(0, MAX_TICKER_FEEDS) : [undefined]).map((t) =>
        Promise.race([
          md.getNews(t).then((r) => (r.meta.isMock ? [] : r.data)),
          new Promise<NewsItem[]>((resolve) => setTimeout(() => resolve([]), FEED_TIMEOUT_MS)),
        ]).catch(() => [] as NewsItem[]),
      ),
    );
    return { ok: true, items: lists.flat().map((n) => ({ ...n, tickers: n.tickers ?? (n.ticker ? [n.ticker] : []) })) };
  } catch (e) {
    return { ok: false, items: [], error: (e as Error).message };
  }
}

async function companyNames(tickers: string[]): Promise<Record<string, string>> {
  if (!tickers.length) return {};
  try {
    const u = await getMarketData().getUniverse();
    const want = new Set(tickers);
    return Object.fromEntries(u.data.filter((x) => want.has(x.ticker)).map((x) => [x.ticker, x.name]));
  } catch {
    return {};
  }
}

/** Headlines plus per-source status. Never throws. */
export async function getHeadlinesWithStatus(opts: HeadlinesOptions = {}): Promise<HeadlinesResult> {
  const asOf = new Date().toISOString();
  try {
    const tickers = [...new Set((opts.tickers ?? []).map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)))];
    const wanted = new Set(opts.sources?.length ? opts.sources : DEFAULT_SOURCE_IDS);
    const limit = Math.max(1, Math.min(300, opts.limit ?? 60));
    const selected = NEWS_SOURCES.filter((s) => wanted.has(s.id));

    const jobs = selected.map(async (src): Promise<SourceStatus & { items: NewsItem[] }> => {
      let r: FeedResult;
      if (src.kind === 'api') r = await providerNews(tickers);
      else if (src.perTicker) {
        if (!tickers.length) return { id: src.id, name: src.name, ok: true, count: 0, items: [] };
        const parts = await Promise.all(tickers.slice(0, MAX_TICKER_FEEDS).map((t) => fetchFeed(src, src.url.replace('{T}', encodeURIComponent(t)), t)));
        r = { ok: parts.some((p) => p.ok), items: parts.flatMap((p) => p.items), error: parts.find((p) => !p.ok)?.error };
      } else r = await fetchFeed(src, src.url);
      return { id: src.id, name: src.name, ok: r.ok, count: r.items.length, ...(r.error && !r.ok ? { error: r.error } : {}), items: r.items };
    });
    const results = await Promise.all(jobs);

    const matchers = buildTickerMatchers(tickers, await companyNames(tickers));
    let all = results.flatMap((r) => r.items).map((n) => {
      const extra = matchers.length ? matchTickers(n.title, matchers) : [];
      const t = [...new Set([...n.tickers, ...extra])];
      return { ...n, tickers: t, ticker: n.ticker ?? (extra[0] || undefined) };
    });
    // Drop items dated in the future (bad feed clocks) beyond 15 minutes.
    const now = Date.now() + 15 * 60_000;
    all = all.filter((n) => Date.parse(n.publishedAt) <= now);
    let items = dedupeNews(sortNewest(all));
    if (opts.onlyMatching && tickers.length) {
      const want = new Set(tickers);
      items = items.filter((n) => n.tickers.some((t) => want.has(t)));
    }
    return { items: items.slice(0, limit), sources: results.map(({ items: _i, ...s }) => s), asOf };
  } catch (e) {
    log.warn('news.headlines_failed', { err: (e as Error).message });
    return { items: [], sources: [], asOf };
  }
}

/**
 * Latest headlines from public feeds (CNBC, WSJ, MarketWatch, NYT, Reuters/Bloomberg via Google News, Yahoo, Zacks,
 * Morningstar, FT, Seeking Alpha, Nasdaq, Benzinga, Investing.com) + the market-data provider. Newest first,
 * de-duplicated by normalised title, tickers tagged from feed metadata and title matching. Never throws.
 */
export async function getHeadlines(opts: HeadlinesOptions = {}): Promise<NewsItem[]> {
  return (await getHeadlinesWithStatus(opts)).items;
}
