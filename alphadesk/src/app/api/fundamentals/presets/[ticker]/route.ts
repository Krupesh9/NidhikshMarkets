import { badRequest, notFound, requireFeature, withApi } from '@/lib/http';
import { audit } from '@/lib/audit';
import { sanitizeTicker } from '@/lib/sanitize';
import { presetBodySchema } from '@/lib/fundamentals/defaults';
import { deletePreset, getPreset, savePreset } from '@/lib/fundamentals/presets.server';

export const dynamic = 'force-dynamic';

// Pro-gated like /api/company/:ticker/fundamentals. Rows are always looked up by the session user's id, so another
// user's preset is simply "not found" (404) — there is no way to address someone else's row.
function tickerOf(params: Record<string, string>): string {
  const t = sanitizeTicker(params.ticker);
  if (!t) throw badRequest('Invalid ticker');
  return t;
}

/** GET → { preset } (404 when you have no saved assumptions for this ticker) */
export const GET = withApi(async ({ user, params }) => {
  requireFeature(user, 'financials');
  const preset = await getPreset(user.id, tickerOf(params));
  if (!preset) throw notFound('No saved assumptions for this ticker');
  return { preset };
});

/** PUT { growth, discount, terminal, requiredMos, note? } (percents) → { preset } */
export const PUT = withApi(
  async ({ user, params, body, correlationId }) => {
    requireFeature(user, 'financials');
    const ticker = tickerOf(params);
    const preset = await savePreset(user, ticker, body);
    audit({ orgId: user.orgId, userId: user.id, action: 'fundamentals.preset.save', target: ticker, correlationId });
    return { ok: true, preset };
  },
  { body: presetBodySchema, rateLimit: 'mutation' },
);

/** DELETE → clears your saved assumptions (404 when there were none). */
export const DELETE = withApi(
  async ({ user, params, correlationId }) => {
    requireFeature(user, 'financials');
    const ticker = tickerOf(params);
    if (!(await deletePreset(user.id, ticker))) throw notFound('No saved assumptions for this ticker');
    audit({ orgId: user.orgId, userId: user.id, action: 'fundamentals.preset.delete', target: ticker, correlationId });
    return { ok: true };
  },
  { rateLimit: 'mutation' },
);
