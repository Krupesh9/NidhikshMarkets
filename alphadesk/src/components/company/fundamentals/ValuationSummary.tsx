'use client';
import * as React from 'react';
import type { SourceRef } from '@/lib/data/types';
import { Delta } from '@/components/ui/delta';
import { MetricButton } from '@/components/company/MetricButton';
import { cn } from '@/lib/utils';
import { fmtUsd } from './format';

export interface SummaryRow {
  key: string;
  label: string;
  sub: string;
  value: number | null;
  /** shown instead of a bar when value is null */
  nmText?: string;
  source: SourceRef;
  tone: 'info' | 'accent' | 'muted';
}

const BAR: Record<SummaryRow['tone'], string> = { info: 'bg-info/80', accent: 'bg-accent/80', muted: 'bg-muted/50' };

/**
 * Bullet-style comparison: each estimate is a horizontal bar on a shared $ scale; the dashed vertical line is the
 * current price. Badge = $ difference vs price, coloured text = % upside/downside.
 */
export function ValuationSummary({ price, priceSource, rows }: { price: number | null; priceSource: SourceRef; rows: SummaryRow[] }) {
  const vals = rows.map((r) => r.value).filter((v): v is number => v != null && v > 0);
  const max = Math.max(price ?? 0, ...vals) * 1.08 || 1;
  const pos = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const [hover, setHover] = React.useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="eyebrow">Valuation summary</h3>
        <div className="flex items-baseline gap-2 text-xs text-muted">
          Current price
          <MetricButton source={priceSource} label="Current price" className="font-mono text-base font-semibold tabular-nums text-text">{fmtUsd(price)}</MetricButton>
        </div>
      </div>

      <div className="relative pt-4">
        <ul className="space-y-2.5" aria-label="Estimated value per share versus current price">
          {rows.map((r, i) => {
            const diff = r.value != null && price != null ? r.value - price : null;
            const up = r.value != null && price ? ((r.value - price) / price) * 100 : null;
            return (
              <li key={r.key} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[11rem_minmax(0,1fr)_auto]"
                onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{r.label}</div>
                  <div className="truncate text-[11px] text-muted">{r.sub}</div>
                </div>
                <div className="relative h-7">
                  {price != null && price > 0 && r.value != null && r.value > 0 && (
                    <div className="pointer-events-none absolute -bottom-[5px] -top-[5px] z-20 border-l-2 border-dashed border-text/70" style={{ left: pos(price) }} aria-hidden>
                      {i === rows.findIndex((x) => x.value != null && x.value > 0) && <span className="absolute -top-4 -translate-x-1/2 whitespace-nowrap rounded bg-panel-2 px-1 font-mono text-[10px] text-text">Price {fmtUsd(price)}</span>}
                    </div>
                  )}
                  {r.value != null && r.value > 0 ? (
                    <>
                      <div className={cn('absolute inset-y-1 left-0 rounded-r-[4px] transition-[width,opacity] duration-300', BAR[r.tone], hover && hover !== r.key && 'opacity-50')} style={{ width: pos(r.value) }} aria-hidden />
                      <MetricButton source={r.source} label={r.label} className="absolute inset-y-0 left-0 z-10 flex items-center pl-2 font-mono text-[13px] font-semibold tabular-nums text-white drop-shadow-sm"
                        heading={<span>{r.label}: <span className="font-mono">{fmtUsd(r.value)}</span></span>}>
                        {fmtUsd(r.value)}
                      </MetricButton>
                    </>
                  ) : (
                    <MetricButton source={r.source} label={r.label} className="flex h-full items-center text-xs text-muted">{r.nmText ?? 'Not meaningful'}</MetricButton>
                  )}
                </div>
                <div className="col-span-2 flex justify-end sm:col-span-1">
                  {diff != null && up != null ? <Delta value={up} badge amount={diff} amountSuffix="" dp={1} className="text-[12px]" /> : <span className="text-xs text-muted">—</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-[11px] text-muted">Bars share one $ scale; the dashed line is the current price. Badge = difference vs price; coloured % = implied upside / downside. Estimates are model outputs, not price targets.</p>
    </div>
  );
}
