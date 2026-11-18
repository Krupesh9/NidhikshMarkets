import { requireSessionUser } from '@/lib/auth';
import { screenRepo } from '@/lib/repos';
import { WatchlistPane } from '@/components/watchlist/WatchlistPane';

export const dynamic = 'force-dynamic';

/** Two-pane watchlist: list of names on the left, the selected company's deep dive on the right. */
export default async function WatchlistLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSessionUser();
  const wl = await screenRepo.getWatchlist({ orgId: user.orgId, userId: user.id });
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <WatchlistPane symbols={wl?.symbols ?? []} />
      <div className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}
