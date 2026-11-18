/**
 * Valuation defaults (owner-only Settings API) and per-user saved assumptions (Pro-only, own rows only).
 * Prisma is replaced by a small in-memory fake implementing the calls these modules make.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown> & { id: string; updatedAt: Date };
const h = vi.hoisted(() => ({
  me: null as null | Record<string, unknown>,
  settings: [] as Row[],
  presets: [] as Row[],
  audits: [] as { action: string; target?: string }[],
}));

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => h.me) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn((a: { action: string; target?: string }) => { h.audits.push(a); }), auditAsync: vi.fn(async () => undefined) }));
vi.mock('@/lib/db', () => {
  let n = 0;
  const match = (r: Row, where: Record<string, unknown>): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'NOT') return !match(r, v as Record<string, unknown>);
    if (v && typeof v === 'object' && !(v instanceof Date)) return match(r, v as Record<string, unknown>); // compound unique (orgId_key / userId_ticker)
    return r[k] === v;
  });
  const table = (rows: () => Row[]) => ({
    findUnique: async ({ where }: { where: Record<string, unknown> }) => rows().find((r) => match(r, where)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => rows().filter((r) => match(r, where)),
    upsert: async ({ where, create, update }: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const hit = rows().find((r) => match(r, where));
      if (hit) { Object.assign(hit, update, { updatedAt: new Date() }); return hit; }
      const r = { id: `r${++n}`, createdAt: new Date(), updatedAt: new Date(), note: null, growth: null, discount: null, terminal: null, requiredMos: null, updatedById: null, ...create } as Row;
      rows().push(r);
      return r;
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const keep = rows().filter((r) => !match(r, where));
      const count = rows().length - keep.length;
      rows().splice(0, rows().length, ...keep);
      return { count };
    },
  });
  const db = { appSetting: table(() => h.settings), valuationPreset: table(() => h.presets) };
  return { db, default: db };
});

import { cache } from '@/lib/cache';
import { GET as settingsGET, PUT as settingsPUT, DELETE as settingsDELETE } from '@/app/api/settings/valuation/route';
import { GET as presetGET, PUT as presetPUT, DELETE as presetDELETE } from '@/app/api/fundamentals/presets/[ticker]/route';
import { GET as listGET } from '@/app/api/fundamentals/presets/route';
import { GET as prefGET, PUT as prefPUT } from '@/app/api/fundamentals/preferences/route';
import { getValuationDefaults } from '@/lib/fundamentals/settings.server';
import { FACTORY_VALUATION_DEFAULTS, factoryDefaults } from '@/lib/fundamentals/defaults';

const ORIGIN = 'http://127.0.0.1:4200';
const req = (method: string, url: string, body?: unknown) => new NextRequest(`${ORIGIN}${url}`, {
  method, headers: { host: '127.0.0.1:4200', origin: ORIGIN, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const OWNER = { id: 'u_pm', orgId: 'o1', email: 'pm@x.dev', name: 'PM', role: 'ADMIN', plan: 'PRO_PLUS' };
const PRO = { id: 'u_pro', orgId: 'o1', email: 'pro@x.dev', name: 'Pro', role: 'ANALYST', plan: 'PRO_PLUS' };
const PRO2 = { id: 'u_pro2', orgId: 'o1', email: 'pro2@x.dev', name: 'Pro 2', role: 'ANALYST', plan: 'PRO_PLUS' };
const FREE = { id: 'u_free', orgId: 'o1', email: 'intern@x.dev', name: 'Intern', role: 'VIEWER', plan: 'FREE' };
const P = { params: { ticker: 'AAPL' } };
const body = { growth: 12, discount: 9, terminal: 2.5, requiredMos: 30 };

beforeEach(() => {
  h.me = null; h.settings.length = 0; h.presets.length = 0; h.audits.length = 0;
  cache.clear();
  delete process.env.PULSE_OWNER_EMAIL;
});

describe('/api/settings/valuation (owner only)', () => {
  it('401 signed out; 403 for non-owner roles; 403 for an ADMIN who is not PULSE_OWNER_EMAIL', async () => {
    expect((await settingsGET(req('GET', '/api/settings/valuation'))).status).toBe(401);
    h.me = { ...PRO };
    expect((await settingsGET(req('GET', '/api/settings/valuation'))).status).toBe(403);
    expect((await settingsPUT(req('PUT', '/api/settings/valuation', factoryDefaults()))).status).toBe(403);
    expect((await settingsDELETE(req('DELETE', '/api/settings/valuation'))).status).toBe(403);
    process.env.PULSE_OWNER_EMAIL = 'someone-else@x.dev';
    h.me = { ...OWNER };
    expect((await settingsGET(req('GET', '/api/settings/valuation'))).status).toBe(403);
    expect(h.settings).toHaveLength(0);
  });

  it('owner: first read persists factory defaults; PUT validates, saves, audits and busts the cache; DELETE resets', async () => {
    h.me = { ...OWNER };
    const g = await (await settingsGET(req('GET', '/api/settings/valuation'))).json();
    expect(g.defaults).toEqual(FACTORY_VALUATION_DEFAULTS);
    expect(g.isFactory).toBe(true);
    expect(h.settings).toHaveLength(1); // saved out of the box
    expect(await getValuationDefaults('o1')).toEqual(FACTORY_VALUATION_DEFAULTS); // now cached

    const bad = factoryDefaults(); bad.dcf.erp = 40;
    const r400 = await settingsPUT(req('PUT', '/api/settings/valuation', bad));
    expect(r400.status).toBe(400);

    const next = factoryDefaults(); next.dcf.discountMode = 'capm'; next.dcf.erp = 6; next.graham.requiredMos = 30;
    const r = await settingsPUT(req('PUT', '/api/settings/valuation', next));
    expect(r.status).toBe(200);
    expect((await r.json()).isFactory).toBe(false);
    expect(h.audits.map((a) => a.action)).toContain('settings.valuation.update');
    expect((await getValuationDefaults('o1')).dcf.erp).toBe(6); // cache busted on save
    expect(h.settings[0].updatedById).toBe('u_pm');

    const d = await (await settingsDELETE(req('DELETE', '/api/settings/valuation'))).json();
    expect(d.defaults).toEqual(FACTORY_VALUATION_DEFAULTS);
    expect(await getValuationDefaults('o1')).toEqual(FACTORY_VALUATION_DEFAULTS);
  });
});

describe('/api/fundamentals/presets/:ticker (Pro, own rows only)', () => {
  it('Free → 403 upgrade_required on GET/PUT/DELETE and list', async () => {
    h.me = { ...FREE };
    for (const res of [await presetGET(req('GET', '/api/fundamentals/presets/AAPL'), P), await presetPUT(req('PUT', '/api/fundamentals/presets/AAPL', body), P), await presetDELETE(req('DELETE', '/api/fundamentals/presets/AAPL'), P), await listGET(req('GET', '/api/fundamentals/presets')), await prefPUT(req('PUT', '/api/fundamentals/preferences', { requiredMos: 10 }))]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('upgrade_required');
    }
    expect(h.presets).toHaveLength(0);
  });

  it('Pro: save → load → delete; bad body 400; bad ticker 400', async () => {
    h.me = { ...PRO };
    expect((await presetGET(req('GET', '/api/fundamentals/presets/AAPL'), P)).status).toBe(404);
    expect((await presetPUT(req('PUT', '/api/fundamentals/presets/AAPL', { ...body, discount: 2 }), P)).status).toBe(400);
    expect((await presetPUT(req('PUT', '/api/fundamentals/presets/AAPL', { ...body, requiredMos: 120 }), P)).status).toBe(400);
    expect((await presetPUT(req('PUT', '/api/fundamentals/presets/$$', body), { params: { ticker: '$$' } })).status).toBe(400);
    const s = await presetPUT(req('PUT', '/api/fundamentals/presets/AAPL', body), P);
    expect(s.status).toBe(200);
    expect((await s.json()).preset).toMatchObject({ ticker: 'AAPL', ...body });
    expect((await (await presetGET(req('GET', '/api/fundamentals/presets/AAPL'), P)).json()).preset).toMatchObject(body);
    expect((await (await listGET(req('GET', '/api/fundamentals/presets'))).json()).presets).toHaveLength(1);
    expect(h.audits.map((a) => a.action)).toContain('fundamentals.preset.save');
    expect((await presetDELETE(req('DELETE', '/api/fundamentals/presets/AAPL'), P)).status).toBe(200);
    expect((await presetGET(req('GET', '/api/fundamentals/presets/AAPL'), P)).status).toBe(404);
    expect((await presetDELETE(req('DELETE', '/api/fundamentals/presets/AAPL'), P)).status).toBe(404);
  });

  it("another user's preset is invisible (404) and untouched", async () => {
    h.me = { ...PRO2 };
    await presetPUT(req('PUT', '/api/fundamentals/presets/AAPL', body), P);
    h.me = { ...PRO };
    expect((await presetGET(req('GET', '/api/fundamentals/presets/AAPL'), P)).status).toBe(404);
    expect((await presetDELETE(req('DELETE', '/api/fundamentals/presets/AAPL'), P)).status).toBe(404);
    expect((await (await listGET(req('GET', '/api/fundamentals/presets'))).json()).presets).toHaveLength(0);
    // saving creates the caller's own row, never overwrites the other user's
    await presetPUT(req('PUT', '/api/fundamentals/presets/AAPL', { ...body, growth: 3 }), P);
    expect(h.presets.find((r) => r.userId === 'u_pro2')?.growth).toBe(12);
    expect(h.presets.find((r) => r.userId === 'u_pro')?.growth).toBe(3);
  });

  it('global required margin of safety: org default until saved', async () => {
    h.me = { ...PRO };
    expect(await (await prefGET(req('GET', '/api/fundamentals/preferences'))).json()).toMatchObject({ requiredMos: null, orgDefault: 20 });
    expect((await prefPUT(req('PUT', '/api/fundamentals/preferences', { requiredMos: 95 }))).status).toBe(400);
    expect((await prefPUT(req('PUT', '/api/fundamentals/preferences', { requiredMos: 35 }))).status).toBe(200);
    expect((await (await prefGET(req('GET', '/api/fundamentals/preferences'))).json()).requiredMos).toBe(35);
    // the global row is not listed as a ticker preset
    expect((await (await listGET(req('GET', '/api/fundamentals/presets'))).json()).presets).toHaveLength(0);
  });
});
