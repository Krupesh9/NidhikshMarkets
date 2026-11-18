import { z } from 'zod';
import { withApi, notFound } from '@/lib/http';
import { portfolioRepo } from '@/lib/repos';
import { BENCH, clean } from '../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ user, params }) => {
  const p = await portfolioRepo.get({ orgId: user.orgId, userId: user.id }, params.id);
  if (!p) throw notFound('Portfolio not found');
  return { portfolio: p };
}, { audit: 'portfolio.read' });

export const PATCH = withApi(
  async ({ user, params, body }) => {
    const ok = await portfolioRepo.update({ orgId: user.orgId, userId: user.id }, params.id, {
      ...(body.name != null ? { name: clean(body.name, 120)! } : {}),
      ...(body.description !== undefined ? { description: clean(body.description, 1000) ?? null } : {}),
      ...(body.benchmark ? { benchmark: body.benchmark } : {}),
    });
    if (!ok) throw notFound('Portfolio not found');
    return { portfolio: await portfolioRepo.get({ orgId: user.orgId, userId: user.id }, params.id) };
  },
  { body: z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(1000).nullable().optional(), benchmark: BENCH.optional() }), rateLimit: 'mutation', audit: 'portfolio.update' },
);

export const DELETE = withApi(async ({ user, params }) => {
  const ok = await portfolioRepo.remove({ orgId: user.orgId, userId: user.id }, params.id);
  if (!ok) throw notFound('Portfolio not found');
  return { ok: true };
}, { rateLimit: 'mutation', audit: 'portfolio.delete' });
