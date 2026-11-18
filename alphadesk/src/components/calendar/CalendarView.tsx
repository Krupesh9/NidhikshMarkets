'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  BarChart3, Briefcase, CalendarDays, CalendarOff, ChevronLeft, ChevronRight, Clock3, ExternalLink, Factory, FileText, Gauge,
  Landmark, ScrollText, ShoppingCart, Smile, Users, type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import type { CalendarCategory, CalendarEvent, CalendarSourceStatus } from '@/lib/calendar/types';
import { addDays, agendaGroup, parseYmd, startOfWeek } from '@/lib/calendar/dates';

type Filter = 'all' | Exclude<CalendarCategory, 'market'>;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'earnings', label: 'Earnings' }, { id: 'inflation', label: 'Inflation' },
  { id: 'jobs', label: 'Jobs' }, { id: 'fed', label: 'Fed' }, { id: 'growth', label: 'Growth' },
];

const KIND_ICON: Record<string, LucideIcon> = {
  earnings: Briefcase, cpi: Gauge, ppi: Gauge, pce: Gauge, jobs: Users, jolts: Users, claims: FileText, fomc: Landmark,
  minutes: ScrollText, gdp: BarChart3, retail: ShoppingCart, sentiment: Smile, ip: Factory, holiday: CalendarOff, 'early-close': Clock3,
};
const CAT_DOT: Record<CalendarCategory, string> = {
  earnings: 'bg-info', inflation: 'bg-warn', jobs: 'bg-up', fed: 'bg-accent', growth: 'bg-text/60', market: 'bg-muted',
};
const CAT_TINT: Record<CalendarCategory, string> = {
  earnings: 'text-info bg-info/10', inflation: 'text-warn bg-warn/10', jobs: 'text-up bg-up/10', fed: 'text-accent bg-accent/10',
  growth: 'text-text bg-panel-2', market: 'text-muted bg-panel-2',
};

const dayFmt = (d: string, o: Intl.DateTimeFormatOptions) => parseYmd(d).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });

function chipCls(on: boolean) {
  return cn(
    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    on ? 'border-accent/50 bg-accent/15 text-accent' : 'border-border bg-panel text-muted hover:bg-panel-2 hover:text-text',
  );
}

export interface CalendarViewProps {
  events: CalendarEvent[];
  today: string;
  watchlist: string[];
  sources: CalendarSourceStatus[];
}

