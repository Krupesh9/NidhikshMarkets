'use client';
import * as React from 'react';
import type { SourceRef } from '@/lib/data/types';
import { useRightRail } from '@/components/shell/RightRail';
import { SourceDetail } from '@/components/ui/source-chip';
import { cn } from '@/lib/utils';

/** Opens a source in the right rail, with an optional heading + highlighted substring. */
export function useOpenSource() {
  const rail = useRightRail();
  return React.useCallback(
    (source: SourceRef, opts: { highlight?: string; heading?: React.ReactNode; title?: string } = {}) =>
      rail.open({
        title: opts.title ?? 'Source',
        key: `company:${source.id}:${opts.highlight ?? ''}`,
        content: (
          <div className="space-y-3">
            {opts.heading && <div className="rounded-md border border-border bg-panel-2 p-2.5 text-sm">{opts.heading}</div>}
            <SourceDetail source={source} highlight={opts.highlight} />
          </div>
        ),
      }),
    [rail],
  );
}

/**
 * Any metric on the deep dive: click → right rail shows the source name, link and excerpt (value highlighted).
 */
export function MetricButton({ source, highlight, heading, children, className, label }: {
  source: SourceRef; highlight?: string; heading?: React.ReactNode; children: React.ReactNode; className?: string; label?: string;
}) {
  const open = useOpenSource();
  return (
    <button
      type="button"
      onClick={() => open(source, { highlight, heading })}
      aria-label={label ? `${label} — show source` : undefined}
      title="Show source"
      className={cn('rounded-sm text-left decoration-info/50 decoration-dotted underline-offset-4 hover:text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', className)}
    >
      {children}
    </button>
  );
}
