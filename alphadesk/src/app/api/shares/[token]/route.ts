import { withApi, forbidden, notFound } from '@/lib/http';
import { shareRepo } from '@/lib/repos';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shares/:token → full share (snapshot + comments). Org shares need a signed-in member of the org;
 * link shares are readable signed out. Response includes `canComment` / `canDelete` for the viewer.
 */
export const GET = withApi(
  async ({ user, params }) => {
    const share = await shareRepo.getByToken(params.token, user ? { orgId: user.orgId } : null);
    if (!share) throw notFound('This share does not exist, has expired, or is only visible to its organisation.');
    const sameOrg = !!user && user.orgId === share.orgId;
    if (user) audit({ orgId: user.orgId, userId: user.id, action: 'share.view', target: share.token });
    return {
      share: { ...share, orgId: undefined },
      viewer: { signedIn: !!user, canComment: sameOrg, canDelete: sameOrg && (user!.id === share.createdById || user!.role === 'ADMIN') },
    };
  },
  { auth: false },
);

/** DELETE /api/shares/:token — author or org ADMIN only. */
export const DELETE = withApi(
  async ({ user, params, correlationId }) => {
    const s = await db.share.findFirst({ where: { token: params.token, orgId: user.orgId } });
    if (!s) throw notFound('Share not found');
    if (s.createdById !== user.id && user.role !== 'ADMIN') throw forbidden('Only the author or an admin can revoke this share');
    await shareRepo.remove({ orgId: user.orgId, userId: user.id }, s.id);
    await db.feedItem.deleteMany({ where: { orgId: user.orgId, href: `/shared/${s.token}` } }).catch(() => null);
    audit({ orgId: user.orgId, userId: user.id, action: 'share.delete', target: `${s.itemType}:${s.itemId}`, correlationId, meta: { token: s.token } });
    return { ok: true };
  },
  { rateLimit: 'mutation' },
);
