import 'server-only';
import { db } from '@/lib/db';
import { auditAsync } from '@/lib/audit';
import { ApiError, forbidden, notFound } from '@/lib/http';
import { normalizePlan, PLAN_INFO, type Plan } from '@/lib/plans';
import type { SessionUser } from '@/lib/auth';

/** The deployment owner (PULSE_OWNER_EMAIL). Only the owner may change their own plan. */
export function isOwner(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const owner = env.PULSE_OWNER_EMAIL?.trim().toLowerCase();
  return !!owner && !!email && email.trim().toLowerCase() === owner;
}

/**
 * Change a member's plan. Rules (actor comes fresh from the DB via getSessionUser — never from the JWT or client):
 *   - actor must be ADMIN
 *   - target must be in the actor's org
 *   - changing your OWN plan is allowed only for the deployment owner (prevents a Free admin self-upgrading)
 * Every change is written to the audit log.
 */
export async function changeMemberPlan(actor: SessionUser, targetId: string, plan: string, correlationId?: string): Promise<{ from: Plan; to: Plan; email: string }> {
  if (actor.role !== 'ADMIN') throw forbidden('Only admins can change plans');
  const to = normalizePlan(plan);
  if (targetId === actor.id && !isOwner(actor.email)) throw new ApiError(403, 'forbidden', 'Only the workspace owner can change their own plan');
  const m = await db.user.findFirst({ where: { id: targetId, orgId: actor.orgId } });
  if (!m) throw notFound('Member not found');
  const from = normalizePlan(m.plan);
  if (from !== to || m.plan !== to) await db.user.update({ where: { id: m.id }, data: { plan: to } });
  await auditAsync({ orgId: actor.orgId, userId: actor.id, action: 'settings.plan.change', target: m.email, correlationId, meta: { from, to, label: PLAN_INFO[to].label } });
  return { from, to, email: m.email };
}
