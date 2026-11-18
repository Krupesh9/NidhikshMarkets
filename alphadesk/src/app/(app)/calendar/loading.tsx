import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading calendar">
      <div className="mb-6 space-y-2"><Skeleton className="h-7 w-40" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-20 rounded-full" />)}</div>
          {Array.from({ length: 2 }).map((_, g) => (
            <div key={g} className="space-y-3">
              <Skeleton className="h-3 w-24" />
              <div className="divide-y divide-border rounded-xl border border-border bg-panel">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-5 p-5">
                    <Skeleton className="h-16 w-14 rounded-lg" />
                    <div className="flex-1 space-y-2 pt-1"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="hidden space-y-6 lg:block"><Skeleton className="h-80 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
