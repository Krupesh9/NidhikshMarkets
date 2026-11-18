import { z } from 'zod';
import { withApi } from '@/lib/http';
import { portfolioRepo } from '@/lib/repos';
import { summarizePortfolios } from '@/lib/analytics/server';
import { mergeHoldings } from '@/lib/analytics/exposure';
import { BENCH, classify, clean, enforcePositions, positionBody } from './_shared';

export const dynamic = 'force-dynamic';

/** GET /api/portfolios[?summary=1] → { items, meta? }. With summary: value, day change, sparkline per portfolio. */
export const GET = withApi(
  async ({ user, query }) => {
    const scope = { orgId: user.orgId, userId: user.id };
    const list = await portfolioRepo.list(scope);
    if (query.summary === '1') {
      const s = await summarizePortfolios(list);
      return { items: s.items, meta: s.meta };
    }
    return { items: list.map((p) => ({ id: p.id, name: p.name, description: p.description, benchmark: p.benchmark, positionCount: p.positions.length, updatedAt: p.updatedAt })) };
  },
  { query: z.object({ summary: z.string().optional() }), audit: 'portfolio.list' },
);

/** POST /api/portfolios { name, description?, benchmark?, positions? } → portfolio */
export const POST = withApi(
  async ({ user, body }) => {
    const scope = { orgId: user.orgId, userId: user.id };
    const positions = mergeHoldings((body.positions ?? []).map((p) => ({ ...p, price: 0 })));
    enforcePositions(user, 0, positions.length);
    const withClass = await Promise.all(positions.map(async (p) => ({ ticker: p.ticker, quantity: p.quantity, costBasis: p.costBasis, targetWeight: p.targetWeight ?? null, ...(await classify(p.ticker)) })));
    const created = await portfolioRepo.create(scope, { name: clean(body.name, 120)!, description: clean(body.description ?? undefined, 1000) ?? undefined, benchmark: body.benchmark ?? 'SPY', positions: withClass });
    return { portfolio: created };
  },
  {
    body: z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).nullable().optional(), benchmark: BENCH.optional(), positions: z.array(positionBody).max(5000).optional() }),
    rateLimit: 'mutation', audit: 'portfolio.create',
  },
);
