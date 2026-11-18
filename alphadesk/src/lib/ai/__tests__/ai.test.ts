import { describe, expect, it, vi } from 'vitest';
import { MOCK_UNIVERSE } from '@/lib/data/mock/universe';
import { parseIntent, findYears } from '@/lib/ai/intent';
import { CitationRegistry, extractCitationNumbers, pickHighlight, referencedCitations, sentenceAround, splitCitations, stripInvalidMarkers } from '@/lib/ai/citations';
import { TOOL_NAMES, toolSpecs, validateToolInput } from '@/lib/ai/tool-schemas';
import { authorizeAiQuery } from '@/lib/ai/gate';
import { chooseProvider } from '@/lib/ai/provider';
import { composeAnswer, mockState, planCalls, MockLLMProvider } from '@/lib/ai/mock';
import { rankChunks } from '@/lib/ai/search';
import { buildBql } from '@/lib/ai/bql';
import type { LLMMessage, ProviderEvent } from '@/lib/ai/types';

const U = MOCK_UNIVERSE;

describe('intent parsing', () => {
  it('parses the flagship compare question', () => {
    const i = parseIntent('compare Apple and Microsoft on revenue growth, margins, and AI exposure over the last five years', U);
    expect(i.kind).toBe('compare');
    expect(i.tickers).toEqual(['AAPL', 'MSFT']);
    expect(i.metrics).toEqual(expect.arrayContaining(['revenue_growth', 'gross_margin', 'operating_margin']));
    expect(i.years).toBe(5);
    expect(i.theme?.id).toBe('ai');
  });
  it('recognises symbols, vs, and year counts', () => {
    const i = parseIntent('NVDA vs $amd gross margin over 3 years', U);
    expect(i.kind).toBe('compare');
    expect(i.tickers[0]).toBe('NVDA');
    expect(parseIntent('MSFT versus AAPL margins', U).tickers).toEqual(['MSFT', 'AAPL']);
    expect(i.metrics).toContain('gross_margin');
    expect(findYears('over the past decade')).toBe(10);
    expect(findYears('last ten years')).toBe(10);
  });
  it('parses screens with filters', () => {
    const i = parseIntent('find cheap health care stocks with upward estimate revisions', U);
    expect(i.kind).toBe('screen');
    expect(i.screen?.sector).toBe('Health Care');
    expect(i.screen?.maxPe).toBe(20);
    expect(i.screen?.minEpsRevision).toBeGreaterThan(0);
  });
  it('parses single company, news, theme, portfolio and context fallback', () => {
    expect(parseIntent('What did Microsoft say about cloud demand?', U)).toMatchObject({ kind: 'company', tickers: ['MSFT'], wantsDocs: true });
    expect(parseIntent('latest news on AAPL', U)).toMatchObject({ kind: 'news', tickers: ['AAPL'] });
    expect(parseIntent('Which tech companies have the most AI exposure?', U)).toMatchObject({ kind: 'theme', sector: 'Information Technology' });
    expect(parseIntent('what is the risk of my portfolio', U).kind).toBe('portfolio');
    expect(parseIntent('how are margins trending?', U, 'NVDA')).toMatchObject({ kind: 'company', tickers: ['NVDA'] });
    // "AI" is not mistaken for a ticker
    expect(parseIntent('AI winners', U).tickers).not.toContain('AI');
  });
});

