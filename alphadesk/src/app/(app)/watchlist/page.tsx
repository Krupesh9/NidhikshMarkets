import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Star } from 'lucide-react';
import { requireSessionUser } from '@/lib/auth';
import { screenRepo } from '@/lib/repos';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'Watchlist' };
export const dynamic = 'force-dynamic';

export default async function WatchlistIndex() {
  const user = await requireSessionUser();
  const wl = await screenRepo.getWatchlist({ orgId: user.orgId, userId: user.id });
  const first = wl?.symbols?.[0];
  if (first) redirect(`/watchlist/${first}`);
  return (
    <EmptyState icon={Star} title="Your watchlist is empty" description="Add a ticker in the box on the left, or use “Add to watchlist” on any company page." className="py-16" />
  );
}
