import { z } from 'zod';
import { withApi } from '@/lib/http';
import { auditRepo } from '@/lib/repos';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET ?action=ai&userId=&take=100 → { items } — ADMIN only. Recent data access + AI queries (who / what / when). */
export const GET = withApi(
  async ({ user, query }) => {
    const items = await auditRepo.list(user.orgId, { action: query.action || undefined, userId: query.userId || undefined, take: Math.min(Number(query.take ?? 100) || 100, 500) });
    const us = await db.user.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true, email: true } });
    const n = Object.fromEntries(us.map((u) => [u.id, u.name ?? u.email]));
    return { items: items.map((i) => ({ id: i.id, action: i.action, target: i.target, userId: i.userId, userName: i.userId ? n[i.userId] ?? 'Unknown' : 'System', meta: i.meta, correlationId: i.correlationId, createdAt: i.createdAt })) };
  },
  { roles: ['ADMIN'], query: z.object({ action: z.string().max(60).optional(), userId: z.string().max(100).optional(), take: z.string().optional() }) },
);
