import { describe, expect, it } from 'vitest';
import {
  cleanComment, createShareSchema, MAX_SCREEN_ROWS, normalizeSnapshot, shareGate, snapshotPreview, snapshotTooLarge,
  type CompanySnapshot, type NoteSnapshot, type PortfolioSnapshot, type ScreenSnapshot, type ThreadSnapshot, type BasketSnapshot,
} from '../snapshot';

describe('share gating by plan', () => {
  it('blocks FREE from all sharing with upgrade to PRO', () => {
    for (const t of ['note', 'screen', 'portfolio', 'thread'] as const) {
      const g = shareGate({ plan: 'FREE' }, t);
      expect(g.allowed).toBe(false);
      expect(g.upgradeTo).toBe('PRO');
    }
    expect(shareGate({ plan: 'FREE' }, 'basket').upgradeTo).toBe('PRO');
  });
  it('allows PRO to share notes/screens/portfolios/threads but not baskets', () => {
    for (const t of ['note', 'screen', 'portfolio', 'thread'] as const) expect(shareGate({ plan: 'PRO' }, t).allowed).toBe(true);
    const b = shareGate({ plan: 'PRO' }, 'basket');
    expect(b.allowed).toBe(false);
    expect(b.upgradeTo).toBe('PRO_PLUS');
    expect(b.reason).toMatch(/basket/i);
  });
  it('allows PRO_PLUS to share everything', () => {
    for (const t of ['note', 'screen', 'portfolio', 'thread', 'basket'] as const) expect(shareGate({ plan: 'PRO_PLUS' }, t).allowed).toBe(true);
  });
  it('treats unknown plan strings as FREE', () => {
    expect(shareGate({ plan: 'ENTERPRISE' }, 'note').allowed).toBe(false);
  });
});

describe('create share schema', () => {
  it('defaults visibility to org and snapshot to {}', () => {
    const r = createShareSchema.parse({ itemType: 'note', itemId: 'n1' });
    expect(r.visibility).toBe('org');
    expect(r.snapshot).toEqual({});
  });
  it('rejects unknown item types and visibilities', () => {
    expect(createShareSchema.safeParse({ itemType: 'trade', itemId: 'x' }).success).toBe(false);
    expect(createShareSchema.safeParse({ itemType: 'note', itemId: 'x', visibility: 'public' }).success).toBe(false);
  });
});

const src = [
  { id: 's1', name: 'NVDA 10-K', kind: 'filing', url: 'https://sec.gov/x', excerpt: 'Data center revenue grew', locator: 'Item 7' },
  { id: 's2', name: 'Reuters', kind: 'news', url: 'javascript:alert(1)' },
  { id: 's1', name: 'dup', kind: 'filing' },
  { bogus: true },
];

