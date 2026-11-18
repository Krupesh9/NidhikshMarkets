import { z } from 'zod';
import { withApi, notFound } from '@/lib/http';
import { portfolioRepo } from '@/lib/repos';
import { sanitizeText } from '@/lib/sanitize';
import { assertHoldings, holdingSchema } from '../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ user, params }) => {
  const b = await portfolioRepo.getBasket({ orgId: user.orgId, userId: user.id }, params.id);
  if (!b) throw notFound('Basket not found');
  return { basket: b };
}, { audit: 'basket.read' });

/** PATCH { name?, description?, thesis?, holdings? } — holdings replace the full set (weights must sum to 100%). */
export const PATCH = withApi(
  async ({ user, params, body }) => {
    const scope = { orgId: user.orgId, userId: user.id };
    const b = await portfolioRepo.getBasket(scope, params.id);
    if (!b) throw notFound('Basket not found');
    if (body.holdings) assertHoldings(body.holdings);
    const meta = {
      ...(body.name != null ? { name: sanitizeText(body.name, 120) } : {}),
      ...(body.description !== undefined ? { description: body.description == null ? null : sanitizeText(body.description, 1000) } : {}),
      ...(body.thesis !== undefined ? { thesis: body.thesis == null ? null : sanitizeText(body.thesis, 4000) } : {}),
    };
    if (Object.keys(meta).length || body.holdings) await portfolioRepo.updateBasket(scope, b.id, meta); // bumps updatedAt
    if (body.holdings) {
      await portfolioRepo.replaceBasketHoldings(scope, b.id, body.holdings.map((h) => ({ ticker: h.ticker, targetWeight: h.targetWeight, rationale: h.rationale ? sanitizeText(h.rationale, 500) : undefined, sector: h.sector ?? undefined })));
    }
    return { basket: await portfolioRepo.getBasket(scope, b.id) };
  },
  { body: z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(1000).nullable().optional(), thesis: z.string().max(4000).nullable().optional(), holdings: z.array(holdingSchema).min(1).max(200).optional() }), rateLimit: 'mutation', audit: 'basket.update' },
);

export const DELETE = withApi(async ({ user, params }) => {
  const ok = await portfolioRepo.removeBasket({ orgId: user.orgId, userId: user.id }, params.id);
  if (!ok) throw notFound('Basket not found');
  return { ok: true };
}, { rateLimit: 'mutation', audit: 'basket.delete' });
