import { z } from 'zod';
import { withApi, badRequest } from '@/lib/http';
import { sanitizeTicker } from '@/lib/sanitize';
import { getMarketData } from '@/lib/data';
import { downsampleBars } from '@/components/company/lib/helpers';

export const dynamic = 'force-dynamic';

const RANGES = ['1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX'] as const;

/** GET /api/company/:ticker/history?range=1Y[&maxPoints=1200] → { ticker, range, bars, downsampled, meta } */
export const GET = withApi(
  async ({ params, query }) => {
    const ticker = sanitizeTicker(params.ticker);
    if (!ticker) throw badRequest('Invalid ticker');
    const { data, meta } = await getMarketData().getHistory(ticker, query.range);
    const bars = downsampleBars(data ?? [], query.maxPoints);
    return { ticker, range: query.range, bars, downsampled: bars.length !== (data ?? []).length, rawCount: (data ?? []).length, meta };
  },
  { query: z.object({ range: z.enum(RANGES).default('1Y'), maxPoints: z.coerce.number().int().min(50).max(10000).default(1200) }) },
);
