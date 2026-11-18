import { withApi, notFound } from '@/lib/http';
import { portfolioRepo } from '@/lib/repos';
import { classify, enforcePositions, positionBody } from '../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ user, params }) => {
  const p = await portfolioRepo.get({ orgId: user.orgId, userId: user.id }, params.id);
  if (!p) throw notFound('Portfolio not found');
  return { items: p.positions };
});

/** POST { ticker, quantity, costBasis, targetWeight? } — adds a position, or merges into an existing one for the same ticker. */
export const POST = withApi(
  async ({ user, params, body }) => {
    const scope = { orgId: user.orgId, userId: user.id };
    const p = await portfolioRepo.get(scope, params.id);
    if (!p) throw notFound('Portfolio not found');
    const existing = p.positions.find((x) => x.ticker === body.ticker);
    if (existing) {
      const q = existing.quantity + body.quantity;
      const aq = Math.abs(existing.quantity) + Math.abs(body.quantity);
      const cost = aq ? (existing.costBasis * Math.abs(existing.quantity) + body.costBasis * Math.abs(body.quantity)) / aq : body.costBasis;
      if (q === 0) { await portfolioRepo.removePosition(scope, existing.id); return { position: null, merged: true, closed: true }; }
      const pos = await portfolioRepo.upsertPosition(scope, p.id, { id: existing.id, ticker: existing.ticker, quantity: q, costBasis: cost, targetWeight: body.targetWeight ?? existing.targetWeight, sector: existing.sector, country: existing.country });
      return { position: pos, merged: true };
    }
    const gate = enforcePositions(user, p.positions.length, 1);
    const pos = await portfolioRepo.upsertPosition(scope, p.id, { ticker: body.ticker, quantity: body.quantity, costBasis: body.costBasis, targetWeight: body.targetWeight ?? null, ...(await classify(body.ticker)) });
    return { position: pos, gate };
  },
  { body: positionBody, rateLimit: 'mutation', audit: 'portfolio.position.add' },
);
