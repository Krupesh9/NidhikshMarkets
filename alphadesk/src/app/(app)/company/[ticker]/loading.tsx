import { Skeleton } from '@/components/ui/skeleton';
import { SectionSkeleton } from '@/components/company/SectionCard';

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-4" role="status" aria-label="Loading company">
      <div className="rounded-lg border border-border bg-panel p-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12" />
          <div className="flex-1 space-y-2"><Skeleton className="h-5 w-64" /><Skeleton className="h-3 w-80" /></div>
          <Skeleton className="h-8 w-72" />
        </div>
        <div className="mt-4 flex flex-wrap gap-6"><Skeleton className="h-10 w-40" /><Skeleton className="h-10 w-80" /><Skeleton className="h-10 w-60" /></div>
      </div>
      <SectionSkeleton title="Price & events" height="h-[380px]" />
      <SectionSkeleton title="Financial statements" height="h-10" rows={6} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
