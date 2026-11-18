import { describe, expect, it } from 'vitest';
import { decodeEntities, parseFeed, parseFeedDate, toPlainText, truncate } from '../rss';
import { buildTickerMatchers, dedupeNews, googlePublisher, matchTickers, normalizeTitle, sortNewest, stripPublisherSuffix } from '../match';
import { NEWS_SOURCES, DEFAULT_SOURCE_IDS, googleNewsUrl } from '../sources';
import type { NewsItem } from '@/lib/data/types';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:nasdaq="http://nasdaq.com/ns">
<channel><title>Feed</title><lastBuildDate>Wed, 18 Nov 2026 03:47 GMT</lastBuildDate>
  <item>
    <title><![CDATA[Nvidia beats &amp; raises]]></title>
    <link>https://www.cnbc.com/2026/11/18/nvda.html</link>
    <description><![CDATA[<p>Shares <b>rose</b> 5% after&nbsp;hours.</p>]]></description>
    <pubDate>Tue, 17 Nov 2026 22:10:03 -0500</pubDate>
    <dc:creator>Jane Doe</dc:creator>
    <nasdaq:tickers>NVDA,AVGO</nasdaq:tickers>
  </item>
  <item>
    <title>Benzinga style</title>
    <link>https://www.benzinga.com/x?a=1&amp;b=2</link>
    <description>&lt;p class=&#34;x&#34;&gt;&lt;strong&gt;Palo Alto&lt;/strong&gt; fell &amp;rsquo;s&lt;/p&gt;</description>
    <category domain="https://seekingalpha.com/symbol/PANW">panw</category>
  </item>
  <item><title>No link item</title></item>
  <item>
    <title>Asia stocks rally - Reuters</title>
    <link>https://news.google.com/rss/articles/abc?oc=5</link>
    <pubDate>2026-11-18 03:49:33</pubDate>
    <source url="https://www.reuters.com">Reuters</source>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><title type="html">Fed &lt;em&gt;holds&lt;/em&gt; rates</title><link rel="alternate" href="https://example.com/fed"/>
