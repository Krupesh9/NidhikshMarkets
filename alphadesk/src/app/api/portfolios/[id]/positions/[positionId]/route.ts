import { withApi, notFound } from '@/lib/http';
import { portfolioRepo } from '@/lib/repos';
import { positionPatch } from '../../../_shared';

export const dynamic = 'force-dynamic';

async function load(user: { orgId: string; id: string }, id: string, positionId: string) {
  const scope = { orgId: user.orgId, userId: user.id };
  const p = await portfolioRepo.get(scope, id);
  const pos = p?.positions.find((x) => x.id === positionId);
  if (!p || !pos) throw notFound('Position not found');
  return { scope, p, pos };
}

/** PATCH { quantity?, costBasis?, targetWeight? } — inline edit. */
export const PATCH = withApi(
  async ({ user, params, body }) => {
    const { scope, p, pos } = await load(user, params.id, params.positionId);
    const updated = await portfolioRepo.upsertPosition(scope, p.id, {
      id: pos.id, ticker: pos.ticker, quantity: body.quantity ?? pos.quantity, costBasis: body.costBasis ?? pos.costBasis,
      targetWeight: body.targetWeight !== undefined ? body.targetWeight : pos.targetWeight, sector: pos.sector, country: pos.country,
    });
    return { position: updated };
  },
  { body: positionPatch, rateLimit: 'mutation', audit: 'portfolio.position.update' },
);

export const DELETE = withApi(async ({ user, params }) => {
  const { scope, pos } = await load(user, params.id, params.positionId);
  await portfolioRepo.removePosition(scope, pos.id);
  return { ok: true };
}, { rateLimit: 'mutation', audit: 'portfolio.position.delete' });
