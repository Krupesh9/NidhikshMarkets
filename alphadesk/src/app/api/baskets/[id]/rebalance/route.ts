import { z } from 'zod';
import { withApi, notFound } from '@/lib/http';
import { getBasketRebalance } from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/baskets/:id/rebalance?since=1M|3M|6M|1Y|inception&notional=1000000&tolerance=0.02&mode=band|full
 * Drift of the synthetic basket since its (assumed) last rebalance + suggested trades to restore targets. Research only.
 */
export const GET = withApi(
  async ({ user, params, query }) => {
    const r = await getBasketRebalance({ orgId: user.orgId, userId: user.id }, params.id, {
      since: query.since, notional: query.notional ? Number(query.notional) : undefined, tolerance: query.tolerance ? Number(query.tolerance) : undefined, mode: query.mode,
    });
    if (!r) throw notFound('Basket not found');
    return r;
  },
  {
    query: z.object({
      since: z.enum(['1M', '3M', '6M', '1Y', 'inception']).optional(),
      notional: z.string().regex(/^\d+(\.\d+)?$/).refine((v) => Number(v) >= 1000 && Number(v) <= 1e10, 'notional must be between 1,000 and 10,000,000,000').optional(),
      tolerance: z.string().regex(/^\d*(\.\d+)?$/).refine((v) => Number(v) >= 0 && Number(v) <= 0.5, 'tolerance must be between 0 and 0.5').optional(),
      mode: z.enum(['band', 'full']).optional(),
    }),
    audit: 'basket.rebalance',
  },
);