describe('snapshot integrity', () => {
  const now = new Date('2026-11-17T12:00:00Z');

  it('note: preserves question, answer and cited sources (deduped, unsafe urls dropped)', () => {
    const s = normalizeSnapshot('note', {}, { question: 'Is growth accelerating?', answerMarkdown: 'Yes [1].', sources: src, tickers: ['nvda'] }, now) as NoteSnapshot;
    expect(s.question).toBe('Is growth accelerating?');
    expect(s.answerMarkdown).toBe('Yes [1].');
    expect(s.sources!.map((x) => x.id)).toEqual(['s1', 's2']);
    expect(s.sources![0]).toMatchObject({ excerpt: 'Data center revenue grew', locator: 'Item 7', url: 'https://sec.gov/x' });
    expect(s.sources![1].url).toBeUndefined();
    expect(s.tickers).toEqual(['NVDA']);
    expect(s.capturedAt).toBe(now.toISOString());
  });

  it('note: accepts `citations` alias and sanitises markdown answer', () => {
    const s = normalizeSnapshot('note', { answerMarkdown: '<script>x()</script>Hi [a](javascript:alert(1))', citations: [src[0]] }, {}, now) as NoteSnapshot;
    expect(s.answerMarkdown).toBe('x()Hi [a](#)');
    expect(s.sources).toHaveLength(1);
  });

  it('client view state overrides the stored base (what the author saw)', () => {
    const s = normalizeSnapshot('screen', { filters: { pe: { max: 20 } }, rows: [{ ticker: 'JPM', pe: 12 }] }, { name: 'Saved', filters: { pe: { max: 35 } }, columns: ['ticker', 'pe'] }, now) as ScreenSnapshot;
    expect(s.name).toBe('Saved');
    expect(s.filters).toEqual({ pe: { max: 20 } });
    expect(s.columns).toEqual(['ticker', 'pe']);
    expect(s.rows).toEqual([{ ticker: 'JPM', pe: 12 }]);
    expect(s.resultCount).toBe(1);
  });

  it('screen: caps rows but keeps the true result count', () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ ticker: `T${i}`, x: i }));
    const s = normalizeSnapshot('screen', { rows, resultCount: 400 }, {}, now) as ScreenSnapshot;
    expect(s.rows).toHaveLength(MAX_SCREEN_ROWS);
    expect(s.resultCount).toBe(400);
  });

  it('portfolio: keeps holdings numbers and metrics, drops non-finite values', () => {
    const s = normalizeSnapshot('portfolio', {
      positions: [{ ticker: 'nvda', quantity: 100, costBasis: 90, price: 150, marketValue: 15000, weight: 0.6, pnl: 6000, sector: 'IT' }, { ticker: 'XOM', quantity: -50, costBasis: 110, price: Number.NaN }],
      metrics: { 'Net exposure': 9500, Benchmark: 'SPY', bad: { nested: 1 } },
    }, {}, now) as PortfolioSnapshot;
    expect(s.positions[0]).toEqual({ ticker: 'NVDA', quantity: 100, costBasis: 90, price: 150, marketValue: 15000, weight: 0.6, pnl: 6000, sector: 'IT' });
    expect(s.positions[1].price).toBeUndefined();
    expect(s.positions[1].quantity).toBe(-50);
    expect(s.metrics).toEqual({ 'Net exposure': 9500, Benchmark: 'SPY' });
  });

  it('basket: keeps thesis and target weights', () => {
    const s = normalizeSnapshot('basket', {}, { name: 'AI', thesis: 'Capex compounding', holdings: [{ ticker: 'TSM', targetWeight: 0.16, rationale: 'Foundry' }] }, now) as BasketSnapshot;
    expect(s.thesis).toBe('Capex compounding');
    expect(s.holdings[0]).toMatchObject({ ticker: 'TSM', targetWeight: 0.16, rationale: 'Foundry' });
  });

  it('thread: keeps messages with per-message citations and drops malformed messages', () => {
    const s = normalizeSnapshot('thread', { messages: [{ role: 'user', content: 'Q?' }, { role: 'assistant', content: 'A [1]', citations: [src[0]] }, { nope: 1 }], context: { route: '/company/NVDA' } }, {}, now) as ThreadSnapshot;
    expect(s.messages).toHaveLength(2);
    expect(s.messages[1].citations![0].id).toBe('s1');
    expect(s.context).toEqual({ route: '/company/NVDA' });
  });

  it('preserves a valid capturedAt and the mock flag; round-trips through JSON unchanged', () => {
    const s = normalizeSnapshot('note', { capturedAt: '2026-11-01T00:00:00.000Z', isMock: true, question: 'q', answerMarkdown: 'a' }, {}, now);
    expect(s.capturedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(s.isMock).toBe(true);
    const again = normalizeSnapshot('note', JSON.parse(JSON.stringify(s)), {}, new Date());
    expect(again).toEqual(s);
  });

  it('company: keeps quote, valuation metrics, financial rows, estimates and news; drops unsafe urls', () => {
    const s = normalizeSnapshot('company', {}, {
      ticker: 'nvda', name: 'Nvidia', quote: { price: 156.14, changePct: -4.12, ts: '2026-11-16T05:00:00Z' },
      metrics: { 'P/E': 37.6, 'Market cap': 3.8e12 }, financials: [{ Period: 'FY2025', Revenue: 1.3e11 }],
      estimates: { rating: { buy: 40, hold: 5, sell: 1 }, priceTarget: { mean: 200, high: 250, low: 120 }, periods: [{ Period: 'FY2026', Consensus: 4.5 }] },
      news: [{ title: 'Headline', url: 'javascript:alert(1)' }, { title: 'OK', url: 'https://x.com/a' }], sources: [src[0]],
    }, now) as CompanySnapshot;
    expect(s.ticker).toBe('NVDA');
    expect(s.quote).toMatchObject({ price: 156.14, changePct: -4.12 });
    expect(s.metrics).toEqual({ 'P/E': 37.6, 'Market cap': 3.8e12 });
    expect(s.financials[0]).toEqual({ Period: 'FY2025', Revenue: 1.3e11 });
    expect(s.estimates!.priceTarget).toEqual({ mean: 200, high: 250, low: 120 });
    expect(s.news[0].url).toBeUndefined();
    expect(s.news[1].url).toBe('https://x.com/a');
    expect(shareGate({ plan: 'FREE' }, 'company').allowed).toBe(false);
    expect(shareGate({ plan: 'PRO' }, 'company').allowed).toBe(true);
  });

  it('flags oversized snapshots', () => {
    expect(snapshotTooLarge({ a: 'x'.repeat(600_000) })).toBe(true);
    expect(snapshotTooLarge({ a: 'x' })).toBe(false);
  });

  it('builds short previews without leaking full content', () => {
    const p = snapshotPreview('note', { question: '**What** is `NII` sensitivity?', sources: [src[0]], tickers: ['JPM'] });
    expect(p.text).toBe('What is NII sensitivity?');
    expect(p.stats).toEqual(['1 sources']);
    const sp = snapshotPreview('screen', { filters: { a: 1, b: 2 }, rows: [{ ticker: 'A' }, { ticker: 'B' }], resultCount: 9 });
    expect(sp.stats).toEqual(['2 filters', '9 results']);
    expect(sp.tickers).toEqual(['A', 'B']);
  });
});

describe('comment sanitisation', () => {
  it('strips html, script tags, control chars and js links', () => {
    expect(cleanComment('<img src=x onerror=alert(1)>Looks **good** [l](javascript:alert(2))')).toBe('Looks **good** [l](#)');
    expect(cleanComment('<script>steal()</script>ok')).toBe('steal()ok');
    expect(cleanComment('a\u0000b\u0007c')).toBe('abc');
  });
  it('rejects empty / whitespace / non-string bodies', () => {
    expect(cleanComment('   ')).toBeNull();
    expect(cleanComment('<b></b>')).toBeNull();
    expect(cleanComment(42)).toBeNull();
  });
  it('truncates very long comments', () => {
    expect(cleanComment('x'.repeat(10_000))!.length).toBe(4000);
  });
});
