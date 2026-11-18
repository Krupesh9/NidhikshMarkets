import { z } from 'zod';
import { badRequest, notFound, upgradeRequired, withApi } from '@/lib/http';
import { assertFeature } from '@/lib/plans';
import { screenRepo } from '@/lib/repos';
import { sanitizeText } from '@/lib/sanitize';
import { fromSavedScreen, safeParseFilters, sortSchema, toSavedScreen } from '@/lib/screener/engine';

export const dynamic = 'force-dynamic';

const scope = (u: { orgId: string; id: string }) => ({ orgId: u.orgId, userId: u.id });

/** GET → { screens: SavedScreen[] } (org-scoped). `?id=` → { screen }. */
export const GET = withApi(
  async ({ user, query }) => {
    if (query.id) {
      const s = await screenRepo.get(scope(user), query.id);
      if (!s) throw notFound('Saved screen not found');
      return { screen: { ...s, ...fromSavedScreen(s) } };
    }
    const screens = await screenRepo.list(scope(user));
    return { screens: screens.map((s) => ({ ...s, ...fromSavedScreen(s) })) };
  },
  { query: z.object({ id: z.string().max(64).optional() }) },
);

/** POST { id?, name, description?, filters, columns, sort } → create (or update when id given). */
export const POST = withApi(
  async ({ user, body }) => {
    const gate = assertFeature(user, 'savedScreens');
    if (!gate.allowed) throw upgradeRequired(gate.reason ?? 'Saved screens require an upgrade', gate.upgradeTo);
    const name = sanitizeText(body.name).trim();
    if (!name) throw badRequest('Name is required');
    const f = safeParseFilters(body.filters);
    if (!f.ok) throw badRequest('Invalid filters', f.issues);
    const input = toSavedScreen(name, { filters: f.filters, columns: body.columns, sort: body.sort }, body.description ? sanitizeText(body.description) : null);
    if (body.id) {
      const ok = await screenRepo.update(scope(user), body.id, input);
      if (!ok) throw notFound('Saved screen not found');
      return { screen: await screenRepo.get(scope(user), body.id) };
    }
    return { screen: await screenRepo.create(scope(user), input) };
  },
  {
    body: z.object({
      id: z.string().max(64).optional(),
      name: z.string().min(1).max(80),
      description: z.string().max(280).optional(),
      filters: z.record(z.string(), z.unknown()).default({}),
      columns: z.array(z.string().max(40)).max(40).default([]),
      sort: sortSchema.default([]),
    }),
    rateLimit: 'mutation',
    audit: 'screen.save',
  },
);

/** DELETE ?id= */
export const DELETE = withApi(
  async ({ user, query }) => {
    const ok = await screenRepo.remove(scope(user), query.id);
    if (!ok) throw notFound('Saved screen not found');
    return { ok: true };
  },
  { query: z.object({ id: z.string().min(1).max(64) }), rateLimit: 'mutation', audit: 'screen.delete' },
);
