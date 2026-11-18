import { withApi, badRequest, notFound } from '@/lib/http';
import { sanitizeTicker } from '@/lib/sanitize';
import { loadAggregate } from '@/components/company/server/data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/company/:ticker → full deep-dive aggregate (profile, quote, valuation, events, financials, estimates,
 * insiders, institutional, news, filings, catalysts) with per-section meta. Reused by the AI agent and sharing.
 * Does not count against the FREE deep-dive limit (the page does).
 */
export const GET = withApi(
  async ({ params }) => {
    const ticker = sanitizeTicker(params.ticker);
    if (!ticker) throw badRequest('Invalid ticker');
    const agg = await loadAggregate(ticker);
    if (!agg.found) throw notFound(`No data found for ${ticker}`);
    return agg;
  },
  { audit: 'data.company.view' },
);
