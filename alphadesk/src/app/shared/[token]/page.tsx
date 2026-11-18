import type { Metadata } from 'next';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { shareRepo } from '@/lib/repos';
import { audit } from '@/lib/audit';
import { Logo } from '@/components/shell/Logo';
import { Button } from '@/components/ui/button';
import { SharedItemPage } from '@/components/sharing/SharedItemPage';
import { redactSnapshot } from '@/components/sharing/redact';

export const dynamic = 'force-dynamic';

/** Public/org share view. Lives outside (app) so link-visibility shares work signed out. */
export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const user = await getSessionUser();
  const s = await shareRepo.getByToken(params.token, user ? { orgId: user.orgId } : null);
  return { title: s ? s.title : 'Shared item', robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: { token: string } }) {
  const user = await getSessionUser();
  const share = await shareRepo.getByToken(params.token, user ? { orgId: user.orgId } : null);
  if (!share) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <Logo />
        <div className="rounded-full bg-panel-2 p-3 text-muted"><Lock className="h-5 w-5" aria-hidden /></div>
        <h1 className="text-lg font-semibold">This share isn&apos;t available</h1>
        <p className="text-sm text-muted">
          It may have been revoked or expired, or it&apos;s only visible to members of the author&apos;s organisation.
          {user ? '' : ' Signing in may give you access.'}
        </p>
        <Button asChild variant={user ? 'secondary' : 'default'}>
          {user ? <Link href="/shared">Back to team feed</Link> : <Link href={`/login?callbackUrl=${encodeURIComponent(`/shared/${params.token}`)}`}>Sign in</Link>}
        </Button>
      </div>
    );
  }
  const sameOrg = !!user && user.orgId === share.orgId;
  if (user) audit({ orgId: user.orgId, userId: user.id, action: 'share.view', target: share.token });
  return (
    <SharedItemPage
      share={{
        id: share.id, token: share.token, itemType: share.itemType, itemId: share.itemId, title: share.title, snapshot: redactSnapshot(share.itemType, share.snapshot, user),
        createdByName: share.createdByName, visibility: share.visibility, createdAt: share.createdAt.toISOString(), expiresAt: share.expiresAt?.toISOString() ?? null,
      }}
      comments={(share.comments ?? []).map((c) => ({ id: c.id, authorId: c.authorId, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString() }))}
      viewer={{ signedIn: !!user, canComment: sameOrg, canDelete: sameOrg && (user!.id === share.createdById || user!.role === 'ADMIN'), name: user?.name }}
    />
  );
}
