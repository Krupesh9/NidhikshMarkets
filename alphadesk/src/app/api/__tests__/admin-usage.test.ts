/** GET /api/admin/usage is owner/ADMIN only: 401 signed out, 403 for other roles, snapshot for ADMIN. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ me: null as null | Record<string, unknown> }));
vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => h.me) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), auditAsync: vi.fn(async () => undefined) }));
vi.mock('@/lib/db', () => ({ db: {}, default: {} }));

import { GET } from '@/app/api/admin/usage/route';
import { __resetUsageMeterForTests, recordCall } from '@/lib/usage-meter';

const get = () => new NextRequest('http://127.0.0.1:4200/api/admin/usage', { headers: { host: '127.0.0.1:4200' } });
const ADMIN = { id: 'u_a', orgId: 'o1', email: 'pm@x.dev', name: 'PM', role: 'ADMIN', plan: 'PRO_PLUS' };
const VIEWER = { id: 'u_v', orgId: 'o1', email: 'intern@x.dev', name: 'Intern', role: 'VIEWER', plan: 'FREE' };

beforeEach(() => {
  h.me = null;
  delete process.env.PULSE_OWNER_EMAIL;
  __resetUsageMeterForTests({ file: `/nonexistent-dir-${Date.now()}/usage-meter.json` });
});

describe('GET /api/admin/usage', () => {
  it('401 when signed out', async () => {
    expect((await GET(get())).status).toBe(401);
  });
  it.each(['VIEWER', 'ANALYST', 'PM'])('403 for %s', async (role) => {
    h.me = { ...VIEWER, role };
    const r = await GET(get());
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('forbidden');
  });
  it('returns the snapshot for ADMIN (numbers and status only)', async () => {
    h.me = { ...ADMIN };
    recordCall('fmp', { ok: false, status: 429, endpoint: 'https://financialmodelingprep.com/stable/quote?apikey=SECRET' });
    const r = await GET(get());
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain('SECRET');
    const j = JSON.parse(text);
    const fmp = j.providers.find((p: { id: string }) => p.id === 'fmp');
    expect(fmp).toMatchObject({ usedToday: 1, status: 'blocked', limitLabel: '250 / day' });
    expect(j.alerts[0].id).toBe('fmp');
  });
});
