import { cn } from '@/lib/utils';

export function Skeleton({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('relative overflow-hidden rounded-md bg-panel-2 before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/5 before:to-transparent', className)}
      {...p}
    />
  );
}

/** Generic page skeleton: header + KPI row + table. */
export function PageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="h-64" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-8" />)}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
