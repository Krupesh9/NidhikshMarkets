import { withApi } from '@/lib/http';
import { getUsage } from '@/lib/usage';

export const dynamic = 'force-dynamic';

/** GET /api/me → { user: SessionUser, usage } */
export const GET = withApi(async ({ user }) => {
  const u = await getUsage(user);
  return { user, usage: { period: u.period, aiQueries: u.aiQueries, deepDivesToday: u.deepDivesToday } };
});
