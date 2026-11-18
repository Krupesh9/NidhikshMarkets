import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getUsage } from '@/lib/usage';
import { screenRepo } from '@/lib/repos';
import { getDataMode } from '@/lib/data/mode';
import { AppShell } from '@/components/shell/AppShell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const scope = { orgId: user.orgId, userId: user.id };
  const [usage, watchlist, screens] = await Promise.all([getUsage(user), screenRepo.getWatchlist(scope), screenRepo.list(scope)]);
  return (
    <AppShell
      user={user}
      usage={{ period: usage.period, aiQueries: usage.aiQueries, deepDivesToday: usage.deepDivesToday }}
      dataMode={getDataMode()}
      watchlist={watchlist?.symbols ?? []}
      savedScreens={screens.map((s) => ({ id: s.id, name: s.name }))}
    >
      {children}
    </AppShell>
  );
}
