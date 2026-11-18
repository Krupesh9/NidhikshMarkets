import { z } from 'zod';
import { withApi, badRequest, upgradeRequired } from '@/lib/http';
import { chartRangeAllowed } from '@/lib/plans';
import { sanitizeTicker } from '@/lib/sanitize';
import { getMarketData } from '@/lib/data';
import { downsampleBars } from '@/components/company/lib/helpers';

export const dynamic = 'force-dynamic';

const RANGES = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX'] as const;

/** GET /api/company/:ticker/history?range=1D|1W|1M|…|MAX[&maxPoints=1200] → { ticker, range, bars, downsampled, meta }. 1D/1W bars carry ISO timestamps. */
export const GET = withApi(
  async ({ params, query, user }) => {
    const ticker = sanitizeTicker(params.ticker);
    if (!ticker) throw badRequest('Invalid ticker');
    // 1D/1W intraday and 5Y/MAX history (used for long-window indicators) are Pro. Plan is read fresh from the DB.
    if (!chartRangeAllowed(user, query.range)) throw upgradeRequired(`The ${query.range} range is part of Pro · $100/mo (advanced charting).`, 'PRO_PLUS');
    const { data, meta } = await getMarketData().getHistory(ticker, query.range);
    const bars = downsampleBars(data ?? [], query.maxPoints);
    return { ticker, range: query.range, bars, downsampled: bars.length !== (data ?? []).length, rawCount: (data ?? []).length, meta };
  },
  { query: z.object({ range: z.enum(RANGES).default('1Y'), maxPoints: z.coerce.number().int().min(50).max(10000).default(1200) }) },
);
