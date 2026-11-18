import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6" role="status" aria-label="Loading market">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-3 w-96 max-w-full" />
      </div>
      <div className="rounded-xl border border-border bg-panel p-5">
        <div className="flex justify-between"><Skeleton className="h-5 w-32" /><Skeleton className="h-7 w-48" /></div>
        <Skeleton className="mt-4 h-[340px] w-full sm:h-[400px]" />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-[460px] rounded-xl xl:col-span-2" />
        <Skeleton className="h-[460px] rounded-xl" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