describe('citation marker mapping', () => {
  const reg = new CitationRegistry();
  const a = reg.add({ id: 'src:a', name: '10-K', kind: 'filing', excerpt: 'Revenue increased 6.4% year over year to $391.0B.' });
  const b = reg.add({ id: 'src:b', name: 'Call', kind: 'transcript' });
  const a2 = reg.add({ id: 'src:a', name: '10-K again', kind: 'filing' });

  it('numbers sources in order and dedupes by id', () => {
    expect([a, b, a2]).toEqual([1, 2, 1]);
    expect(reg.size).toBe(2);
    expect(reg.numberOf('src:b')).toBe(2);
  });
  it('extracts, strips and splits markers', () => {
    const text = 'Revenue grew 6.4% [1]. Demand is strong [2, 7]. See [link](https://x.y) and [9].';
    expect(extractCitationNumbers(text)).toEqual([1, 2, 7, 9]);
    expect(stripInvalidMarkers(text, [1, 2])).toBe('Revenue grew 6.4% [1]. Demand is strong [2]. See [link](https://x.y) and .');
    const segs = splitCitations('Up 6.4% [1] and [2,3].');
    expect(segs.filter((s) => s.type === 'cite').map((s) => (s as { ns: number[] }).ns)).toEqual([[1], [2, 3]]);
    expect(referencedCitations('x [2]', reg.all).map((c) => c.n)).toEqual([2]);
  });
  it('finds the cited sentence and the figure to highlight in the excerpt', () => {
    const text = 'Intro sentence. Apple revenue rose 6.4% to $391.0B [1]. Next.';
    const s = sentenceAround(text, text.indexOf('[1]'));
    expect(s).toBe('Apple revenue rose 6.4% to $391.0B');
    expect(pickHighlight(s, reg.get(1)!.excerpt)).toBe('$391.0B');
    const after = 'First. VaR is $130,834 (1.07% of NAV). [1] Next one.';
    expect(sentenceAround(after, after.indexOf('[1]'))).toBe('VaR is $130,834 (1.07% of NAV)');
  });
});

describe('tool argument validation', () => {
  it('accepts valid input and fills defaults', () => {
    const r = validateToolInput('compare_companies', { tickers: ['aapl', 'MSFT'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.tickers).toEqual(['AAPL', 'MSFT']);
      expect(r.input.years).toBe(5);
      expect(r.input.metrics.length).toBeGreaterThan(0);
    }
  });
  it('rejects bad tickers, too few tickers, out-of-range and unknown fields', () => {
    expect(validateToolInput('compare_companies', { tickers: ['AAPL'] }).ok).toBe(false);
    expect(validateToolInput('get_company_snapshot', { ticker: 'DROP TABLE x' }).ok).toBe(false);
    expect(validateToolInput('get_financials', { ticker: 'AAPL', years: 99 }).ok).toBe(false);
    expect(validateToolInput('get_news', { ticker: 'AAPL', evil: true }).ok).toBe(false);
    expect(validateToolInput('compare_companies', { tickers: ['AAPL', 'MSFT'], metrics: ['vibes'] }).ok).toBe(false);
  });
  it('exposes JSON-schema specs for every tool', () => {
    const specs = toolSpecs();
    expect(specs.map((s) => s.name)).toEqual(TOOL_NAMES);
    for (const s of specs) {
      expect(s.inputSchema.type).toBe('object');
      expect(s.inputSchema.$schema).toBeUndefined();
    }
  });
});

describe('usage gating', () => {
  const store = (used: number) => ({ getUsed: vi.fn(async () => used), increment: vi.fn(async () => used + 1) });
  it('blocks FREE without consuming a query', async () => {
    const s = store(0);
    const r = await authorizeAiQuery({ plan: 'FREE' }, s);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.gate.upgradeTo).toBe('PRO_PLUS');
    expect(s.increment).not.toHaveBeenCalled();
  });
  it('counts Pro queries (unlimited, still metered)', async () => {
    const s = store(5);
    const r = await authorizeAiQuery({ plan: 'PRO_PLUS' }, s);
    expect(r).toEqual({ allowed: true, usage: { used: 6, limit: null, remaining: null } });
    expect(s.increment).toHaveBeenCalledTimes(1);
  });
  it('legacy PRO rows are treated as Pro (unlimited)', async () => {
    const r = await authorizeAiQuery({ plan: 'PRO' }, store(100));
    expect(r.allowed).toBe(true);
    const pp = await authorizeAiQuery({ plan: 'PRO_PLUS' }, store(5000));
    expect(pp).toMatchObject({ allowed: true, usage: { limit: null, remaining: null } });
  });
});

