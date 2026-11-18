import { withApi } from '@/lib/http';
import { getUsage } from '@/lib/usage';
import { usageRepo } from '@/lib/repos';
import { PLAN_INFO } from '@/lib/plans';
import { nextResetDate } from '@/components/settings/billing';

export const dynamic = 'force-dynamic';

const lim = (n: number) => (n === Infinity ? null : n);

/** GET → { period, aiQueries, aiLimit (null = unlimited), deepDivesToday, deepDiveLimit, resetsAt, org? (ADMIN) } */
export const GET = withApi(async ({ user }) => {
  const u = await getUsage(user);
  const l = PLAN_INFO[user.plan].limits;
  const org = user.role === 'ADMIN' ? await usageRepo.orgTotals(user.orgId, u.period) : null;
  return {
    period: u.period, plan: user.plan, aiQueries: u.aiQueries, aiLimit: lim(l.aiQueriesPerMonth), deepDivesToday: u.deepDivesToday, deepDiveLimit: lim(l.deepDivesPerDay),
    resetsAt: nextResetDate().toISOString(),
    org: org ? { users: org.users, aiQueries: org.aiQueries } : null,
  };
});
