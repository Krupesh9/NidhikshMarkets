'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  flexRender, getCoreRowModel, useReactTable, type ColumnDef as TColumnDef, type SortingState, type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsUpDown, Info, X } from 'lucide-react';
import { Delta } from '@/components/ui/delta';
import { Sparkline } from '@/components/ui/sparkline';
import { Badge } from '@/components/ui/badge';
import { Tip } from '@/components/ui/tooltip';
import { isTypingTarget } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { formatBigMoney, SCREEN_COLUMNS } from '@/lib/screener/columns';
import { CATALYST_LABELS, daysUntil, SORTABLE_KEYS } from '@/lib/screener/engine';
import type { ScreenResultRow } from '@/lib/screener/types';
import { WhyNow } from './WhyNow';

const SORTABLE = new Set<string>(SORTABLE_KEYS);
const fin = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const NA = <span className="text-muted" title="Not available">—</span>;
const num = (v: number | null, dp = 1, suffix = '') => (fin(v) ? `${v.toFixed(dp)}${suffix}` : NA);
const signedCls = (v: number | null) => (!fin(v) || v === 0 ? 'text-muted' : v > 0 ? 'text-up' : 'text-down');
const signed = (v: number | null, dp = 1) => (fin(v) ? `${v > 0 ? '+' : ''}${v.toFixed(dp)}%` : '—');
/** P/E or EV/EBITDA: '—' when unavailable (incl. funds), 'n/m' when negative. */
const multiple = (v: number | null, isEtf?: boolean) => (!fin(v) || isEtf ? NA : v > 0 ? num(v, 1, 'x') : <span className="text-muted">n/m</span>);

