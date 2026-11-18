import { z } from 'zod';
import { withApi, notFound } from '@/lib/http';
import { marketBySlug } from '@/lib/markets/global';
import { getMarketHistory, CHART_RANGES } from '@/lib/markets/detail';

export const dynamic = 'force-dynamic';

const query = z.object({ range: z.enum(CHART_RANGES as [string, ...string[]]).default('1Y') });

/** GET /api/markets/:slug/history?range=1M|3M|1Y|5Y → daily closes (index level, ETF proxy or FRED yield) + source. */
export const GET = withApi(async ({ params, query: q }) => {
  const m = marketBySlug(params.slug ?? '');
  if (!m) throw notFound('Unknown market');
  return getMarketHistory(m, q.range as (typeof CHART_RANGES)[number]);
}, { query });
