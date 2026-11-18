import { withApi } from '@/lib/http';
import { audit } from '@/lib/audit';
import { FACTORY_VALUATION_DEFAULTS, PROJECTION_YEARS, VALUATION_BOUNDS, valuationDefaultsSchema } from '@/lib/fundamentals/defaults';
import { readValuationSetting, resetValuationDefaults, saveValuationDefaults } from '@/lib/fundamentals/settings.server';

export const dynamic = 'force-dynamic';

// Owner-only automatically: withApi enforces canAccessSettings for every /api/settings/* path.

const payload = (s: Awaited<ReturnType<typeof readValuationSetting>>) => ({
  ...s, factory: FACTORY_VALUATION_DEFAULTS, bounds: VALUATION_BOUNDS, projectionYears: PROJECTION_YEARS,
});

/** GET → { defaults, factory, bounds, projectionYears, updatedAt, updatedById, isFactory } */
export const GET = withApi(async ({ user }) => payload(await readValuationSetting(user.orgId)));

/** PUT <ValuationDefaults> → saves the org-wide valuation defaults (zod-validated, bounded). */
export const PUT = withApi(
  async ({ user, body, correlationId }) => {
    const s = await saveValuationDefaults(user, body);
    audit({ orgId: user.orgId, userId: user.id, action: 'settings.valuation.update', target: 'valuation.defaults', correlationId, meta: { defaults: body } });
    return { ok: true, ...payload(s) };
  },
  { body: valuationDefaultsSchema, rateLimit: 'mutation' },
);

/** DELETE → reset to factory defaults. */
export const DELETE = withApi(
  async ({ user, correlationId }) => {
    const s = await resetValuationDefaults(user);
    audit({ orgId: user.orgId, userId: user.id, action: 'settings.valuation.update', target: 'valuation.defaults', correlationId, meta: { reset: 'factory' } });
    return { ok: true, ...payload(s) };
  },
  { rateLimit: 'mutation' },
);
