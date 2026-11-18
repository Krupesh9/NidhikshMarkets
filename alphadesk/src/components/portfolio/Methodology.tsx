import { SourceChips } from '@/components/ui/source-chip';
import type { SourceRef } from '@/lib/data/types';

/** Methodology & assumptions panel content (used inline as footnotes and in the right rail). */
export function Methodology({ assumptions, sources, extra }: { assumptions: string[]; sources?: SourceRef[]; extra?: React.ReactNode }) {
  return (
    <div className="space-y-3 text-xs text-muted">
      <ol className="list-decimal space-y-1.5 pl-4">
        {assumptions.map((a, i) => <li key={i}>{a}</li>)}
      </ol>
      {extra}
      {sources && sources.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide">Price sources</div>
          <SourceChips sources={sources} />
        </div>
      )}
      <p className="font-medium text-text">Research only — not investment advice. Analytics are estimates based on historical data and stated assumptions.</p>
    </div>
  );
}
