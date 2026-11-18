import 'server-only';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { parseJson, toJson } from '@/lib/json';
import type { CommentDTO, Scope, ShareDTO, ShareItemType } from './types';

const map = (r: NonNullable<Awaited<ReturnType<typeof db.share.findFirst>>>): ShareDTO => ({
  id: r.id, orgId: r.orgId, token: r.token, itemType: r.itemType as ShareItemType, itemId: r.itemId, title: r.title, snapshot: parseJson(r.snapshot, {}),
  createdById: r.createdById, visibility: (r.visibility as 'org' | 'link') ?? 'org', expiresAt: r.expiresAt, createdAt: r.createdAt,
});

async function names(ids: string[]) {
  const us = await db.user.findMany({ where: { id: { in: Array.from(new Set(ids)) } }, select: { id: true, name: true, email: true } });
  return Object.fromEntries(us.map((u) => [u.id, u.name ?? u.email]));
}

export const shareRepo = {
  newToken: () => randomBytes(18).toString('base64url'),
  list: async (s: Scope, take = 100): Promise<ShareDTO[]> => {
    const rows = await db.share.findMany({ where: { orgId: s.orgId }, orderBy: { createdAt: 'desc' }, take, include: { _count: { select: { comments: true } } } });
    const n = await names(rows.map((r) => r.createdById));
    return rows.map((r) => ({ ...map(r), createdByName: n[r.createdById], commentCount: r._count.comments } as ShareDTO & { commentCount: number }));
  },
  create: async (s: Scope, d: { itemType: ShareItemType; itemId: string; title: string; snapshot: Record<string, unknown>; visibility?: 'org' | 'link'; expiresAt?: Date | null }) =>
    map(await db.share.create({ data: { orgId: s.orgId, token: shareRepo.newToken(), itemType: d.itemType, itemId: d.itemId, title: d.title, snapshot: toJson(d.snapshot), createdById: s.userId, visibility: d.visibility ?? 'org', expiresAt: d.expiresAt ?? null } })),
  /**
   * Resolve a share by token. If `scope` is given, org shares from that org are returned; link shares are always returned.
   * Returns null when not visible or expired.
   */
  getByToken: async (token: string, scope?: Pick<Scope, 'orgId'> | null): Promise<ShareDTO | null> => {
    const r = await db.share.findUnique({ where: { token }, include: { comments: { orderBy: { createdAt: 'asc' } } } });
    if (!r) return null;
    if (r.expiresAt && r.expiresAt < new Date()) return null;
    if (r.visibility !== 'link' && r.orgId !== scope?.orgId) return null;
    const n = await names([r.createdById, ...r.comments.map((c) => c.authorId)]);
    return { ...map(r), createdByName: n[r.createdById], comments: r.comments.map((c) => ({ id: c.id, shareId: c.shareId, authorId: c.authorId, authorName: n[c.authorId], body: c.body, createdAt: c.createdAt })) };
  },
  addComment: async (s: Scope, shareId: string, body: string): Promise<CommentDTO | null> => {
    const sh = await db.share.findFirst({ where: { id: shareId, orgId: s.orgId } });
    if (!sh) return null;
    const c = await db.comment.create({ data: { orgId: s.orgId, shareId, authorId: s.userId, body } });
    return { id: c.id, shareId, authorId: c.authorId, body: c.body, createdAt: c.createdAt };
  },
  remove: async (s: Scope, id: string) => (await db.share.deleteMany({ where: { id, orgId: s.orgId } })).count > 0,
};
