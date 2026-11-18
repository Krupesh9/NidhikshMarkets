import { z } from 'zod';
import { withApi } from '@/lib/http';
import { PLAN_INFO } from '@/lib/plans';
import { changeMemberPlan } from '@/components/settings/plan-admin.server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/settings/plan { userId?, plan: 'FREE'|'PRO_PLUS' } — ADMIN only (role read fresh from the DB).
 * There is no self-serve plan change: an admin sets plans for members of their org; changing your own plan is
 * allowed only for the deployment owner (PULSE_OWNER_EMAIL). Billing (Stripe) is not wired up yet.
 */
export const POST = withApi(
  async ({ user, body, correlationId }) => {
    const r = await changeMemberPlan(user, body.userId ?? user.id, body.plan, correlationId);
    return { ok: true, userId: body.userId ?? user.id, plan: r.to, label: PLAN_INFO[r.to].label };
  },
  {
    roles: ['ADMIN'],
    body: z.object({ userId: z.string().min(1).max(100).optional(), plan: z.enum(['FREE', 'PRO', 'PRO_PLUS']) }),
    rateLimit: 'mutation',
  },
);
