import { z } from 'zod';
import { withApi, badRequest, forbidden, notFound } from '@/lib/http';
import { shareRepo } from '@/lib/repos';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { cleanComment, MAX_COMMENT_LEN } from '@/components/sharing/snapshot';

export const dynamic = 'force-dynamic';

async function visibleShare(shareId: string, orgId: string | null) {
  const s = await db.share.findUnique({ where: { id: shareId } });
  if (!s) return null;
  if (s.expiresAt && s.expiresAt < new Date()) return null;
  if (s.visibility !== 'link' && s.orgId !== orgId) return null;
  return s;
}

/** GET /api/comments?shareId= → { comments: [{id, body, authorId, authorName, createdAt}] } (link shares readable signed out) */
export const GET = withApi(
  async ({ user, query }) => {
    const s = await visibleShare(query.shareId, user?.orgId ?? null);
    if (!s) throw notFound('Share not found');
    const rows = await db.comment.findMany({ where: { shareId: s.id }, orderBy: { createdAt: 'asc' } });
    const us = await db.user.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.authorId))) } }, select: { id: true, name: true, email: true } });
    const n = Object.fromEntries(us.map((u) => [u.id, u.name ?? u.email]));
    return { comments: rows.map((c) => ({ id: c.id, shareId: c.shareId, authorId: c.authorId, authorName: n[c.authorId] ?? 'Unknown', body: c.body, createdAt: c.createdAt })) };
  },
  { auth: false, query: z.object({ shareId: z.string().min(1).max(100) }) },
);

/** POST /api/comments { shareId, body } — signed-in members of the share's org. Body is sanitised (HTML, control chars, js: links stripped). */
export const POST = withApi(
  async ({ user, body, correlationId }) => {
    const clean = cleanComment(body.body);
    if (!clean) throw badRequest('Comment is empty');
    const s = await visibleShare(body.shareId, user.orgId);
    if (!s) throw notFound('Share not found');
    if (s.orgId !== user.orgId) throw forbidden('Only members of the sharing organisation can comment');
    const c = await shareRepo.addComment({ orgId: user.orgId, userId: user.id }, s.id, clean);
    if (!c) throw notFound('Share not found');
    await db.feedItem.create({ data: { orgId: user.orgId, userId: user.id, kind: 'comment', title: `${user.name} commented on "${s.title}"`, href: `/shared/${s.token}`, meta: JSON.stringify({ shareId: s.id }) } }).catch(() => null);
    audit({ orgId: user.orgId, userId: user.id, action: 'share.comment', target: s.token, correlationId });
    return { comment: { ...c, authorName: user.name } };
  },
  { body: z.object({ shareId: z.string().min(1).max(100), body: z.string().min(1).max(MAX_COMMENT_LEN * 2) }), rateLimit: 'mutation' },
);
