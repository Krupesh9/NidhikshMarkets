'use client';
import * as React from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LineChart as LineIcon } from 'lucide-react';
import { Delta } from '@/components/ui/delta';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { cn, fmt } from '@/lib/utils';

type Range = '1M' | '3M' | '1Y' | '5Y';
const RANGES: Range[] = ['1M', '3M', '1Y', '5Y'];

export interface ChartHistory {
  range: Range;
  points: { date: string; value: number }[];
  unit: 'price' | 'yield';
  source: { name: string; url?: string };
  note: string;
  isMock?: boolean;
}

const fmtVal = (v: number, unit: ChartHistory['unit']) => (unit === 'yield' ? `${v.toFixed(2)}%` : fmt.price(v));

function Tip({ active, payload, unit }: { active?: boolean; payload?: ReadonlyArray<{ payload?: { date: string; value: number } }>; unit: ChartHistory['unit'] }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-border bg-panel px-3 py-2 text-xs shadow-xl shadow-black/30">
      <div className="text-muted">{new Date(`${p.date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{fmtVal(p.value, unit)}</div>
    </div>
  );
}

/** Large area chart for /markets/[slug] with 1M / 3M / 1Y / 5Y ranges (fetched on demand, cached per range). */
export function MarketChart({ slug, label, initial }: { slug: string; label: string; initial: ChartHistory }) {
  const [range, setRange] = React.useState<Range>(initial.range);
  const [store, setStore] = React.useState<Partial<Record<Range, ChartHistory>>>({ [initial.range]: initial });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const data = store[range];

  React.useEffect(() => {
    if (store[range]) return;
    const ctl = new AbortController();
    setLoading(true); setError(null);
    fetch(`/api/markets/${encodeURIComponent(slug)}/history?range=${range}`, { signal: ctl.signal })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as ChartHistory; })
      .then((h) => setStore((s) => ({ ...s, [range]: h })))
      .catch((e: Error) => { if (e.name !== 'AbortError') setError('Could not load this range.'); })
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [range, slug, store]);

  const pts = data?.points ?? [];
  const first = pts[0]?.value;
  const last = pts[pts.length - 1]?.value;
  const up = first == null || last == null || last >= first;
  const stroke = up ? 'rgb(var(--up))' : 'rgb(var(--down))';
  const unit = data?.unit ?? initial.unit;
  const chg = first != null && last != null ? (unit === 'yield' ? (last - first) * 100 : first ? ((last - first) / first) * 100 : null) : null;
  const domain = React.useMemo(() => {
    if (!pts.length) return [0, 1] as [number, number];
    const vs = pts.map((p) => p.value);
    const lo = Math.min(...vs), hi = Math.max(...vs);
    const pad = (hi - lo) * 0.08 || hi * 0.01;
    return [lo - pad, hi + pad] as [number, number];
  }, [pts]);
  const long = range === '5Y' || range === '1Y';
  const tick = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', long ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm">
          <span className="eyebrow">{unit === 'yield' ? 'Yield' : 'Price'} · {range}</span>
          {chg != null && <Delta value={chg} suffix={unit === 'yield' ? ' bp' : '%'} dp={unit === 'yield' ? 0 : 2} badge className="min-w-0 text-xs" />}
        </div>
        <div role="group" aria-label="Chart range" className="inline-flex rounded-lg border border-border bg-panel-2 p-0.5">
          {RANGES.map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r}
              className={cn('rounded-md px-3 py-1 font-mono text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info',
                range === r ? 'bg-panel text-text shadow-sm' : 'text-muted hover:text-text')}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-4 h-[340px] sm:h-[400px]" aria-busy={loading}>
        {!data && loading ? <Skeleton className="h-full w-full" /> : pts.length < 2 ? (
          <EmptyState icon={LineIcon} title={error ?? 'No price history for this range'} description="Try another range, or check back once the data provider responds." className="h-full" />
        ) : (
          <figure className="h-full" aria-label={`${label} ${range} chart: from ${fmtVal(first!, unit)} to ${fmtVal(last!, unit)}`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={pts} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`mfill-${slug}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'rgb(var(--border))' }} minTickGap={56} tickFormatter={tick} />
                <YAxis orientation="right" domain={domain} tick={{ fill: 'rgb(var(--muted))', fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }} tickLine={false} axisLine={false} width={64}
                  tickFormatter={(v: number) => (unit === 'yield' ? `${v.toFixed(2)}%` : v >= 1000 ? fmt.num(v) : v.toFixed(2))} />
                <Tooltip content={(p) => <Tip active={p.active} payload={p.payload as ReadonlyArray<{ payload?: { date: string; value: number } }>} unit={unit} />} cursor={{ stroke: 'rgb(var(--muted))', strokeDasharray: '3 3' }} isAnimationActive={false} />
                <Area type="monotone" dataKey="value" stroke={stroke} strokeWidth={1.8} fill={`url(#mfill-${slug})`} isAnimationActive={false} dot={false} activeDot={{ r: 3.5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </figure>
        )}
        {loading && data && <div className="absolute right-2 top-2 text-[11px] text-muted">Loading…</div>}
      </div>
      {data && (
        <p className="mt-3 text-[11px] text-muted">
          {data.note} · source{' '}
          {data.source.url ? <a href={data.source.url} target="_blank" rel="noopener noreferrer" className="hover:text-info hover:underline">{data.source.name}</a> : data.source.name}
          {data.isMock && <span className="ml-1 text-warn">· simulated data</span>}
        </p>
      )}
    </div>
  );
}
