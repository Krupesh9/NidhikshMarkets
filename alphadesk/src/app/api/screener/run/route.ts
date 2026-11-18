import { z } from 'zod';
import { badRequest, withApi } from '@/lib/http';
import { assertFeature } from '@/lib/plans';
import { parseSort, safeParseFilters, sortSchema } from '@/lib/screener/engine';
import { runScreenForPlan } from '@/lib/screener/service';

export const dynamic = 'force-dynamic';

const body = z.object({
  filters: z.record(z.string(), z.unknown()).default({}),
  sort: sortSchema.optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

/**
 * POST { filters, sort?, limit? } → ScreenRunResponse + gates.
 * FREE: first 3 filters applied (rest reported in droppedFilters), top 25 rows. Results cached 5 min per query.
 */
export const POST = withApi(
  async ({ user, body }) => {
    const f = safeParseFilters(body.filters);
    if (!f.ok) throw badRequest('Invalid filters', f.issues);
    const res = await runScreenForPlan(user.plan, f.filters, parseSort(body.sort), body.limit);
    return {
      ...res,
      plan: user.plan,
      gates: { export: assertFeature(user, 'export'), savedScreens: assertFeature(user, 'savedScreens'), sharing: assertFeature(user, 'sharing') },
    };
  },
  { body },
);