function buildColumns(expanded: Set<string>, toggle: (t: string) => void, onRemove?: (t: string) => void): TColumnDef<ScreenResultRow>[] {
  const cell: Record<string, TColumnDef<ScreenResultRow>['cell']> = {
    ticker: ({ row }) => {
      const t = row.original.ticker;
      const open = expanded.has(t);
      return (
        <span className="flex min-w-[96px] items-center gap-1">
          <button type="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); toggle(t); }} className="rounded p-0.5 text-muted hover:text-text" aria-label={`${open ? 'Hide' : 'Show'} why now for ${t}`} aria-expanded={open}>
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <Link href={`/company/${t}`} className="font-mono font-semibold text-info hover:underline" onClick={(e) => e.stopPropagation()}>{t}</Link>
          {row.original.isEtf && <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[9px]">ETF</Badge>}
          {onRemove && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(t); }}
              className={cn(
                'ml-auto rounded p-0.5 text-muted hover:bg-down/10 hover:text-down focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info',
                row.original.status === 'not_found' ? 'opacity-100' : 'opacity-40 group-hover:opacity-100',
              )}
              aria-label={`Remove ${t}`}
              title={`Remove ${t} from this list`}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </span>
      );
    },
    name: ({ row }) => row.original.status === 'not_found'
      ? <Badge variant="warn" title="No quote at Alpaca and no profile at FMP">Not found</Badge>
      : <span className="block max-w-[200px] truncate" title={row.original.name}>{row.original.name}</span>,
    group: ({ row }) => (row.original.group ? <Badge variant="outline" className="whitespace-nowrap">{row.original.group}</Badge> : <span className="text-muted">—</span>),
    sector: ({ row }) => <span className="block max-w-[160px] truncate text-muted">{row.original.sector}</span>,
    industry: ({ row }) => <span className="block max-w-[160px] truncate text-muted">{row.original.industry}</span>,
    country: ({ row }) => <span className="text-muted">{row.original.country}</span>,
    marketCap: ({ row }) => (fin(row.original.marketCap) ? formatBigMoney(row.original.marketCap) : NA),
    price: ({ row }) => (fin(row.original.price) ? `$${row.original.price.toFixed(2)}` : NA),
    changePct: ({ row }) => <Delta value={row.original.changePct} badge className="text-xs" />,
    sparkline: ({ row }) => <Sparkline data={row.original.sparkline} width={64} height={18} label={`${row.original.ticker} 30-day trend`} />,
    pe: ({ row }) => multiple(row.original.pe, row.original.isEtf),
    evEbitda: ({ row }) => multiple(row.original.evEbitda, row.original.isEtf),
    revenueGrowth: ({ row }) => <span className={signedCls(row.original.revenueGrowth)}>{signed(row.original.revenueGrowth)}</span>,
    epsRevision30d: ({ row }) => <span className={signedCls(row.original.epsRevision30d)}>{signed(row.original.epsRevision30d)}</span>,
    shortInterestPct: ({ row }) => <span className={(row.original.shortInterestPct ?? 0) >= 10 ? 'text-warn' : ''}>{num(row.original.shortInterestPct, 1, '%')}</span>,
    insiderBuying90d: ({ row }) => {
      const v = row.original.insiderBuying90d;
      if (!fin(v)) return NA;
      return <span className={signedCls(v)} title={v === 0 ? 'No open-market insider buys or sells in 90 days' : undefined}>{v === 0 ? '$0' : `${v > 0 ? '+' : ''}${formatBigMoney(v)}`}</span>;
    },
    esgScore: ({ row }) => num(row.original.esgScore, 0),
    nextEarnings: ({ row }) => {
      const d = row.original.nextEarnings;
      if (!d) return <span className="text-muted">—</span>;
      const n = daysUntil(d, new Date());
      return <span title={d}>{d.slice(5)}{n >= 0 && n <= 60 ? <span className={cn('ml-1 text-[10px]', n <= 14 ? 'text-accent' : 'text-muted')}>{n}d</span> : null}</span>;
    },
    catalystFlags: ({ row }) => (
      <span className="flex gap-1">
        {row.original.catalystFlags.length === 0 ? <span className="text-muted">—</span> : row.original.catalystFlags.slice(0, 3).map((c) => (
          <Badge key={c} variant={c === 'fda' ? 'warn' : c === 'earnings' ? 'info' : 'outline'} className="whitespace-nowrap">{CATALYST_LABELS[c as keyof typeof CATALYST_LABELS]?.replace(' (45d)', '') ?? c}</Badge>
        ))}
      </span>
    ),
    whyNow: ({ row }) => (
      <button type="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); toggle(row.original.ticker); }} className="block max-w-[280px] truncate text-left text-muted hover:text-text" title={row.original.whyNow.headline}>
        {row.original.whyNow.headline}
      </button>
    ),
  };
  const cols: TColumnDef<ScreenResultRow>[] = SCREEN_COLUMNS.map((c) => ({
    id: c.id,
    accessorFn: (r: ScreenResultRow) => (c.id === 'sparkline' || c.id === 'whyNow' ? null : c.get(r)),
    header: c.note
      ? () => (
        <Tip content={c.note}>
          <span className="inline-flex items-center gap-0.5">{c.label}<Info className="h-2.5 w-2.5 opacity-60" aria-hidden /></span>
        </Tip>
      )
      : c.label,
    enableSorting: SORTABLE.has(c.id),
    enableHiding: c.id !== 'ticker',
    sortDescFirst: !['ticker', 'name', 'sector', 'industry', 'country', 'nextEarnings'].includes(c.id),
    cell: cell[c.id],
    meta: { numeric: !['text', 'list', 'date'].includes(c.format) || c.id === 'nextEarnings' },
  }));
  return cols;
}

interface Props {
  rows: ScreenResultRow[];
  sorting: SortingState;
  onSortingChange: (s: SortingState) => void;
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: (v: VisibilityState) => void;
  compact: boolean;
  dim?: boolean;
  /** show a remove (x) button per row */
  onRemove?: (ticker: string) => void;
}

