import { describe, expect, it } from 'vitest';
import { mockAllowed } from '@/lib/data/mock-policy';
import { redactSnapshot } from '@/components/sharing/redact';
import { companyAccess } from '@/components/company/server/data';

describe('mockAllowed', () => {
  it('is on in development/test and off in production by default', () => {
    expect(mockAllowed({ NODE_ENV: 'development' })).toBe(false);
    expect(mockAllowed({ NODE_ENV: 'test' })).toBe(true);
    expect(mockAllowed({ NODE_ENV: 'test' })).toBe(true);
    expect(mockAllowed({ NODE_ENV: 'production' })).toBe(false);
  });
  it('ALLOW_MOCK_DATA overrides, ALPHADESK_FORCE_MOCK implies on', () => {
    expect(mockAllowed({ NODE_ENV: 'production', ALLOW_MOCK_DATA: '1' })).toBe(true);
    expect(mockAllowed({ NODE_ENV: 'development', ALLOW_MOCK_DATA: '0' })).toBe(false);
    expect(mockAllowed({ NODE_ENV: 'production', ALPHADESK_FORCE_MOCK: '1' })).toBe(true);
  });
});

describe('companyAccess', () => {
  it('Free sees no premium sections; Pro sees all', () => {
    expect(companyAccess({ plan: 'FREE' })).toEqual({ analystResearch: false, financials: false, ownership: false });
    expect(companyAccess(null)).toEqual({ analystResearch: false, financials: false, ownership: false });
    expect(companyAccess({ plan: 'PRO_PLUS' })).toEqual({ analystResearch: true, financials: true, ownership: true });
  });
});

describe('share redaction', () => {
  const company = {
    ticker: 'NVDA', quote: { price: 100 }, metrics: { 'P/E': 30, 'EV/EBITDA': 25, EV: 1e12 },
    financials: [{ Period: 'FY2026', Revenue: 1 }], estimates: { rating: { buy: 40, hold: 5, sell: 1 }, priceTarget: { mean: 200, high: 250, low: 150 }, periods: [] },
  };
  it('strips financials, EV multiples and analyst data for Free and signed-out viewers', () => {
    for (const viewer of [{ plan: 'FREE' }, null]) {
      const r = redactSnapshot('company', company, viewer);
      expect(r.financials).toEqual([]);
      expect(r.estimates).toBeNull();
      expect(r.metrics).toEqual({ 'P/E': 30 });
      expect(JSON.stringify(r)).not.toMatch(/250|priceTarget|FY2026/);
      expect(r.__locked).toEqual(['financials', 'analystResearch']);
    }
  });
  it('withholds AI notes and threads entirely', () => {
    const note = { question: 'secret q', answerMarkdown: 'premium answer', sources: [{ id: 's' }], tickers: ['NVDA'] };
    const r = redactSnapshot('note', note, { plan: 'FREE' });
    expect(JSON.stringify(r)).not.toMatch(/premium answer|secret q/);
    expect(r.__locked).toEqual(['ai']);
    const t = redactSnapshot('thread', { messages: [{ role: 'assistant', content: 'premium answer' }] }, null);
    expect(JSON.stringify(t)).not.toMatch(/premium answer/);
  });
  it('passes everything through for Pro', () => {
    expect(redactSnapshot('company', company, { plan: 'PRO_PLUS' })).toEqual(company);
    expect(redactSnapshot('note', { answerMarkdown: 'x' }, { plan: 'PRO_PLUS' })).toEqual({ answerMarkdown: 'x' });
  });
});
