import { z } from 'zod';
import { withApi } from '@/lib/http';
import { portfolioRepo } from '@/lib/repos';
import { sanitizeText } from '@/lib/sanitize';
import { assertHoldings, holdingSchema } from './_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ user }) => {
  const items = await portfolioRepo.listBaskets({ orgId: user.orgId, userId: user.id });
  return { items };
}, { audit: 'basket.list' });

/** POST { name, description?, thesis?, holdings: [{ticker, targetWeight (fraction), rationale?, sector?}] } — weights must sum to 100%. */
export const POST = withApi(
  async ({ user, body }) => {
    assertHoldings(body.holdings);
    const b = await portfolioRepo.createBasket({ orgId: user.orgId, userId: user.id }, {
      name: sanitizeText(body.name, 120), description: body.description ? sanitizeText(body.description, 1000) : undefined, thesis: body.thesis ? sanitizeText(body.thesis, 4000) : undefined,
      holdings: body.holdings.map((h) => ({ ticker: h.ticker, targetWeight: h.targetWeight, rationale: h.rationale ? sanitizeText(h.rationale, 500) : undefined, sector: h.sector ?? undefined })),
    });
    return { basket: b };
  },
  { body: z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).nullable().optional(), thesis: z.string().max(4000).nullable().optional(), holdings: z.array(holdingSchema).min(1).max(200) }), rateLimit: 'mutation', audit: 'basket.create' },
);
