import 'server-only';
import { db } from '@/lib/db';
import { assertFeature, PLAN_INFO, asPlan } from '@/lib/plans';

/** Org members + seat usage. Seat limit comes from the viewing admin's plan (Pro Plus: 5). */
export async function teamPayload(user: { orgId: string; plan: string; role: string }) {
  const [org, members] = await Promise.all([
    db.organization.findUnique({ where: { id: user.orgId }, select: { id: true, name: true } }),
    db.user.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, email: true, role: true, plan: true, createdAt: true } }),
  ]);
  const limit = PLAN_INFO[asPlan(user.plan)].limits.seats;
  const gate = assertFeature(user, 'team');
  return {
    org,
    members: members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    seats: { used: members.length, limit: limit === Infinity ? null : limit },
    canManage: user.role === 'ADMIN' && gate.allowed,
    gate,
  };
}