export function ScreenerGrid({ rows, sorting, onSortingChange, columnVisibility, onColumnVisibilityChange, compact, dim, onRemove }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [active, setActive] = React.useState(0);
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = React.useState(0);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const toggle = React.useCallback((t: string) => setExpanded((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; }), []);
  const columns = React.useMemo(() => buildColumns(expanded, toggle, onRemove), [expanded, toggle, onRemove]);

  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.ticker,
    state: { sorting, columnVisibility, columnPinning: { left: ['ticker'] } },
    onSortingChange: (u) => onSortingChange(typeof u === 'function' ? u(sorting) : u),
    onColumnVisibilityChange: (u) => onColumnVisibilityChange(typeof u === 'function' ? u(columnVisibility) : u),
    manualSorting: true,
    enableMultiSort: true,
    maxMultiSortColCount: 5,
    enableColumnPinning: true,
    getCoreRowModel: getCoreRowModel(),
  });

  React.useEffect(() => { setActive((a) => Math.min(a, Math.max(0, rows.length - 1))); }, [rows.length]);

  // keyboard: j/k move, enter opens company, w toggles why-now
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('[role=dialog],[role=menu],[data-radix-popper-content-wrapper]')) return;
      if (!rows.length) return;
      if (e.key === 'j' || e.key === 'ArrowDown' && el === document.body) { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
      else if (e.key === 'k' || e.key === 'ArrowUp' && el === document.body) { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
      else if (e.key === 'Enter' && !el?.closest('button,a,input,select,textarea')) { e.preventDefault(); router.push(`/company/${rows[active]?.ticker}`); }
      else if (e.key === 'w') { e.preventDefault(); if (rows[active]) toggle(rows[active].ticker); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, active, router, toggle]);

  React.useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>(`[data-row-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const visibleCount = table.getVisibleLeafColumns().length;
  const pad = compact ? 'px-2 py-1' : 'px-3 py-2';

  return (
    <div ref={scrollRef} className={cn('relative max-h-[calc(100vh-230px)] min-h-[320px] overflow-auto rounded-lg border border-border bg-panel scrollbar-thin transition-opacity', dim && 'opacity-60')}>
      <table className={cn('w-full border-separate border-spacing-0 text-left', compact ? 'text-[11px]' : 'text-xs')} aria-label="Screen results" aria-rowcount={rows.length}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const pinned = h.column.getIsPinned() === 'left';
                const s = h.column.getIsSorted();
                const idx = h.column.getSortIndex();
                const numeric = (h.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric;
                return (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={s === 'asc' ? 'ascending' : s === 'desc' ? 'descending' : undefined}
                    className={cn('sticky top-0 z-10 whitespace-nowrap border-b border-border bg-panel-2 font-medium text-muted', pad, numeric && 'text-right', pinned && 'left-0 z-20 border-r')}
                  >
                    {h.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className={cn('inline-flex items-center gap-1 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info rounded', s && 'text-text')}
                        title="Click to sort, shift-click to add a secondary sort"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {s === 'asc' ? <ArrowUp className="h-3 w-3" /> : s === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                        {s && sorting.length > 1 && <span className="font-mono text-[9px]">{idx + 1}</span>}
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody ref={bodyRef}>
          {table.getRowModel().rows.map((r, i) => {
            const isActive = i === active;
            const open = expanded.has(r.original.ticker);
            return (
              <React.Fragment key={r.id}>
                <tr
                  data-row-index={i}
                  aria-selected={isActive}
                  onClick={() => setActive(i)}
                  onDoubleClick={() => router.push(`/company/${r.original.ticker}`)}
                  className={cn('group cursor-default', isActive ? 'bg-info/10' : 'hover:bg-panel-2/60', r.original.status === 'not_found' && 'opacity-70')}
                >
                  {r.getVisibleCells().map((c) => {
                    const pinned = c.column.getIsPinned() === 'left';
                    const numeric = (c.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric;
                    return (
                      <td
                        key={c.id}
                        className={cn(
                          'whitespace-nowrap border-b border-border/60', pad,
                          numeric && 'text-right font-mono tabular-nums',
                          pinned && cn('sticky left-0 z-[5] border-r', isActive ? 'bg-[rgb(var(--panel-2))]' : 'bg-panel group-hover:bg-[rgb(var(--panel-2))]'),
                          pinned && isActive && 'shadow-[inset_2px_0_0_rgb(var(--info))]',
                        )}
                      >
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </td>
                    );
                  })}
                </tr>
                {open && (
                  <tr className="bg-panel-2/30">
                    <td colSpan={visibleCount} className="border-b border-border/60 px-3 py-2">
                      <div className="sticky left-3" style={{ width: viewW ? Math.min(viewW - 26, 1100) : undefined }}><WhyNow row={r.original} /></div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

