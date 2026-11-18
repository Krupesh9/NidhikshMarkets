import { z } from 'zod';
import { withApi, badRequest, upgradeRequired } from '@/lib/http';
import { db } from '@/lib/db';
import { auditAsync } from '@/lib/audit';
import { assertFeature, checkLimit } from '@/lib/plans';
import { sanitizeText } from '@/lib/sanitize';
import { log } from '@/lib/log';
import { teamPayload } from '@/components/settings/team.server';

export const dynamic = 'force-dynamic';

/** GET /api/team → { org, members, seats: {used, limit}, canManage, gate } */
export const GET = withApi(async ({ user }) => teamPayload(user));

/**
 * POST /api/team { email, name?, role } — ADMIN + Pro Plus (team feature) + seat available.
 * Demo: creates the user record in the org (plan FREE) and logs a simulated invite link; they can sign in via dev magic link.
 */
export const POST = withApi(
  async ({ user, body, correlationId }) => {
    const gate = assertFeature(user, 'team');
    if (!gate.allowed) throw upgradeRequired(gate.reason ?? 'Team seats require Pro', gate.upgradeTo);
    const used = await db.user.count({ where: { orgId: user.orgId } });
    const seat = checkLimit(user, 'seats', used);
    if (!seat.allowed) throw upgradeRequired(`All ${seat.limit} seats are in use. Remove a member to invite someone new.`, seat.upgradeTo);
    const email = body.email.trim().toLowerCase();
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) throw badRequest(existing.orgId === user.orgId ? 'That person is already on your team.' : 'That email belongs to another organisation.');
    const created = await db.user.create({ data: { orgId: user.orgId, email, name: sanitizeText(body.name, 100) || email.split('@')[0], role: body.role, plan: 'FREE' } });
    log.info('team.invite_simulated', { email, link: `${process.env.NEXTAUTH_URL ?? 'http://127.0.0.1:4200'}/login?email=${encodeURIComponent(email)}` });
    await auditAsync({ orgId: user.orgId, userId: user.id, action: 'team.invite', target: email, correlationId, meta: { role: body.role } });
    return { ok: true, member: { id: created.id, email: created.email, name: created.name, role: created.role, plan: created.plan }, ...(await teamPayload(user)) };
  },
  {
    roles: ['ADMIN'],
    body: z.object({ email: z.string().trim().email().max(200), name: z.string().max(100).optional(), role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']).default('ANALYST') }),
    rateLimit: 'mutation',
  },
);
