import { z } from 'zod';
import { withApi } from '@/lib/http';
import { audit } from '@/lib/audit';
import { KEY_PROVIDERS, deleteKey, listKeys, saveKey } from '@/components/settings/keys.server';

export const dynamic = 'force-dynamic';

/** GET → { keys: KeyStatus[] } (masked last-4 only; never plaintext). */
export const GET = withApi(async ({ user }) => ({ keys: await listKeys(user.id) }));

/** PUT { provider, key } → encrypts (AES-256-GCM) and stores; returns masked value. */
export const PUT = withApi(
  async ({ user, body, correlationId }) => {
    const r = await saveKey(user, body.provider, body.key);
    audit({ orgId: user.orgId, userId: user.id, action: 'settings.key.save', target: body.provider, correlationId });
    return { ok: true, ...r, keys: await listKeys(user.id) };
  },
  {
    body: z.object({ provider: z.enum(KEY_PROVIDERS), key: z.string().trim().min(8, 'Key looks too short').max(500).regex(/^[\x21-\x7E]+$/, 'Key must not contain spaces or non-ASCII characters') }),
    rateLimit: 'mutation',
  },
);

/** DELETE ?provider=anthropic */
export const DELETE = withApi(
  async ({ user, query, correlationId }) => {
    const removed = await deleteKey(user.id, query.provider);
    audit({ orgId: user.orgId, userId: user.id, action: 'settings.key.delete', target: query.provider, correlationId });
    return { ok: true, removed, keys: await listKeys(user.id) };
  },
  { query: z.object({ provider: z.enum(KEY_PROVIDERS) }), rateLimit: 'mutation' },
);