<published>2026-11-17T19:00:00Z</published><summary>Policy unchanged.</summary><author><name>Fed Desk</name></author></entry>
</feed>`;

describe('rss parser', () => {
  it('parses RSS 2.0 items with CDATA, entities, dates, creators and ticker tags', () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(3);
    const [a, b, c] = items;
    expect(a.title).toBe('Nvidia beats & raises');
    expect(a.link).toBe('https://www.cnbc.com/2026/11/18/nvda.html');
    expect(a.summary).toBe('Shares rose 5% after hours.');
    expect(a.publishedAt).toBe('2026-11-18T03:10:03.000Z');
    expect(a.source).toBe('Jane Doe');
    expect(a.tickers).toEqual(['NVDA', 'AVGO']);
    // entity-encoded HTML is decoded then stripped; link entities decoded; channel date fallback
    expect(b.summary).toBe('Palo Alto fell ’s');
    expect(b.link).toBe('https://www.benzinga.com/x?a=1&b=2');
    expect(b.publishedAt).toBe('2026-11-18T03:47:00.000Z');
    expect(b.tickers).toEqual(['PANW']);
    expect(c.source).toBe('Reuters');
    expect(c.publishedAt).toBe('2026-11-18T03:49:33.000Z');
  });

  it('parses Atom entries', () => {
    const [e] = parseFeed(ATOM);
    expect(e).toMatchObject({ title: 'Fed holds rates', link: 'https://example.com/fed', publishedAt: '2026-11-17T19:00:00.000Z', summary: 'Policy unchanged.', source: 'Fed Desk' });
  });

  it('never throws on junk', () => {
    expect(parseFeed('')).toEqual([]);
    expect(parseFeed('<html><body>404</body></html>')).toEqual([]);
    expect(parseFeed('{"Note":"rate limit"}')).toEqual([]);
    expect(parseFeed(undefined as unknown as string)).toEqual([]);
  });

  it('helpers', () => {
    expect(decodeEntities('&#xA3;1 &#36;2 &amp;amp;')).toBe('£1 $2 &amp;');
    expect(toPlainText('<a href="x">Hi</a>&nbsp;&nbsp;<font>there</font>')).toBe('Hi there');
    expect(parseFeedDate('garbage')).toBeUndefined();
    expect(truncate('a '.repeat(200), 20).endsWith('…')).toBe(true);
  });
});

const item = (p: Partial<NewsItem>): NewsItem => ({ id: Math.random().toString(36), tickers: [], title: 't', publisher: 'X', url: 'https://x', publishedAt: '2026-11-17T00:00:00Z', ...p });

describe('dedupe + sort', () => {
  it('normalises titles across publishers, quotes and suffixes', () => {
    expect(normalizeTitle('Nvidia’s Earnings Beat - Reuters')).toBe(normalizeTitle("Nvidia's earnings beat"));
    expect(normalizeTitle('Stocks rise | Morningstar')).toBe('stocks rise');
  });
  it('keeps the first (newest) copy and merges tickers', () => {
    const items = sortNewest([
      item({ title: 'Nvidia earnings beat - Reuters', publishedAt: '2026-11-17T22:00:00Z', publisher: 'Reuters', tickers: ['NVDA'] }),
      item({ title: 'Nvidia Earnings Beat', publishedAt: '2026-11-17T23:00:00Z', publisher: 'CNBC', tickers: ['AVGO'] }),
      item({ title: 'Different story', publishedAt: '2026-11-17T21:00:00Z' }),
    ]);
    const out = dedupeNews(items);
    expect(out).toHaveLength(2);
    expect(out[0].publisher).toBe('CNBC');
    expect(out[0].tickers.sort()).toEqual(['AVGO', 'NVDA']);
    expect(out[1].title).toBe('Different story');
  });
  it('strips Google News publisher suffix and normalises publisher names', () => {
    expect(stripPublisherSuffix('Asia stocks rally - Reuters', 'Reuters')).toBe('Asia stocks rally');
    expect(stripPublisherSuffix('A - B - Other', 'Reuters')).toBe('A - B - Other');
    expect(googlePublisher('Bloomberg.com', 'Bloomberg')).toBe('Bloomberg');
    expect(googlePublisher('Zacks Investment Research', 'Zacks')).toBe('Zacks');
    expect(googlePublisher('Investopedia', 'Yahoo Finance')).toBe('Investopedia');
    expect(googlePublisher(undefined, 'Reuters')).toBe('Reuters');
  });
});

describe('ticker matching', () => {
  const m = buildTickerMatchers(['NVDA', 'AAPL', 'IT', 'TGT'], { AAPL: 'Apple Inc.', IT: 'Gartner, Inc.', TGT: 'Target Corporation' });
  it('matches tickers, $cashtags, names and aliases', () => {
    expect(matchTickers('Nvidia beats estimates', m)).toEqual(['NVDA']);
    expect(matchTickers('NVDA and AAPL slide', m)).toEqual(['NVDA', 'AAPL']);
    expect(matchTickers('Apple’s iPhone sales', m)).toEqual(['AAPL']);
    expect(matchTickers('Gartner raises guidance', m)).toEqual(['IT']);
  });
  it('avoids common-word false positives', () => {
    expect(matchTickers('Why IT spending matters', m)).toEqual([]);
    expect(matchTickers('Shares of $IT jump', m)).toEqual(['IT']);
    expect(matchTickers('Investors target higher yields', m)).toEqual([]);
    expect(matchTickers('Pineapple prices', m)).toEqual([]);
  });
});

describe('source registry', () => {
  it('has unique ids, covers the requested publishers and builds Google News urls', () => {
    const ids = NEWS_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = new Set(NEWS_SOURCES.map((s) => s.name));
    for (const n of ['CNBC', 'WSJ', 'Bloomberg', 'Reuters', 'Yahoo Finance', 'MarketWatch', 'Zacks', 'Morningstar', 'New York Times']) expect(names.has(n)).toBe(true);
    expect(DEFAULT_SOURCE_IDS.length).toBeGreaterThan(10);
    expect(googleNewsUrl('reuters.com', 'markets')).toBe('https://news.google.com/rss/search?q=when%3A1d+site%3Areuters.com+markets&hl=en-US&gl=US&ceid=US:en');
  });
});
