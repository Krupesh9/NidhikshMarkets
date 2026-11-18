'use client';
import * as React from 'react';
import { Area, Bar as VolBar, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AreaChart as AreaIcon, LineChart as LineIcon, CalendarClock } from 'lucide-react';
import type { Bar, HistoryRange } from '@/lib/data/types';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Delta } from '@/components/ui/delta';
import { cn, fmt } from '@/lib/utils';
import { EVENT_KIND_LABEL, snapEventsToBars, type ChartEvent, type ChartEventKind } from './lib/helpers';
import { useOpenSource } from './MetricButton';

const RANGES: HistoryRange[] = ['1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX'];

const KIND_COLOR: Record<ChartEventKind, string> = {
  earnings: 'rgb(var(--accent))',
  filing: 'rgb(var(--info))',
  insider: 'rgb(var(--up))',
  news: 'rgb(var(--warn))',
};
const KIND_SHORT: Record<ChartEventKind, string> = { earnings: 'E', filing: 'F', insider: 'I', news: 'N' };

interface Point extends Bar { events?: ChartEvent[] }

function useHistory(ticker: string, range: HistoryRange, initial: { range: HistoryRange; bars: Bar[] }) {
  const [cache, setCache] = React.useState<Partial<Record<HistoryRange, Bar[]>>>({ [initial.range]: initial.bars });
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    if (cache[range]) return;
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/company/${encodeURIComponent(ticker)}/history?range=${range}`, { signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? `HTTP ${r.status}`);
        return r.json() as Promise<{ bars: Bar[] }>;
      })
      .then((j) => setCache((c) => ({ ...c, [range]: j.bars })))
      .catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [ticker, range, cache]);
  return { bars: cache[range], loading: loading && !cache[range], error };
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Point }> }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="min-w-[180px] rounded-md border border-border bg-panel-2 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium">{fmt.date(p.date)}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono tabular-nums">
        <dt className="text-muted">O</dt><dd className="text-right">{fmt.price(p.open)}</dd>
        <dt className="text-muted">H</dt><dd className="text-right">{fmt.price(p.high)}</dd>
        <dt className="text-muted">L</dt><dd className="text-right">{fmt.price(p.low)}</dd>
        <dt className="text-muted">C</dt><dd className="text-right font-semibold">{fmt.price(p.close)}</dd>
        <dt className="text-muted">V</dt><dd className="text-right">{fmt.num(p.volume)}</dd>
      </dl>
      {p.events?.length ? (
        <ul className="mt-2 space-y-1 border-t border-border pt-1.5">
          {p.events.slice(0, 4).map((e) => (
            <li key={e.id} className="flex gap-1.5">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[e.kind] }} aria-hidden />
              <span className="line-clamp-2">{e.title}</span>
            </li>
          ))}
          {p.events.length > 4 && <li className="text-muted">+{p.events.length - 4} more · click marker</li>}
        </ul>
      ) : null}
    </div>
  );
}

export function PriceChart({ ticker, initialBars, events, isMock }: { ticker: string; initialBars: Bar[]; events: ChartEvent[]; isMock: boolean }) {
  const [range, setRange] = React.useState<HistoryRange>('1Y');
  const [mode, setMode] = React.useState<'area' | 'line'>('area');
  const [kinds, setKinds] = React.useState<Record<ChartEventKind, boolean>>({ earnings: true, filing: true, insider: true, news: true });
  const { bars, loading, error } = useHistory(ticker, range, { range: '1Y', bars: initialBars });
  const openSource = useOpenSource();

  const visibleEvents = React.useMemo(() => events.filter((e) => kinds[e.kind]), [events, kinds]);
  const { data, snapped, domain, maxVol } = React.useMemo(() => {
    const b = bars ?? [];
    const snapped = snapEventsToBars(visibleEvents, b.map((x) => x.date));
    const data: Point[] = b.map((x) => ({ ...x, events: snapped.get(x.date) }));
    const lows = b.map((x) => x.low).filter((v) => v > 0);
    const highs = b.map((x) => x.high);
    const lo = lows.length ? Math.min(...lows) : 0;
    const hi = highs.length ? Math.max(...highs) : 1;
    const pad = (hi - lo) * 0.06 || hi * 0.02;
    return { data, snapped, domain: [Math.max(0, lo - pad * 1.5), hi + pad] as [number, number], maxVol: Math.max(1, ...b.map((x) => x.volume)) };
  }, [bars, visibleEvents]);

  const first = data[0]?.close;
  const last = data[data.length - 1]?.close;
  const periodChange = first && last ? ((last - first) / first) * 100 : null;
  const up = (periodChange ?? 0) >= 0;
  const stroke = up ? 'rgb(var(--up))' : 'rgb(var(--down))';
  const inRange = React.useMemo(() => Array.from(snapped.values()).flat().sort((a, b) => b.date.localeCompare(a.date)), [snapped]);
  const [showAll, setShowAll] = React.useState(false);

  const openEvents = (date: string, evs: ChartEvent[]) => {
    const e = evs[0];
    openSource(e.source, {
      title: `${EVENT_KIND_LABEL[e.kind]} · ${fmt.date(date)}`,
      heading: (
        <ul className="space-y-1.5">
          {evs.map((x) => (
            <li key={x.id}>
              <button type="button" className="text-left hover:text-info hover:underline" onClick={() => openSource(x.source, { title: `${EVENT_KIND_LABEL[x.kind]} · ${fmt.date(x.date)}` })}>
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLOR[x.kind] }} aria-hidden />
                <span className="font-medium">{x.title}</span>
              </button>
              {x.detail && <div className="pl-3.5 text-xs text-muted">{x.detail}</div>}
            </li>
          ))}
        </ul>
      ),
    });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Chart range" className="inline-flex rounded-md border border-border bg-panel-2 p-0.5">
          {RANGES.map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r}
              className={cn('rounded px-2.5 py-1 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', range === r ? 'bg-accent text-accent-foreground' : 'text-muted hover:text-text')}>
              {r}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Chart type" className="inline-flex rounded-md border border-border bg-panel-2 p-0.5">
          {(['area', 'line'] as const).map((m) => {
            const Icon = m === 'area' ? AreaIcon : LineIcon;
            return (
              <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} aria-label={`${m} chart`}
                className={cn('rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', mode === m ? 'bg-border text-text' : 'text-muted hover:text-text')}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </button>
            );
          })}
        </div>
        {periodChange != null && (
          <span className="text-xs text-muted">
            {range} change <Delta value={periodChange} className="text-xs" />
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5" role="group" aria-label="Event markers">
          {(Object.keys(KIND_COLOR) as ChartEventKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKinds((s) => ({ ...s, [k]: !s[k] }))} aria-pressed={kinds[k]}
              className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', kinds[k] ? 'border-border text-text' : 'border-transparent text-muted line-through')}>
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} aria-hidden />
              {EVENT_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-[340px]">
        {loading || !bars ? (
          <Skeleton className="h-full w-full" />
        ) : error ? (
          <EmptyState title="Couldn't load price history" description={`${error}. Try another range.`} className="h-full" />
        ) : data.length < 2 ? (
          <EmptyState icon={CalendarClock} title="No price history for this range" description="The data provider returned no bars. Try a longer range such as 1Y or 5Y." className="h-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`fill-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'rgb(var(--border))' }} minTickGap={48}
                tickFormatter={(d: string) => (['5Y', 'MAX'].includes(range) ? d.slice(0, 4) : new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))} />
              <YAxis yAxisId="price" orientation="right" domain={domain} tick={{ fill: 'rgb(var(--muted))', fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmt.price(v)} />
              <YAxis yAxisId="vol" hide domain={[0, maxVol * 4]} />
              <Tooltip content={(p) => <ChartTooltip active={p.active} payload={p.payload as ReadonlyArray<{ payload?: Point }>} />} cursor={{ stroke: 'rgb(var(--muted))', strokeDasharray: '3 3' }} isAnimationActive={false} />
              <VolBar yAxisId="vol" dataKey="volume" fill="rgb(var(--muted))" opacity={0.25} isAnimationActive={false} />
              {mode === 'area' ? (
                <Area yAxisId="price" type="monotone" dataKey="close" stroke={stroke} strokeWidth={1.6} fill={`url(#fill-${ticker})`} isAnimationActive={false} dot={false} activeDot={{ r: 3 }} />
              ) : (
                <Line yAxisId="price" type="monotone" dataKey="close" stroke={stroke} strokeWidth={1.6} isAnimationActive={false} dot={false} activeDot={{ r: 3 }} />
              )}
              {data.filter((pt) => pt.events?.length).map((pt) => {
                const date = pt.date;
                const evs = pt.events!;
                const k = evs[0].kind;
                return (
                  <ReferenceDot key={date} yAxisId="price" x={date} y={pt.close} ifOverflow="extendDomain"
                    shape={(p: { cx?: number; cy?: number }) => (
                      <g style={{ cursor: 'pointer' }} onClick={() => openEvents(date, evs)} role="button" aria-label={`${evs.length} event(s) on ${date}: ${evs[0].title}`}>
                        <circle cx={p.cx} cy={p.cy} r={evs.length > 1 ? 7 : 6} fill={KIND_COLOR[k]} stroke="rgb(var(--panel))" strokeWidth={1.5} />
                        <text x={p.cx} y={(p.cy ?? 0) + 3} textAnchor="middle" fontSize={8} fontWeight={700} fill="rgb(var(--bg))">{evs.length > 1 ? evs.length : KIND_SHORT[k]}</text>
                      </g>
                    )} />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
          <span>{inRange.length} event{inRange.length === 1 ? '' : 's'} in range{isMock ? ' · includes simulated events' : ''}</span>
          {inRange.length > 8 && (
            <button type="button" className="text-info hover:underline" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show fewer' : `Show all ${inRange.length}`}</button>
          )}
        </div>
        {inRange.length === 0 ? (
          <p className="text-xs text-muted">No earnings, 8-K, insider-buy or major-news events fall in this range. Try 1Y or 5Y.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {(showAll ? inRange : inRange.slice(0, 8)).map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => openSource(e.source, { title: `${EVENT_KIND_LABEL[e.kind]} · ${fmt.date(e.date)}`, heading: <><div className="font-medium">{e.title}</div>{e.detail && <div className="text-xs text-muted">{e.detail}</div>}</> })}
                  className="inline-flex max-w-[320px] items-center gap-1.5 rounded border border-border bg-panel-2 px-2 py-1 text-left text-[11px] hover:border-info/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[e.kind] }} aria-hidden />
                  <span className="font-mono text-muted">{e.date.slice(5)}</span>
                  <span className="truncate">{e.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
