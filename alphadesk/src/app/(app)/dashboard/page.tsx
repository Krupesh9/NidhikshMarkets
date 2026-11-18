import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSessionUser } from '@/lib/auth';
import { screenRepo } from '@/lib/repos';
import { PageHeader } from '@/components/shell/PageHeader';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { MarketPulse, ResearchDisclaimer, TopNews, UpcomingCatalysts, WatchlistMovers } from '@/components/dashboard/sections';
import { CardSkeleton, PulseSkeleton } from '@/components/dashboard/skeletons';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default async function Page() {
  const user = await requireSessionUser();
  const wl = await screenRepo.getWatchlist({ orgId: user.orgId, userId: user.id });
  const symbols = wl?.symbols ?? [];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="space-y-6">
      <PageHeader title={`${greeting()}, ${user.name.split(' ')[0]}`} description={`${today} · market pulse, today's news, upcoming catalysts and your watchlist.`} actions={<QuickActions />} />
      <Suspense fallback={<PulseSkeleton />}><MarketPulse /></Suspense>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<CardSkeleton rows={12} />}><TopNews symbols={symbols} /></Suspense>
        </div>
        <div className="space-y-6">
          <Suspense fallback={<CardSkeleton rows={6} />}><UpcomingCatalysts symbols={symbols} /></Suspense>
          <Suspense fallback={<CardSkeleton rows={8} />}><WatchlistMovers symbols={symbols} /></Suspense>
        </div>
      </div>
      <ResearchDisclaimer />
    </div>
  );
}
