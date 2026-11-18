import * as React from 'react';
import { cn } from '@/lib/utils';
import { Delta } from './delta';

/** KPI tile: label / value / optional delta + hint. */
export function Stat({ label, value, delta, deltaSuffix = '%', hint, className, children }: { label: React.ReactNode; value: React.ReactNode; delta?: number | null; deltaSuffix?: string; hint?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn('rounded-lg border border-border bg-panel p-3', className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-lg font-semibold tabular-nums">{value}</span>
        {delta !== undefined && <Delta value={delta} suffix={deltaSuffix} className="text-xs" />}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
      {children}
    </div>
  );
}
