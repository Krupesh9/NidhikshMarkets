import { z } from 'zod';
import { withApi } from '@/lib/http';
import { db } from '@/lib/db';
import { parseJson } from '@/lib/json';

export const dynamic = 'force-dynamic';

/** GET /api/feed?take=20 → { items: [{id, kind, title, body, href, userName, createdAt}] } — org activity (shares, comments, notes, alerts). */
export const GET = withApi(
  async ({ user, query }) => {
    const take = Math.min(Number(query.take ?? 20) || 20, 100);
    const rows = await db.feedItem.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: 'desc' }, take });
    const us = await db.user.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true, email: true } });
    const n = Object.fromEntries(us.map((u) => [u.id, u.name ?? u.email]));
    return { items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, userName: r.userId ? n[r.userId] ?? null : null, meta: parseJson(r.meta, {}), createdAt: r.createdAt })) };
  },
  { query: z.object({ take: z.string().optional() }) },
);