export function CalendarView({ events, today, watchlist, sources }: CalendarViewProps) {
  const [filter, setFilter] = React.useState<Filter>('all');
  const [scope, setScope] = React.useState<'watchlist' | 'all'>('watchlist');
  const [showClaims, setShowClaims] = React.useState(false);
  const [month, setMonth] = React.useState(today.slice(0, 7));
  const [flash, setFlash] = React.useState<string | null>(null);

  const visible = React.useMemo(
    () =>
      events.filter((e) => {
        if (filter !== 'all' && e.category !== filter) return false;
        if (e.category === 'earnings' && scope === 'watchlist' && !e.inWatchlist) return false;
        if (e.recurring && !showClaims) return false;
        return true;
      }),
    [events, filter, scope, showClaims],
  );

  const byDay = React.useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of visible) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [visible]);

  const groups = React.useMemo(() => {
    const out: { key: string; label: string; days: string[] }[] = [];
    for (const d of [...byDay.keys()].sort()) {
      const g = agendaGroup(d, today);
      const last = out[out.length - 1];
      if (last?.key === g.key) last.days.push(d);
      else out.push({ ...g, days: [d] });
    }
    return out;
  }, [byDay, today]);

  const claimsCount = events.filter((e) => e.recurring).length;
  const allEarnings = events.filter((e) => e.category === 'earnings').length;
  const wlEarnings = events.filter((e) => e.category === 'earnings' && e.inWatchlist).length;

  const jumpTo = (d: string) => {
    const el = document.getElementById(`day-${d}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (el as HTMLElement).focus({ preventScroll: true });
    setFlash(d);
    window.setTimeout(() => setFlash((f) => (f === d ? null : f)), 1600);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Filter by event type" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={chipCls(filter === f.id)}>
                {f.id !== 'all' && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', CAT_DOT[f.id])} />}
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Earnings coverage" className="inline-flex rounded-full border border-border bg-panel p-0.5">
              {(['watchlist', 'all'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
                  className={cn('h-7 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', scope === s ? 'bg-panel-2 text-text' : 'text-muted hover:text-text')}>
                  {s === 'watchlist' ? `Watchlist earnings (${wlEarnings})` : `All covered names (${allEarnings})`}
                </button>
              ))}
            </div>
            {claimsCount > 0 && (filter === 'all' || filter === 'jobs') && (
              <button type="button" aria-pressed={showClaims} onClick={() => setShowClaims((v) => !v)} className={chipCls(showClaims)}>
                <FileText className="h-3.5 w-3.5" aria-hidden /> Weekly jobless claims
              </button>
            )}
          </div>
        </div>

        {groups.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={filter === 'earnings' && scope === 'watchlist' ? 'No watchlist earnings in the next 90 days' : 'Nothing scheduled for this filter'}
            description={
              filter === 'earnings' && scope === 'watchlist'
                ? watchlist.length ? 'Switch to “All covered names” to see other reporting companies.' : 'Add tickers to your watchlist to track their earnings dates here.'
                : 'Try another filter, or include weekly jobless claims.'
            }
            action={filter === 'earnings' && !watchlist.length ? <Link href="/watchlist" className="text-xs text-info hover:underline">Open watchlist</Link> : undefined}
            className="py-16"
          />
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-labelledby={`grp-${g.key}`} className="space-y-3">
              <h2 id={`grp-${g.key}`} className="eyebrow">{g.label}</h2>
              <Card className="divide-y divide-border overflow-hidden">
                {g.days.map((d) => (
                  <DayRow key={d} date={d} today={today} events={byDay.get(d) ?? []} flash={flash === d} />
                ))}
              </Card>
            </section>
          ))
        )}
        <p className="text-[11px] text-muted">
          Dates from official agency calendars via FRED, the Federal Reserve FOMC schedule, NYSE holiday calendar and the Alpha Vantage earnings calendar. Earnings timing and estimates can change — confirm with the company. Research only — not investment advice.
        </p>
      </div>

      <aside className="hidden lg:block" aria-label="Month overview">
        <div className="sticky top-4 space-y-6">
          <MonthGrid month={month} setMonth={setMonth} today={today} byDay={byDay} onPick={jumpTo} />
          <Card>
            <CardHeader><CardTitle className="eyebrow">Sources</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {sources.map((s) => (
                <div key={s.id} className="flex items-start justify-between gap-3 text-xs">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', s.ok ? 'bg-up' : 'bg-down')} />
                    {s.name}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-muted" title={s.note}>{s.ok ? s.count : s.note ?? 'unavailable'}</span>
                </div>
              ))}
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-2 text-[11px] text-muted">
                {(Object.keys(CAT_DOT) as CalendarCategory[]).map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5 capitalize"><span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', CAT_DOT[c])} />{c}</span>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </aside>
    </div>
  );
}

function DayRow({ date, today, events, flash }: { date: string; today: string; events: CalendarEvent[]; flash: boolean }) {
  const isToday = date === today;
  const past = date < today;
  return (
    <div
      id={`day-${date}`}
      tabIndex={-1}
      className={cn(
        'flex scroll-mt-24 gap-5 p-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-info',
        isToday && 'bg-accent/[0.06]',
        flash && 'bg-info/10',
        past && 'opacity-60',
      )}
    >
      <div className={cn('flex w-14 shrink-0 flex-col items-center self-start rounded-lg border py-2 text-center', isToday ? 'border-accent/50 bg-accent/10' : 'border-border bg-panel-2')}>
        <span className={cn('text-[10px] font-semibold uppercase tracking-[0.14em]', isToday ? 'text-accent' : 'text-muted')}>{isToday ? 'Today' : dayFmt(date, { weekday: 'short' })}</span>
        <span className="font-mono text-xl font-semibold tabular-nums leading-tight">{dayFmt(date, { day: 'numeric' })}</span>
        <span className="text-[10px] uppercase text-muted">{dayFmt(date, { month: 'short' })}</span>
      </div>
      <ul className="min-w-0 flex-1 space-y-3">
        {events.map((e) => <EventRow key={e.id} e={e} />)}
      </ul>
    </div>
  );
}

function EventRow({ e }: { e: CalendarEvent }) {
  const Icon = KIND_ICON[e.kind] ?? CalendarDays;
  // Don't repeat a timing that the title already states ("NVDA earnings · After close").
  const meta = [e.time && !e.title.includes(e.time) ? e.time : undefined, e.detail].filter(Boolean).join(' \u00B7 ');
  return (
    <li className="flex items-start gap-3">
      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', CAT_TINT[e.category])}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium leading-snug">
            {e.ticker ? (
              <>
                <Link href={`/company/${e.ticker}`} className="font-mono text-info hover:underline">{e.ticker}</Link>
                {e.title.slice(e.ticker.length)}
              </>
            ) : e.title}
          </span>
          {e.importance === 'high' && <Badge variant="accent">High</Badge>}
          {e.importance === 'medium' && <Badge variant="outline">Medium</Badge>}
          {e.estimated && <Badge variant="warn">Estimated</Badge>}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">
          {meta && <>{meta}{' \u00B7 '}</>}
          {e.source.url ? (
            <a href={e.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-info hover:underline">
              {e.source.name}<ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only"> (opens in new tab)</span>
            </a>
          ) : e.source.name}
        </p>
      </div>
    </li>
  );
}

function MonthGrid({ month, setMonth, today, byDay, onPick }: {
  month: string; setMonth: (m: string) => void; today: string; byDay: Map<string, CalendarEvent[]>; onPick: (d: string) => void;
}) {
  const first = `${month}-01`;
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const shift = (n: number) => {
    const d = parseYmd(first);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const label = parseYmd(first).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const lastRowNeeded = cells.slice(35).some((d) => d.slice(0, 7) === month);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle aria-live="polite">{label}</CardTitle>
        <div className="flex gap-1">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-center" role="group" aria-label={`${label} events`}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="pb-1 text-[10px] font-semibold text-muted" aria-hidden>{d}</div>)}
          {(lastRowNeeded ? cells : cells.slice(0, 35)).map((d) => {
            const evs = byDay.get(d) ?? [];
            const inMonth = d.slice(0, 7) === month;
            const cats = [...new Set(evs.map((e) => e.category))].slice(0, 3);
            const isToday = d === today;
            return (
              <button
                key={d}
                type="button"
                disabled={!evs.length}
                onClick={() => onPick(d)}
                aria-label={`${dayFmt(d, { weekday: 'long', month: 'long', day: 'numeric' })}: ${evs.length ? `${evs.length} event${evs.length > 1 ? 's' : ''}` : 'no events'}`}
                className={cn(
                  'flex h-10 flex-col items-center justify-center gap-1 rounded-md text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info',
                  inMonth ? 'text-text' : 'text-muted/50',
                  evs.length ? 'hover:bg-panel-2' : 'cursor-default',
                  isToday && 'bg-accent/15 font-semibold text-accent',
                )}
              >
                <span>{parseYmd(d).getUTCDate()}</span>
                <span className="flex h-1.5 gap-0.5" aria-hidden>
                  {cats.map((c) => <span key={c} className={cn('h-1.5 w-1.5 rounded-full', CAT_DOT[c])} />)}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
