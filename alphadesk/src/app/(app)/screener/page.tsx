import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ScreenerClient } from '@/components/screener/ScreenerClient';

export const metadata: Metadata = { title: 'Screener' };
// Rendered per request so AutoRefresh (router.refresh) hands the client a new refreshKey and the screen re-runs.
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ScreenerClient refreshKey={Date.now()} />
    </Suspense>
  );
}
