'use client';
import * as React from 'react';
import { ExternalLink, FileText, Mic, Newspaper, LineChart, Users, Calculator, FlaskConical } from 'lucide-react';
import type { SourceRef } from '@/lib/data/types';
import { useRightRail } from '@/components/shell/RightRail';
import { cn } from '@/lib/utils';

const ICON = { filing: FileText, transcript: Mic, news: Newspaper, price: LineChart, estimate: Calculator, ownership: Users, mock: FlaskConical } as const;

/** Renders excerpt with an optional highlighted substring. */
function Highlighted({ text, highlight }: { text: string; highlight?: string }) {
  if (!highlight) return <mark className="rounded bg-info/20 px-0.5 text-text">{text}</mark>;
  const i = text.toLowerCase().indexOf(highlight.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-info/25 px-0.5 text-text">{text.slice(i, i + highlight.length)}</mark>
      {text.slice(i + highlight.length)}
    </>
  );
}

/** Right-rail detail view for a source. Exported so pages can render it directly. */
export function SourceDetail({ source, highlight }: { source: SourceRef; highlight?: string }) {
  const Icon = ICON[source.kind] ?? FileText;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <div>
          <div className="font-medium leading-snug">{source.name}</div>
          <div className="mt-0.5 text-xs capitalize text-muted">{source.kind}{source.locator ? ` · ${source.locator}` : ''}</div>
        </div>
      </div>
      {source.excerpt ? (
        <blockquote className="border-l-2 border-info pl-3 text-[13px] leading-relaxed text-text/90">
          <Highlighted text={source.excerpt} highlight={highlight} />
        </blockquote>
      ) : (
        <p className="text-xs text-muted">No excerpt captured for this source.</p>
      )}
      {source.kind === 'mock' || source.id.startsWith('mock:') ? (
        <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn">Simulated demo source — not a real document.</p>
      ) : null}
      {source.url && (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-info hover:underline">
          Open original <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      )}
    </div>
  );
}

/**
 * Clickable citation chip. Clicking opens the right rail with the excerpt highlighted.
 *   <SourceChip source={s} index={1} />  → renders "[1] 10-K"
 */
export function SourceChip({ source, index, highlight, className, label }: { source: SourceRef; index?: number; highlight?: string; className?: string; label?: string }) {
  const rail = useRightRail();
  const Icon = ICON[source.kind] ?? FileText;
  const text = label ?? (source.name.length > 28 ? source.name.slice(0, 27) + '…' : source.name);
  return (
    <button
      type="button"
      onClick={() => rail.open({ title: 'Source', content: <SourceDetail source={source} highlight={highlight} />, key: `source:${source.id}` })}
      className={cn('inline-flex max-w-full items-center gap-1 rounded border border-info/30 bg-info/10 px-1.5 py-0.5 align-baseline text-[11px] font-medium text-info hover:bg-info/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', className)}
      title={source.name}
      aria-label={`Open source${index != null ? ` ${index}` : ''}: ${source.name}`}
    >
      {index != null ? <span className="font-mono">[{index}]</span> : <Icon className="h-3 w-3" aria-hidden />}
      <span className="truncate">{text}</span>
    </button>
  );
}

export function SourceChips({ sources, className }: { sources: SourceRef[]; className?: string }) {
  if (!sources?.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {sources.map((s, i) => <SourceChip key={s.id + i} source={s} index={i + 1} />)}
    </div>
  );
}
