import { z } from 'zod';
import { withApi, badRequest, notFound, upgradeRequired } from '@/lib/http';
import { shareRepo, type ShareItemType as ShareRepoItemType } from '@/lib/repos';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { sanitizeText } from '@/lib/sanitize';
import { redactSnapshot } from '@/components/sharing/redact';
import { createShareSchema, normalizeSnapshot, shareGate, snapshotPreview, snapshotTooLarge, ITEM_LABEL, SHARE_ITEM_TYPES } from '@/components/sharing/snapshot';
import { buildBaseSnapshot } from '@/components/sharing/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shares?type=note&author=<userId>&take=50 → { items: ShareCard[] } (org feed; previews only, no full snapshots)
 * POST /api/shares { itemType, itemId, snapshot, visibility, title? } → { token, url, share }
 */
export const GET = withApi(
  async ({ user, query }) => {
    const all = await shareRepo.list({ orgId: user.orgId, userId: user.id }, Math.min(Number(query.take ?? 100) || 100, 200));
    const items = all
      .filter((s) => (!query.type || s.itemType === query.type) && (!query.author || s.createdById === query.author))
      .map((s) => ({
        id: s.id, token: s.token, itemType: s.itemType, itemId: s.itemId, title: s.title, visibility: s.visibility, createdAt: s.createdAt,
        createdById: s.createdById, createdByName: s.createdByName ?? 'Unknown', commentCount: (s as typeof s & { commentCount?: number }).commentCount ?? 0,
        url: `/shared/${s.token}`, preview: snapshotPreview(s.itemType, redactSnapshot(s.itemType, s.snapshot, user)), isMock: s.snapshot.isMock === true, capturedAt: typeof s.snapshot.capturedAt === 'string' ? s.snapshot.capturedAt : null,
      }));
    return { items };
  },
  { query: z.object({ type: z.enum(SHARE_ITEM_TYPES).optional(), author: z.string().max(100).optional(), take: z.string().optional() }) },
);

export const POST = withApi(
  async ({ user, body, req, correlationId }) => {
    const gate = shareGate(user, body.itemType);
    if (!gate.allowed) throw upgradeRequired(gate.reason ?? 'Sharing requires an upgrade', gate.upgradeTo);
    const scope = { orgId: user.orgId, userId: user.id };
    if (body.itemType === 'company') body.itemId = body.itemId.trim().toUpperCase();
    const base = await buildBaseSnapshot(scope, body.itemType, body.itemId);
    if (!base) throw notFound(body.itemType === 'company' ? `Unknown ticker "${body.itemId.slice(0, 12)}"` : `${ITEM_LABEL[body.itemType]} not found in your organisation`);
    const snapshot = normalizeSnapshot(body.itemType, body.snapshot ?? {}, base.snapshot);
    if (snapshotTooLarge(snapshot)) throw badRequest('Snapshot is too large to share (limit 500 KB). Narrow the result set and try again.');
    const fallback = (snapshot as { name?: string; title?: string; question?: string }).name || (snapshot as { title?: string }).title || (snapshot as { question?: string }).question || ITEM_LABEL[body.itemType];
    const title = sanitizeText(body.title || base.title || fallback, 200) || ITEM_LABEL[body.itemType];
    const share = await shareRepo.create(scope, {
      itemType: body.itemType as ShareRepoItemType, itemId: body.itemId, title, snapshot: snapshot as unknown as Record<string, unknown>, visibility: body.visibility,
      expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
    });
    await db.feedItem.create({ data: { orgId: user.orgId, userId: user.id, kind: 'share', title: `${user.name} shared ${ITEM_LABEL[body.itemType].toLowerCase()} "${title}"`, href: `/shared/${share.token}`, meta: JSON.stringify({ shareId: share.id, itemType: body.itemType }) } }).catch(() => null);
    audit({ orgId: user.orgId, userId: user.id, action: 'share.create', target: `${body.itemType}:${body.itemId}`, correlationId, meta: { token: share.token, visibility: body.visibility } });
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const origin = host ? `${req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')}://${host}` : req.nextUrl.origin;
    return { token: share.token, url: `${origin}/shared/${share.token}`, path: `/shared/${share.token}`, share: { id: share.id, title: share.title, visibility: share.visibility, itemType: share.itemType, createdAt: share.createdAt } };
  },
  { body: createShareSchema, rateLimit: 'mutation' },
);
