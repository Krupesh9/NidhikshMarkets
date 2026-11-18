import { z } from 'zod';
import { withApi, badRequest, notFound } from '@/lib/http';
import { db } from '@/lib/db';
import { auditAsync } from '@/lib/audit';

export const dynamic = 'force-dynamic';

async function member(orgId: string, id: string) {
  const m = await db.user.findFirst({ where: { id, orgId } });
  if (!m) throw notFound('Member not found');
  return m;
}
async function adminsLeft(orgId: string, excludingId: string) {
  return db.user.count({ where: { orgId, role: 'ADMIN', id: { not: excludingId } } });
}

/** PATCH /api/team/:id { role } — ADMIN only; cannot remove the last admin. */
export const PATCH = withApi(
  async ({ user, params, body, correlationId }) => {
    const m = await member(user.orgId, params.id);
    if (m.role === 'ADMIN' && body.role !== 'ADMIN' && (await adminsLeft(user.orgId, m.id)) === 0) throw badRequest('Your organisation needs at least one admin.');
    await db.user.update({ where: { id: m.id }, data: { role: body.role } });
    await auditAsync({ orgId: user.orgId, userId: user.id, action: 'team.role.change', target: m.email, correlationId, meta: { from: m.role, to: body.role } });
    return { ok: true };
  },
  { roles: ['ADMIN'], body: z.object({ role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']) }), rateLimit: 'mutation' },
);

/** DELETE /api/team/:id — ADMIN only; cannot remove yourself. Frees a seat. */
export const DELETE = withApi(
  async ({ user, params, correlationId }) => {
    if (params.id === user.id) throw badRequest('You cannot remove yourself.');
    const m = await member(user.orgId, params.id);
    if (m.role === 'ADMIN' && (await adminsLeft(user.orgId, m.id)) === 0) throw badRequest('Your organisation needs at least one admin.');
    await db.user.delete({ where: { id: m.id } });
    await auditAsync({ orgId: user.orgId, userId: user.id, action: 'team.remove', target: m.email, correlationId });
    return { ok: true };
  },
  { roles: ['ADMIN'], rateLimit: 'mutation' },
);
