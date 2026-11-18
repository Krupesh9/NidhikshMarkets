import { z } from 'zod';
import { withApi } from '@/lib/http';
import { audit } from '@/lib/audit';
import { KEY_PROVIDERS, PROVIDER_META, resolveKey, testProviderKey } from '@/components/settings/keys.server';

export const dynamic = 'force-dynamic';

/** POST { provider } → { ok, configured, source, status, latencyMs, message } — minimal provider call (model/reference listing). */
export const POST = withApi(
  async ({ user, body, correlationId }) => {
    const k = await resolveKey(user.id, body.provider);
    if (!k) return { ok: false, configured: false, message: `${PROVIDER_META[body.provider].label} is not configured. Add a key above (or set ${PROVIDER_META[body.provider].env[0]} in .env). The app falls back to mock data / mock AI.` };
    const r = await testProviderKey(body.provider, k.key);
    audit({ orgId: user.orgId, userId: user.id, action: 'settings.key.test', target: body.provider, correlationId, meta: { ok: r.ok, status: r.status ?? null, source: k.source } });
    return { ...r, configured: true, source: k.source };
  },
  { body: z.object({ provider: z.enum(KEY_PROVIDERS) }), rateLimit: 'mutation' },
);
