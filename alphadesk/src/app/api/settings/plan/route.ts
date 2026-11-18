import { z } from 'zod';
import { withApi } from '@/lib/http';
import { db } from '@/lib/db';
import { auditAsync } from '@/lib/audit';
import { PLAN_INFO, PLANS, asPlan } from '@/lib/plans';
import { planChangeSummary } from '@/components/settings/billing';

export const dynamic = 'force-dynamic';

/**
 * POST /api/settings/plan { plan: 'FREE'|'PRO'|'PRO_PLUS', cycle? } — DEMO BILLING: no payment is processed.
 * Updates the signed-in user's plan immediately (getSessionUser reads plan fresh from DB on every request).
 */
export const POST = withApi(
  async ({ user, body, correlationId }) => {
    const from = asPlan(user.plan);
    const to = body.plan;
    if (from !== to) await db.user.update({ where: { id: user.id }, data: { plan: to } });
    await auditAsync({ orgId: user.orgId, userId: user.id, action: 'settings.plan.change', target: user.id, correlationId, meta: { from, to, cycle: body.cycle, demo: true } });
    return { ok: true, plan: to, label: PLAN_INFO[to].label, changes: planChangeSummary(from, to), demo: true, note: 'Demo billing — no payment processed.' };
  },
  { body: z.object({ plan: z.enum(PLANS as [string, ...string[]]).transform((p) => asPlan(p)), cycle: z.enum(['monthly', 'yearly']).default('monthly') }), rateLimit: 'mutation' },
);
