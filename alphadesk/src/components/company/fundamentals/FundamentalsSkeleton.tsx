import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Loading state for <FundamentalsSection/> (mirrors its layout). */
export function FundamentalsSkeleton() {
  return (
    <Card className="overflow-hidden" role="status" aria-label="Loading Fundamental values">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <span className="text-sm font-semibold text-muted">Fundamental values</span>
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="space-y-6 p-5">
        <div className="space-y-2.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-7" style={{ width: `${85 - i * 15}%` }} />)}</div>
        <Skeleton className="h-72 rounded-xl" />
        <div className="grid gap-6 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>
      </div>
      <span className="sr-only">Loading Fundamental values…</span>
    </Card>
  );
}
