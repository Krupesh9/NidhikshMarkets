import { Skeleton } from '@/components/ui/skeleton';
import { CardSkeleton, PortfolioSkeleton, PulseSkeleton } from '@/components/dashboard/skeletons';

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between"><div className="space-y-2"><Skeleton className="h-6 w-56" /><Skeleton className="h-4 w-80" /></div><Skeleton className="h-8 w-72" /></div>
      <PulseSkeleton />
      <PortfolioSkeleton />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 md:grid-cols-2 lg:col-span-2"><CardSkeleton rows={8} /><CardSkeleton rows={8} /></div>
        <CardSkeleton rows={5} />
      </div>
    </div>
  );
}
