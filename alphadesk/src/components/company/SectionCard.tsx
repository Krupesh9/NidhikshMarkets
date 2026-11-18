import * as React from 'react';
import { FlaskConical } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Deep-dive section shell: title row with provider label + mock badge, then body. Server- or client-safe. */
export function SectionCard({ id, title, description, isMock, providers, actions, children, className }: {
  id?: string; title: string; description?: React.ReactNode; isMock?: boolean; providers?: string[]; actions?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <Card id={id} className={cn('scroll-mt-4 overflow-hidden', className)} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {providers && providers.length > 0 && <span className="text-[11px] text-muted">via {providers.join(' + ')}</span>}
          {isMock && (
            <span className="inline-flex items-center gap-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn" title="Some figures in this section are simulated demo data">
              <FlaskConical className="h-3 w-3" aria-hidden /> Demo data
            </span>
          )}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

export function SectionSkeleton({ title, height = 'h-64', rows = 0 }: { title: string; height?: string; rows?: number }) {
  return (
    <Card className="overflow-hidden" role="status" aria-label={`Loading ${title}`}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold text-muted">{title}</span>
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="space-y-2 p-4">
        <Skeleton className={height} />
        {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-7" />)}
      </div>
      <span className="sr-only">Loading {title}…</span>
    </Card>
  );
}
