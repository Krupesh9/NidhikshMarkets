'use client';
import * as React from 'react';
import { Quote } from 'lucide-react';
import { SourceDetail } from '@/components/ui/source-chip';
import { pickHighlight } from '@/lib/ai/citations';
import type { Citation } from '@/lib/ai/types';
import { cn } from '@/lib/utils';

export interface CitationApi {
  citations: Citation[];
  /** open the source for citation n; `sentence` = the claim it supports */
  open: (n: number, sentence: string, list?: Citation[]) => void;
  active?: number | null;
}

export const CitationCtx = React.createContext<CitationApi>({ citations: [], open: () => {} });

/** Superscript, clickable [n] marker. */
export function CiteChip({ n, sentence }: { n: number; sentence: string }) {
  const { citations, open, active } = React.useContext(CitationCtx);
  const c = citations.find((x) => x.n === n);
  if (!c) return null;
  return (
    <sup className="mx-[1px]">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          open(n, sentence);
        }}
        title={c.name}
        aria-label={`Source ${n}: ${c.name}`}
        className={cn(
          'inline-flex h-[15px] min-w-[15px] items-center justify-center rounded border px-[3px] font-mono text-[10px] font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info',
          active === n ? 'border-info bg-info text-white' : 'border-info/40 bg-info/10 text-info hover:bg-info/25',
        )}
      >
        {n}
      </button>
    </sup>
  );
}

/** Right-rail content: the claim, then the exact source excerpt with the cited figure highlighted. */
export function CitationDetail({ citation, sentence }: { citation: Citation; sentence: string }) {
  const highlight = pickHighlight(sentence, citation.excerpt);
  return (
    <div className="space-y-4">
      {sentence && (
        <div className="rounded-md border border-border bg-panel-2/60 p-2.5 text-xs">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            <Quote className="h-3 w-3" aria-hidden /> Cited for
          </div>
          <p className="leading-relaxed text-text/90">{sentence}</p>
        </div>
      )}
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Source [{citation.n}]</div>
      <SourceDetail source={citation} highlight={highlight} />
    </div>
  );
}
