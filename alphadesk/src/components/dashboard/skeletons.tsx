import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function PulseSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading market pulse">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-lg" />)}
    </div>
  );
}

export function CardSkeleton({ rows = 5, title = true }: { rows?: number; title?: boolean }) {
  return (
    <Card aria-busy="true">
      {title && <CardHeader className="pb-2"><Skeleton className="h-4 w-36" /></CardHeader>}
      <CardContent className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
      </CardContent>
    </Card>
  );
}

