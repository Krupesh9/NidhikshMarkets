import { z } from 'zod';
import { withApi, badRequest, notFound, requireFeature } from '@/lib/http';
import { sanitizeTicker } from '@/lib/sanitize';
import { companyAccess, loadAggregate } from '@/components/company/server/data';

export const dynamic = 'force-dynamic';

const SECTION = z.object({ section: z.enum(['financials', 'estimates', 'ownership']).optional() });

/**
 * GET /api/company/:ticker[?section=financials|estimates|ownership] → deep-dive aggregate
 * Plan-aware: premium sections (financials/EV, analyst research, ownership) are never loaded for Free users and are
 * listed in `locked`. Asking for a premium `section` explicitly returns 403 upgrade_required for Free users.
 * Full aggregate (profile, quote, valuation, events, financials, estimates,
 * insiders, institutional, news, filings, catalysts) with per-section meta. Reused by the AI agent and sharing.
 * Does not count against the FREE deep-dive limit (the page does).
 */
export const GET = withApi(
  async ({ params, user, query }) => {
    const ticker = sanitizeTicker(params.ticker);
    if (!ticker) throw badRequest('Invalid ticker');
    if (query.section === 'financials') requireFeature(user, 'financials');
    if (query.section === 'estimates') requireFeature(user, 'analystResearch');
    if (query.section === 'ownership') requireFeature(user, 'ownership');
    const agg = await loadAggregate(ticker, companyAccess(user));
    if (!agg.found) throw notFound(`No data found for ${ticker}`);
    return agg;
  },
  { audit: 'data.company.view', query: SECTION },
);
