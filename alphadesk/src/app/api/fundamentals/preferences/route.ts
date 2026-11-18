import { requireFeature, withApi } from '@/lib/http';
import { preferencesBodySchema } from '@/lib/fundamentals/defaults';
import { getUserRequiredMos, setUserRequiredMos } from '@/lib/fundamentals/presets.server';
import { getValuationDefaults } from '@/lib/fundamentals/settings.server';

export const dynamic = 'force-dynamic';

/** GET → { requiredMos (yours or null), orgDefault, updatedAt } — your global required margin of safety. */
export const GET = withApi(async ({ user }) => {
  requireFeature(user, 'financials');
  const [mine, d] = await Promise.all([getUserRequiredMos(user.id), getValuationDefaults(user.orgId)]);
  return { ...mine, orgDefault: d.graham.requiredMos };
});

/** PUT { requiredMos } → saves your global required margin of safety (applies to every ticker without saved assumptions). */
export const PUT = withApi(
  async ({ user, body }) => {
    requireFeature(user, 'financials');
    return { ok: true, ...(await setUserRequiredMos(user, body.requiredMos)) };
  },
  { body: preferencesBodySchema, rateLimit: 'mutation' },
);
