import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSessionUser } from '@/lib/auth';
import { screenRepo } from '@/lib/repos';
import { PageHeader } from '@/components/shell/PageHeader';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { MarketPulse, PortfolioSummaries, RecentShared, ResearchDisclaimer, TopNews, UpcomingCatalysts, WatchlistMovers } from '@/components/dashboard/sections';
import { CardSkeleton, PortfolioSkeleton, PulseSkeleton } from '@/components/dashboard/skeletons';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default async function Page() {
  const user = await requireSessionUser();
  const scope = { orgId: user.orgId, userId: user.id };
  const wl = await screenRepo.getWatchlist(scope);
  const symbols = wl?.symbols ?? [];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="space-y-4">
      <PageHeader title={`${greeting()}, ${user.name.split(' ')[0]}`} description={`${today} · market pulse, your book and what the team is researching.`} actions={<QuickActions />} />
      <Suspense fallback={<PulseSkeleton />}><MarketPulse /></Suspense>
      <Suspense fallback={<PortfolioSkeleton />}><PortfolioSummaries scope={scope} /></Suspense>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <Suspense fallback={<CardSkeleton rows={8} />}><WatchlistMovers symbols={symbols} /></Suspense>
            <Suspense fallback={<CardSkeleton rows={8} />}><UpcomingCatalysts symbols={symbols} /></Suspense>
          </div>
          <Suspense fallback={<CardSkeleton rows={8} />}><TopNews symbols={symbols} /></Suspense>
        </div>
        <div className="space-y-4">
          <Suspense fallback={<CardSkeleton rows={5} />}><RecentShared scope={scope} /></Suspense>
        </div>
      </div>
      <ResearchDisclaimer />
    </div>
  );
}
