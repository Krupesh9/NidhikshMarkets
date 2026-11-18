import { withApi } from '@/lib/http';
import { getUsage } from '@/lib/usage';
import { assertFeature, checkLimit } from '@/lib/plans';
import { publicProviderInfo, resolveProvider } from '@/lib/ai';

export const dynamic = 'force-dynamic';

/** GET /api/ai/status → which provider/model will answer, plus AI gate + usage for the meter. No secrets. */
export const GET = withApi(async ({ user }) => {
  const [choice, usage] = await Promise.all([resolveProvider(user), getUsage(user)]);
  const feature = assertFeature(user, 'ai');
  const limit = checkLimit(user, 'aiQueriesPerMonth', usage.aiQueries);
  const gate = feature.allowed ? limit : feature;
  return {
    ...publicProviderInfo(choice),
    gate: { allowed: gate.allowed, reason: gate.reason ?? null, upgradeTo: gate.upgradeTo ?? null },
    usage: { used: usage.aiQueries, limit: limit.limit === Infinity ? null : limit.limit ?? null, remaining: limit.remaining === Infinity ? null : limit.remaining ?? null },
  };
});
