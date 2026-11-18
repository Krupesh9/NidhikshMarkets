import type { Metadata } from 'next';
import { requireSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { assertFeature } from '@/lib/plans';
import { PageHeader } from '@/components/shell/PageHeader';
import { UpgradeHint } from '@/components/shell/UpgradeHint';
import { SharedFeed } from '@/components/sharing/SharedFeed';
import { listShareCards } from '@/components/sharing/server';

export const metadata: Metadata = { title: 'Shared' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requireSessionUser();
  const scope = { orgId: user.orgId, userId: user.id };
  const [items, members] = await Promise.all([
    listShareCards(scope, 200),
    db.user.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
  ]);
  const gate = assertFeature(user, 'sharing');
  return (
    <div>
      <PageHeader title="Shared" description="Notes, screens, portfolios, baskets and AI threads shared across your team — frozen snapshots with sources and discussion." />
      {!gate.allowed && <UpgradeHint upgradeTo={gate.upgradeTo} className="mb-4" reason="You can read and comment on team shares. Sharing your own research is available on Pro." />}
      <SharedFeed items={items} members={members.map((m) => ({ id: m.id, name: m.name ?? m.email }))} meId={user.id} />
    </div>
  );
}
