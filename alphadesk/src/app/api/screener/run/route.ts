import { z } from 'zod';
import { badRequest, withApi } from '@/lib/http';
import { assertFeature } from '@/lib/plans';
import { parseSort, safeParseFilters, sortSchema } from '@/lib/screener/engine';
import { MAX_GROUP_LEN, MAX_LIST } from '@/lib/screener/list';
import { runScreenForPlan } from '@/lib/screener/service';

export const dynamic = 'force-dynamic';

const body = z.object({
  filters: z.record(z.string(), z.unknown()).default({}),
  sort: sortSchema.optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  /** the screen's ticker list; omitted/null = the user's default list. Invalid symbols are dropped. */
  tickers: z.array(z.string().max(12)).max(MAX_LIST).nullable().optional(),
  groups: z.record(z.string().max(12), z.string().max(MAX_GROUP_LEN)).optional(),
});

/**
 * POST { filters, sort?, limit?, tickers?, groups? } → ScreenRunResponse + gates.
 * Rows = the ticker list with live data (Alpaca, SEC EDGAR, FMP, Alpha Vantage); filters apply on top.
 * FREE: first 3 filters applied (rest reported in droppedFilters), top 25 rows. Per-ticker data cached 5 min.
 */
export const POST = withApi(
  async ({ user, body }) => {
    const f = safeParseFilters(body.filters);
    if (!f.ok) throw badRequest('Invalid filters', f.issues);
    const res = await runScreenForPlan(user, { filters: f.filters, sort: parseSort(body.sort), limit: body.limit, tickers: body.tickers ?? null, groups: body.groups });
    return {
      ...res,
      plan: user.plan,
      gates: { export: assertFeature(user, 'export'), savedScreens: assertFeature(user, 'savedScreens'), sharing: assertFeature(user, 'sharing') },
    };
  },
  { body },
);
