/**
 * Premium data is enforced on the server: a Free user (plan read from the DB via getSessionUser) gets
 * 403 upgrade_required from every premium API, and plan-aware loaders never fetch gated data.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ me: null as null | Record<string, unknown>, aggAccess: null as unknown, historyCalls: 0 }));

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => h.me) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), auditAsync: vi.fn(async () => undefined) }));
vi.mock('@/lib/db', () => ({ db: {}, default: {} }));
vi.mock('@/lib/repos', () => ({
  researchRepo: { listNotes: vi.fn(async () => []), listThreads: vi.fn(async () => []), getThread: vi.fn(async () => null), createNote: vi.fn() },
}));
vi.mock('@/lib/data', () => ({
  getMarketData: () => ({
    getHistory: async () => { h.historyCalls++; return { data: [{ date: '2026-01-02', open: 1, high: 1, low: 1, close: 1, volume: 1 }], meta: { source: [], isMock: false, asOf: '', provider: 'test' } }; },
  }),
}));
vi.mock('@/components/company/server/data', async (orig) => {
  const real = await orig<typeof import('@/components/company/server/data')>();
  return { ...real, loadAggregate: vi.fn(async (ticker: string, access: unknown) => { h.aggAccess = access; return { ticker, found: true }; }) };
});

import { GET as historyGET } from '@/app/api/company/[ticker]/history/route';
import { GET as companyGET } from '@/app/api/company/[ticker]/route';
import { GET as notesGET, POST as notesPOST } from '@/app/api/ai/notes/route';
import { GET as threadsGET } from '@/app/api/ai/threads/route';
import { GET as threadGET } from '@/app/api/ai/threads/[id]/route';
import { POST as chatPOST } from '@/app/api/ai/chat/route';

const FREE = { id: 'u_free', orgId: 'o1', email: 'free@x.dev', name: 'Free', role: 'VIEWER', plan: 'FREE' };
const PRO = { id: 'u_pro', orgId: 'o1', email: 'pro@x.dev', name: 'Pro', role: 'ANALYST', plan: 'PRO_PLUS' };

const get = (url: string) => new NextRequest(`http://127.0.0.1:4200${url}`, { headers: { host: '127.0.0.1:4200' } });
const post = (url: string, body: unknown) =>
  new NextRequest(`http://127.0.0.1:4200${url}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:4200', host: '127.0.0.1:4200' }, body: JSON.stringify(body) });

async function expectUpgrade(res: Response) {
  expect(res.status).toBe(403);
  const j = await res.json();
  expect(j.error.code).toBe('upgrade_required');
  expect(j.error.details?.upgradeTo).toBe('PRO_PLUS');
}

beforeEach(() => { h.me = null; h.aggAccess = null; h.historyCalls = 0; });

describe('history API ranges', () => {
  it.each(['1D', '1W', '5Y', 'MAX'])('rejects %s for Free without touching the provider', async (range) => {
    h.me = { ...FREE };
    await expectUpgrade(await historyGET(get(`/api/company/NVDA/history?range=${range}`), { params: { ticker: 'NVDA' } }));
    expect(h.historyCalls).toBe(0);
  });
  it.each(['1M', '3M', '6M', 'YTD', '1Y'])('allows %s for Free', async (range) => {
    h.me = { ...FREE };
    const r = await historyGET(get(`/api/company/NVDA/history?range=${range}`), { params: { ticker: 'NVDA' } });
    expect(r.status).toBe(200);
  });
  it('allows MAX for Pro (and a legacy PRO row)', async () => {
    h.me = { ...PRO };
    expect((await historyGET(get('/api/company/NVDA/history?range=MAX'), { params: { ticker: 'NVDA' } })).status).toBe(200);
    h.me = { ...PRO, plan: 'PRO' };
    expect((await historyGET(get('/api/company/NVDA/history?range=1D'), { params: { ticker: 'NVDA' } })).status).toBe(200);
  });
});

describe('company aggregate API', () => {
  it.each(['financials', 'estimates', 'ownership'])('403s an explicit ?section=%s for Free', async (section) => {
    h.me = { ...FREE };
    await expectUpgrade(await companyGET(get(`/api/company/NVDA?section=${section}`), { params: { ticker: 'NVDA' } }));
  });
  it('loads the aggregate with no premium access for Free', async () => {
    h.me = { ...FREE };
    expect((await companyGET(get('/api/company/NVDA'), { params: { ticker: 'NVDA' } })).status).toBe(200);
    expect(h.aggAccess).toEqual({ analystResearch: false, financials: false, ownership: false });
  });
  it('loads the full aggregate for Pro', async () => {
    h.me = { ...PRO };
    expect((await companyGET(get('/api/company/NVDA?section=estimates'), { params: { ticker: 'NVDA' } })).status).toBe(200);
    expect(h.aggAccess).toEqual({ analystResearch: true, financials: true, ownership: true });
  });
});

describe('AI endpoints reject Free', () => {
  it('POST /api/ai/chat', async () => {
    h.me = { ...FREE };
    await expectUpgrade(await chatPOST(post('/api/ai/chat', { message: 'How are NVDA margins?' })));
  });
  it('GET/POST /api/ai/notes', async () => {
    h.me = { ...FREE };
    await expectUpgrade(await notesGET(get('/api/ai/notes')));
    await expectUpgrade(await notesPOST(post('/api/ai/notes', { question: 'q', answerMarkdown: 'a' })));
  });
  it('GET /api/ai/threads and /api/ai/threads/:id', async () => {
    h.me = { ...FREE };
    await expectUpgrade(await threadsGET(get('/api/ai/threads')));
    await expectUpgrade(await threadGET(get('/api/ai/threads/t1'), { params: { id: 't1' } }));
  });
  it('Pro passes the gate', async () => {
    h.me = { ...PRO };
    expect((await threadsGET(get('/api/ai/threads'))).status).toBe(200);
  });
  it('signed-out requests are 401, not 403', async () => {
    expect((await threadsGET(get('/api/ai/threads'))).status).toBe(401);
  });
});
