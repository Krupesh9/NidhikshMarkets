'use client';
import { AlertTriangle, Newspaper, TrendingUp } from 'lucide-react';
import { SourceChip } from '@/components/ui/source-chip';
import type { ScreenResultRow } from '@/lib/screener/types';

/** Expanded "Why now" block for a screener row: headline, estimate change, risk, with citation chips (open right rail). */
export function WhyNow({ row }: { row: ScreenResultRow }) {
  const src = row.whyNowSources ?? [];
  const items = [
    { icon: Newspaper, label: 'Signal', text: row.whyNow.headline, source: src.find((s) => s.kind === 'ownership') ?? src.find((s) => s.id.startsWith('cal:')) ?? src.find((s) => s.kind === 'price' || s.kind === 'news') ?? src[0] },
    { icon: TrendingUp, label: 'Fundamentals', text: row.whyNow.estimateChange, source: src.find((s) => s.kind === 'filing') ?? src.find((s) => s.kind === 'estimate') ?? src[1] },
    { icon: AlertTriangle, label: 'Risk', text: row.whyNow.risk, source: src.find((s) => s.kind === 'price') ?? src.find((s) => s.kind === 'filing') ?? src[0] },
  ];
  return (
    <div className="grid gap-2 py-1 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]" aria-label={`Why now for ${row.ticker}`}>
      {items.map(({ icon: Icon, label, text, source }) => (
        <div key={label} className="min-w-0 rounded-md border border-border bg-panel-2/50 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
            <Icon className="h-3 w-3" aria-hidden /> {label}
          </div>
          <p className="whitespace-normal text-xs leading-relaxed text-text">{text}</p>
          {source && <SourceChip source={source} className="mt-1.5" />}
        </div>
      ))}
      <p className="col-span-full text-[10px] text-muted">Research only — not investment advice.</p>
    </div>
  );
}
