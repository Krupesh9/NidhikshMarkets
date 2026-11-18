/**
 * Plan changes are ADMIN-only (role read from the DB on every request), scoped to the org, and an admin may change
 * their OWN plan only when they are the deployment owner (PULSE_OWNER_EMAIL).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  me: null as null | Record<string, unknown>,
  users: new Map<string, Record<string, unknown>>(),
  audits: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => h.me) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), auditAsync: vi.fn(async (e: Record<string, unknown>) => { h.audits.push(e); }) }));
vi.mock('@/lib/db', () => {
  const user = {
    findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
      const u = h.users.get(where.id);
      return u && u.orgId === where.orgId ? u : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const u = { ...h.users.get(where.id)!, ...data };
      h.users.set(where.id, u);
      return u;
    },
    count: async () => 1,
  };
  return { db: { user }, default: { user } };
});

import { POST as planPOST } from '@/app/api/settings/plan/route';
import { PATCH as teamPATCH } from '@/app/api/team/[id]/route';

const ADMIN = { id: 'u_admin', orgId: 'o1', email: 'admin@x.dev', name: 'Admin', role: 'ADMIN', plan: 'FREE' };
const OWNER = { id: 'u_owner', orgId: 'o1', email: 'owner@x.dev', name: 'Owner', role: 'ADMIN', plan: 'PRO_PLUS' };
const VIEWER = { id: 'u_view', orgId: 'o1', email: 'viewer@x.dev', name: 'Viewer', role: 'VIEWER', plan: 'FREE' };
const OTHER_ORG = { id: 'u_other', orgId: 'o2', email: 'o@y.dev', name: 'Other', role: 'ANALYST', plan: 'FREE' };

const req = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://127.0.0.1:4200${url}`, { method, headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:4200', host: '127.0.0.1:4200' }, body: JSON.stringify(body) });

beforeEach(() => {
  h.users.clear();
  for (const u of [ADMIN, OWNER, VIEWER, OTHER_ORG]) h.users.set(u.id, { ...u });
  h.audits = [];
  process.env.PULSE_OWNER_EMAIL = 'owner@x.dev';
});

describe('POST /api/settings/plan', () => {
  it('rejects a non-admin (403), even for their own plan', async () => {
    h.me = { ...VIEWER };
    const r = await planPOST(req('/api/settings/plan', 'POST', { plan: 'PRO_PLUS' }));
    expect(r.status).toBe(403);
    expect(h.users.get(VIEWER.id)!.plan).toBe('FREE');
  });
  it('rejects an admin changing their own plan unless they are the owner', async () => {
    h.me = { ...ADMIN };
    const r = await planPOST(req('/api/settings/plan', 'POST', { plan: 'PRO_PLUS' }));
    expect(r.status).toBe(403);
    expect(h.users.get(ADMIN.id)!.plan).toBe('FREE');
  });
  it('lets the owner change their own plan', async () => {
    h.me = { ...OWNER };
    const r = await planPOST(req('/api/settings/plan', 'POST', { plan: 'FREE' }));
    expect(r.status).toBe(200);
    expect(h.users.get(OWNER.id)!.plan).toBe('FREE');
  });
  it('rejects a non-owner admin changing another member (settings are owner-only)', async () => {
    h.me = { ...ADMIN };
    const r = await planPOST(req('/api/settings/plan', 'POST', { userId: VIEWER.id, plan: 'PRO_PLUS' }));
    expect(r.status).toBe(403);
    expect(h.users.get(VIEWER.id)!.plan).toBe('FREE');
  });
  it('lets the owner change another member, normalising legacy PRO to PRO_PLUS, and audits it', async () => {
    h.me = { ...OWNER };
    const r = await planPOST(req('/api/settings/plan', 'POST', { userId: VIEWER.id, plan: 'PRO' }));
    expect(r.status).toBe(200);
    expect(h.users.get(VIEWER.id)!.plan).toBe('PRO_PLUS');
    expect(h.audits.some((a) => a.action === 'settings.plan.change')).toBe(true);
  });
  it('cannot reach members of another org', async () => {
    h.me = { ...OWNER };
    const r = await planPOST(req('/api/settings/plan', 'POST', { userId: OTHER_ORG.id, plan: 'PRO_PLUS' }));
    expect(r.status).toBe(404);
  });
  it('rejects unknown plans', async () => {
    h.me = { ...OWNER };
    const r = await planPOST(req('/api/settings/plan', 'POST', { plan: 'ENTERPRISE' }));
    expect(r.status).toBe(400);
  });
});

describe('PATCH /api/team/:id', () => {
  const ctx = (id: string) => ({ params: { id } });
  it('owner can set a member plan; a non-owner admin cannot', async () => {
    h.me = { ...ADMIN };
    expect((await teamPATCH(req(`/api/team/${VIEWER.id}`, 'PATCH', { plan: 'PRO_PLUS' }), ctx(VIEWER.id))).status).toBe(403);
    h.me = { ...OWNER };
    const r = await teamPATCH(req(`/api/team/${VIEWER.id}`, 'PATCH', { plan: 'PRO_PLUS' }), ctx(VIEWER.id));
    expect(r.status).toBe(200);
    expect(h.users.get(VIEWER.id)!.plan).toBe('PRO_PLUS');
  });
  it('non-admin gets 403', async () => {
    h.me = { ...VIEWER };
    const r = await teamPATCH(req(`/api/team/${VIEWER.id}`, 'PATCH', { plan: 'PRO_PLUS' }), ctx(VIEWER.id));
    expect(r.status).toBe(403);
    expect(h.users.get(VIEWER.id)!.plan).toBe('FREE');
  });
  it('admin (not owner) cannot upgrade themselves via team PATCH', async () => {
    h.me = { ...ADMIN };
    const r = await teamPATCH(req(`/api/team/${ADMIN.id}`, 'PATCH', { plan: 'PRO_PLUS' }), ctx(ADMIN.id));
    expect(r.status).toBe(403);
    expect(h.users.get(ADMIN.id)!.plan).toBe('FREE');
  });
});
