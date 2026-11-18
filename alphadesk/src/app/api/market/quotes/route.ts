import { z } from 'zod';
import { withApi } from '@/lib/http';
import { getMarketData } from '@/lib/data';
import { sanitizeTicker } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

/** GET /api/market/quotes?tickers=AAPL,MSFT → { data: Quote[], meta } */
export const GET = withApi(
  async ({ query }) => {
    const tickers = query.tickers.split(',').map(sanitizeTicker).filter((t): t is string => !!t).slice(0, 100);
    return getMarketData().getQuotes(tickers);
  },
  { query: z.object({ tickers: z.string().min(1).max(1200) }) },
);
