import { z } from 'zod';
import { withApi, notFound } from '@/lib/http';
import { getPortfolioAnalytics } from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portfolios/:id/analytics?benchmark=SPY|QQQ|IWM&period=1M|3M|6M|YTD|1Y
 * → { status: 'ready', analytics, meta } (cached 5 min) or 202 { status: 'computing', jobId } for very large books.
 */
export const GET = withApi(
  async ({ user, params, query }) => {
    const r = await getPortfolioAnalytics({ orgId: user.orgId, userId: user.id }, params.id, { benchmark: query.benchmark, period: query.period });
    if (!r) throw notFound('Portfolio not found');
    if (r.status === 'computing') return Response.json(r, { status: 202 });
    return r;
  },
  { query: z.object({ benchmark: z.enum(['SPY', 'QQQ', 'IWM']).optional(), period: z.enum(['1M', '3M', '6M', 'YTD', '1Y']).optional() }), audit: 'portfolio.analytics' },
);
