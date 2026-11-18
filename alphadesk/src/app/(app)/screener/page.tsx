import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ScreenerClient } from '@/components/screener/ScreenerClient';

export const metadata: Metadata = { title: 'Screener' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ScreenerClient />
    </Suspense>
  );
}
