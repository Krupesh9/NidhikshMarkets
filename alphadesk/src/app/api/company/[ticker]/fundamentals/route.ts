import { z } from 'zod';
import { badRequest, requireFeature, withApi } from '@/lib/http';
import { sanitizeTicker } from '@/lib/sanitize';
import { loadFundamentals } from '@/lib/fundamentals/load';
import { getValuationDefaults } from '@/lib/fundamentals/settings.server';

export const dynamic = 'force-dynamic';

const pctParam = (min: number, max: number) => z.coerce.number().min(min).max(max).optional();

/**
 * GET /api/company/:ticker/fundamentals[?growth=&discount=&terminal=] → FundamentalsModel
 * (Graham intrinsic value, 3-year DCF, PEG, P/B, D/E with sources). Optional DCF overrides are percents,
 * e.g. ?growth=8&discount=9.5&terminal=2.5; the response's `dcf.defaults` holds the model defaults and `dcf.inputs`
 * lets a client recompute with `dcf()` from '@/lib/fundamentals/formulas'.
 */
export const GET = withApi(
  async ({ params, query, user }) => {
    // GATE: fundamental values ride on the 'financials' Pro feature (statement-derived). Change the feature name here
    // if a dedicated one (e.g. 'fundamentals') is added to src/lib/plans.ts. requireFeature throws 403 upgrade_required.
    requireFeature(user, 'financials');
    const ticker = sanitizeTicker(params.ticker);
    if (!ticker) throw badRequest('Invalid ticker');
    // The org owner's valuation defaults (Settings → Valuation defaults) set the model defaults for everyone.
    const defaults = await getValuationDefaults(user.orgId);
    return loadFundamentals(ticker, { growth: query.growth, discount: query.discount, terminal: query.terminal }, defaults);
  },
  {
    query: z.object({ growth: pctParam(-50, 100), discount: pctParam(0, 50), terminal: pctParam(-5, 10) }),
    audit: 'data.company.fundamentals',
  },
);