describe('provider selection', () => {
  it('prefers user key, then env key, then mock', () => {
    expect(chooseProvider({ anthropic: 'sk-user' }, { ANTHROPIC_API_KEY: 'sk-env' })).toMatchObject({ id: 'anthropic', keySource: 'user', apiKey: 'sk-user', model: 'claude-opus-5-5' });
    expect(chooseProvider({ gemini: 'g-user' }, { ANTHROPIC_API_KEY: 'sk-env' })).toMatchObject({ id: 'gemini', keySource: 'user' });
    expect(chooseProvider({}, { GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gemini-x' })).toMatchObject({ id: 'gemini', keySource: 'env', model: 'gemini-x' });
    expect(chooseProvider({}, { ANTHROPIC_MODEL: 'claude-sonnet-5-5', ANTHROPIC_API_KEY: 'k' }).model).toBe('claude-sonnet-5-5');
    expect(chooseProvider({}, {})).toMatchObject({ id: 'mock', keySource: 'none' });
    expect(chooseProvider({ anthropic: 'k' }, { AI_PROVIDER: 'mock' }).id).toBe('mock');
  });
});

describe('mock provider', () => {
  const q = 'compare Apple and Microsoft on revenue growth, margins, and AI exposure over the last five years';
  const compareResult = {
    years: 5, metrics: ['revenue_growth', 'gross_margin', 'operating_margin'],
    companies: [
      { ticker: 'AAPL', name: 'Apple Inc.', firstFy: 2020, latestFy: 2025, revenueLatest: '$416.0B', revenueCagr: 12.2, revenueGrowthLatest: 12.3, avgGrowth: 12.3, grossMarginLatest: 46.2, grossMarginChangePts: 2.2, operatingMarginLatest: 32, operatingMarginChangePts: 5.9, finCite: 2, profileCite: 1, series: [] },
      { ticker: 'MSFT', name: 'Microsoft Corporation', firstFy: 2020, latestFy: 2025, revenueLatest: '$293.0B', revenueCagr: 18.5, revenueGrowthLatest: 14.5, avgGrowth: 18.8, grossMarginLatest: 69.1, grossMarginChangePts: -0.8, operatingMarginLatest: 44.7, operatingMarginChangePts: -1.7, finCite: 4, profileCite: 3, series: [] },
    ],
  };
  const docs = { coverage: { AAPL: 1, MSFT: 3 }, passages: [{ ticker: 'MSFT', kind: 'transcript', title: 'MSFT call', text: 'CEO: Demand for AI accelerator remained robust.', cite: 5 }] };

  it('plans compare → search → answer', () => {
    const intent = parseIntent(q, U);
    const msgs: LLMMessage[] = [{ role: 'user', content: q }];
    expect(planCalls(intent, mockState(msgs)).map((c) => c.name)).toEqual(['compare_companies']);
    msgs.push({ role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'compare_companies', input: {} }] }, { role: 'tool', results: [{ id: '1', name: 'compare_companies', content: JSON.stringify(compareResult) }] });
    expect(planCalls(intent, mockState(msgs)).map((c) => c.name)).toEqual(['search_documents']);
    msgs.push({ role: 'assistant', content: '', toolCalls: [{ id: '2', name: 'search_documents', input: {} }] }, { role: 'tool', results: [{ id: '2', name: 'search_documents', content: JSON.stringify(docs) }] });
    expect(planCalls(intent, mockState(msgs))).toEqual([]);
    const text = composeAnswer(intent, mockState(msgs));
    expect(text).toContain('18.5% CAGR');
    expect(text).toMatch(/\[4\]/);
    expect(text).toMatch(/\[5\]/);
    expect(text).toContain('```bql');
    expect(text).toContain("for(['AAPL US Equity','MSFT US Equity'])");
    expect(text).toMatch(/not investment advice/i);
  });

  it('streams tool calls then text without an API key', async () => {
    const p = new MockLLMProvider(U, 'Mock', 0);
    const evs: ProviderEvent[] = [];
    for await (const e of p.chat([{ role: 'user', content: q }], [], { system: '' })) evs.push(e);
    expect(evs.at(-1)).toMatchObject({ type: 'final', stopReason: 'tool_use' });
    expect(evs.filter((e) => e.type === 'tool_call')).toHaveLength(1);
  });
});

describe('document search + BQL', () => {
  it('ranks keyword matches above unrelated chunks', () => {
    const r = rankChunks('AI accelerator demand', [
      { id: '1', title: 'call', text: 'Demand for AI accelerator remained robust', kind: 'transcript' },
      { id: '2', title: '10-K', text: 'We repurchased shares and raised the dividend', kind: 'filing' },
    ]);
    expect(r.map((x) => x.id)).toEqual(['1']);
  });
  it('builds a BQL snippet', () => {
    expect(buildBql(['AAPL', 'MSFT'], ['revenue', 'gross_margin'], 5).query).toBe("get(SALES_REV_TURN, GROSS_MARGIN) for(['AAPL US Equity','MSFT US Equity']) with(fpt=A, fpo=range(-5Y,0Y))");
  });
});
