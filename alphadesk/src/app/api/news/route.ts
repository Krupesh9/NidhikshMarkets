import { z } from 'zod';
import { withApi } from '@/lib/http';
import { getHeadlinesWithStatus } from '@/lib/news';
import { screenRepo } from '@/lib/repos';

export const dynamic = 'force-dynamic';

const csv = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);

/**
 * GET /api/news?tickers=AAPL,NVDA&sources=cnbc-top,reuters&limit=50&watchlist=1&only=1
 * → { data: NewsItem[], meta: { sources: [{id,name,ok,count}], asOf } }
 * `watchlist=1` uses the signed-in user's watchlist when `tickers` is omitted; `only=1` keeps only ticker matches.
 */
export const GET = withApi(
  async ({ user, query }) => {
    let tickers = csv(query.tickers)?.slice(0, 25);
    if (!tickers && query.watchlist === '1') {
      tickers = (await screenRepo.getWatchlist({ orgId: user.orgId, userId: user.id }))?.symbols ?? [];
    }
    const r = await getHeadlinesWithStatus({
      tickers,
      sources: csv(query.sources),
      limit: query.limit ? Number(query.limit) || undefined : undefined,
      onlyMatching: query.only === '1',
    });
    return { data: r.items, meta: { sources: r.sources, asOf: r.asOf } };
  },
  {
    query: z.object({
      tickers: z.string().max(400).optional(),
      sources: z.string().max(600).optional(),
      limit: z.string().regex(/^\d{1,3}$/).optional(),
      watchlist: z.enum(['0', '1']).optional(),
      only: z.enum(['0', '1']).optional(),
    }),
  },
);
