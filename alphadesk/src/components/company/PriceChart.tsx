'use client';
import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  Area, Bar as RBar, Cell, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AreaChart as AreaIcon, LineChart as LineIcon, CandlestickChart, CalendarClock, ChevronDown, X } from 'lucide-react';
import type { Bar, HistoryRange } from '@/lib/data/types';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Delta } from '@/components/ui/delta';
import { cn, fmt } from '@/lib/utils';
import { crossovers, ema, macd, rsi, sma, type Out } from './lib/indicators';

/** Intraday ranges are being added to HistoryRange by the data layer; keep a local superset so this compiles either way. */
type ChartRange = HistoryRange | '1D' | '1W';
const RANGES: ChartRange[] = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX'];
const INTRADAY = new Set<ChartRange>(['1D', '1W']);

const PERIODS = [10, 20, 30, 40, 50, 100, 200] as const;
const RSI_PERIODS = [14, 10, 20, 30] as const;

/** One distinct hue per period (SMA solid, EMA dashed). Mid-tone so they read on dark and light panels. */
const PERIOD_COLOR: Record<number, string> = {
  10: '#06b6d4', // cyan
  20: '#a78bfa', // violet
  30: '#ec4899', // pink
  40: '#eab308', // yellow
  50: 'rgb(var(--info))',
  100: '#14b8a6', // teal
  200: 'rgb(var(--accent))',
};
const MACD_COLOR = 'rgb(var(--info))';
const SIGNAL_COLOR = 'rgb(var(--accent))';
const RSI_COLOR = '#a78bfa';

// ---------------------------------------------------------------- preferences

interface Prefs {
  sma: number[];
  ema: number[];
  cross: { on: boolean; period: number };
  macd: boolean;
  rsi: { on: boolean; period: number };
}
const DEFAULT_PREFS: Prefs = { sma: [50, 200], ema: [], cross: { on: false, period: 50 }, macd: false, rsi: { on: false, period: 14 } };
const PREFS_KEY = 'nd-chart-indicators';

function sanitizePrefs(raw: unknown): Prefs {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Prefs>;
  const periods = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => (PERIODS as readonly number[]).includes(n as number)) : []);
  const pick = (v: unknown, allowed: readonly number[], d: number) => (allowed.includes(v as number) ? (v as number) : d);
  return {
    sma: Array.isArray(p.sma) ? periods(p.sma) : DEFAULT_PREFS.sma,
    ema: periods(p.ema),
    cross: { on: !!p.cross?.on, period: pick(p.cross?.period, PERIODS, 50) },
    macd: !!p.macd,
    rsi: { on: !!p.rsi?.on, period: pick(p.rsi?.period, RSI_PERIODS, 14) },
  };
}

/** Defaults on first render (SSR-safe), stored prefs after mount; only user changes are written back. */
function usePrefs() {
  const [prefs, setState] = React.useState<Prefs>(DEFAULT_PREFS);
  React.useEffect(() => {
    try {
      const s = window.localStorage.getItem(PREFS_KEY);
      if (s) setState(sanitizePrefs(JSON.parse(s)));
    } catch { /* storage unavailable — keep defaults */ }
  }, []);
  const setPrefs = React.useCallback((next: Prefs | ((p: Prefs) => Prefs)) => {
    setState((p) => {
      const n = typeof next === 'function' ? next(p) : next;
      try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(n)); } catch { /* ignore */ }
      return n;
    });
  }, []);
  return [prefs, setPrefs] as const;
}

// ---------------------------------------------------------------- data

const histKey = (range: ChartRange, maxPoints?: number) => `${range}|${maxPoints ?? ''}`;

/** Fetches /history for any (range, maxPoints) key and caches per key for the component's lifetime. */
function useHistoryCache(ticker: string, initial: { range: ChartRange; bars: Bar[] }) {
  const [cache, setCache] = React.useState<Record<string, Bar[]>>({ [histKey(initial.range)]: initial.bars });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const inflight = React.useRef(new Set<string>());
  const request = React.useCallback((range: ChartRange, maxPoints?: number) => {
    const key = histKey(range, maxPoints);
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    const qs = new URLSearchParams({ range });
    if (maxPoints) qs.set('maxPoints', String(maxPoints));
    fetch(`/api/company/${encodeURIComponent(ticker)}/history?${qs}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? `HTTP ${r.status}`);
        return r.json() as Promise<{ bars: Bar[] }>;
      })
      .then((j) => setCache((c) => ({ ...c, [key]: j.bars ?? [] })))
      .catch((e: Error) => setErrors((s) => ({ ...s, [key]: e.message })));
  }, [ticker]);
  return { cache, errors, request };
}

// ---------------------------------------------------------------- formatting

const isIntradayStamp = (d: string) => d.length > 10;
const NY = 'America/New_York';

function tickFormatter(range: ChartRange, spanDays: number) {
  return (d: string) => {
    if (!d) return '';
    if (range === '1D') return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: NY });
    if (range === '1W') {
      const dt = new Date(d);
      const wd = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: NY });
      const hr = dt.toLocaleTimeString('en-US', { hour: 'numeric', timeZone: NY }).replace(' ', '').toLowerCase();
      return `${wd} ${hr}`;
    }
    if ((range === '5Y' || range === 'MAX') && spanDays > 3 * 365) return d.slice(0, 4);
    if (spanDays > 400) return new Date(d).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
}

function fmtStamp(d: string) {
  if (isIntradayStamp(d)) {
    return `${new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: NY })} ET`;
  }
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------- series model

interface LineSeries { key: string; label: string; color: string; dashed: boolean; period: number; kind: 'sma' | 'ema' }
type Point = Bar & { hl: [number, number]; [k: string]: unknown };
interface CrossMark { date: string; y: number; dir: 'up' | 'down'; srcDate: string }

const fmtVal = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? fmt.price(v) : '—');
const lastDefined = (data: Point[], key: string): number | null => {
  for (let i = data.length - 1; i >= 0; i--) { const v = data[i][key]; if (typeof v === 'number') return v; }
  return null;
};

/** First index in sorted `dates` whose value is >= d (binary search). */
function lowerBound(dates: string[], d: string) {
  let lo = 0, hi = dates.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; }
  return lo;
}

// ---------------------------------------------------------------- candles

interface CandleProps { x?: number; y?: number; width?: number; height?: number; payload?: Point }
function Candle({ x = 0, y = 0, width = 0, height = 0, payload }: CandleProps) {
  if (!payload) return null;
  const { open, close, high, low } = payload;
  const upBar = close >= open;
  const color = upBar ? 'rgb(var(--up))' : 'rgb(var(--down))';
  const span = high - low;
  const toY = (v: number) => (span > 0 ? y + ((high - v) / span) * height : y);
  const top = toY(Math.max(open, close));
  const bot = toY(Math.min(open, close));
  const cx = x + width / 2;
  const bw = Math.max(1, Math.min(width * 0.8, 12));
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} fill={color} fillOpacity={upBar ? 0.35 : 0.9} stroke={color} strokeWidth={bw > 2 ? 1 : 0} />
    </g>
  );
}

// ---------------------------------------------------------------- tooltips

function ChartTooltip({ active, payload, lines, cross }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Point }>; lines: LineSeries[]; cross?: { smaKey: string; emaKey: string; period: number } }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="min-w-[180px] rounded-md border border-border bg-panel-2 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium">{fmtStamp(p.date)}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono tabular-nums">
        <dt className="text-muted">O</dt><dd className="text-right">{fmt.price(p.open)}</dd>
        <dt className="text-muted">H</dt><dd className="text-right">{fmt.price(p.high)}</dd>
        <dt className="text-muted">L</dt><dd className="text-right">{fmt.price(p.low)}</dd>
        <dt className="text-muted">C</dt><dd className="text-right font-semibold">{fmt.price(p.close)}</dd>
        <dt className="text-muted">V</dt><dd className="text-right">{fmt.num(p.volume)}</dd>
      </dl>
      {lines.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-border pt-1.5 font-mono tabular-nums">
          {lines.map((l) => (
            <React.Fragment key={l.key}>
              <dt className="flex items-center gap-1.5 text-muted"><Swatch color={l.color} dashed={l.dashed} />{l.label}</dt>
              <dd className="text-right">{fmtVal(p[l.key])}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {cross && typeof p[cross.smaKey] === 'number' && typeof p[cross.emaKey] === 'number' && (
        <div className="mt-1 text-[11px] text-muted">
          EMA {cross.period} {(p[cross.emaKey] as number) >= (p[cross.smaKey] as number) ? 'above' : 'below'} SMA {cross.period}
        </div>
      )}
    </div>
  );
}

function PaneTooltip({ active, payload, rows }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Point }>; rows: { key: string; label: string; dp?: number }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-md border border-border bg-panel-2 px-2 py-1 font-mono text-[11px] tabular-nums shadow-xl">
      {rows.map((r) => (
        <span key={r.key} className="mr-2 last:mr-0"><span className="text-muted">{r.label}</span> {typeof p[r.key] === 'number' ? (p[r.key] as number).toFixed(r.dp ?? 2) : '—'}</span>
      ))}
    </div>
  );
}

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="14" height="6" aria-hidden className="shrink-0">
      <line x1="0" y1="3" x2="14" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '3 2' : undefined} />
    </svg>
  );
}

// ---------------------------------------------------------------- toolbar bits

const btnBase = 'inline-flex items-center gap-1 rounded px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info';
const toggleCls = (on: boolean) => cn(btnBase, 'border', on ? 'border-info/60 bg-info/15 text-text' : 'border-border bg-panel-2 text-muted hover:text-text');
const popCls = 'z-50 min-w-[168px] rounded-md border border-border bg-panel-2 p-2 text-xs shadow-xl focus-visible:outline-none';

function PeriodChecklist({ label, selected, onChange, dashed }: { label: string; selected: number[]; onChange: (next: number[]) => void; dashed?: boolean }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{label} periods</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {PERIODS.map((n) => {
          const on = selected.includes(n);
          return (
            <label key={n} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-border/50">
              <input type="checkbox" className="accent-[rgb(var(--info))]" checked={on}
                onChange={() => onChange(on ? selected.filter((x) => x !== n) : [...selected, n].sort((a, b) => a - b))} />
              <Swatch color={PERIOD_COLOR[n]} dashed={dashed} />
              <span className="font-mono tabular-nums">{n}</span>
            </label>
          );
        })}
      </div>
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="mt-2 text-[11px] text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">Clear all</button>
      )}
    </fieldset>
  );
}

function RadioPeriods({ name, label, options, value, onChange }: { name: string; label: string; options: readonly number[]; value: number; onChange: (n: number) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{label}</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {options.map((n) => (
          <label key={n} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-border/50">
            <input type="radio" name={name} className="accent-[rgb(var(--info))]" checked={value === n} onChange={() => onChange(n)} />
            <span className="font-mono tabular-nums">{n}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Toggle button (aria-pressed) + adjoining chevron that opens a period popover. */
function SplitToggle({ label, on, onToggle, popLabel, children }: { label: React.ReactNode; on: boolean; onToggle: () => void; popLabel: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex">
      <button type="button" aria-pressed={on} onClick={onToggle} className={cn(toggleCls(on), 'rounded-r-none')}>{label}</button>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" aria-label={popLabel} className={cn(toggleCls(on), '-ml-px rounded-l-none px-1')}><ChevronDown className="h-3 w-3" aria-hidden /></button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content sideOffset={6} align="start" className={popCls}>{children}</Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}

// ---------------------------------------------------------------- main

export function PriceChart({ ticker, initialBars }: { ticker: string; initialBars: Bar[] }) {
  const [range, setRange] = React.useState<ChartRange>('1Y');
  const [mode, setMode] = React.useState<'area' | 'line' | 'candle'>('area');
  const [prefs, setPrefs] = usePrefs();
  const { cache, errors, request } = useHistoryCache(ticker, { range: '1Y', bars: initialBars });

  const intraday = INTRADAY.has(range);
  const anyIndicator = prefs.sma.length > 0 || prefs.ema.length > 0 || prefs.cross.on || prefs.macd || prefs.rsi.on;
  // Daily ranges: compute indicators on a long full-resolution daily series, then show only the visible window.
  const baseRange: ChartRange | null = intraday || !anyIndicator ? null : range === '5Y' || range === 'MAX' ? 'MAX' : '5Y';
  const viewKey = histKey(range);
  const baseKey = baseRange ? histKey(baseRange, 10000) : null;

  React.useEffect(() => { if (!cache[viewKey] && !errors[viewKey]) request(range); }, [cache, errors, viewKey, range, request]);
  React.useEffect(() => { if (baseRange && baseKey && !cache[baseKey] && !errors[baseKey]) request(baseRange, 10000); }, [cache, errors, baseKey, baseRange, request]);

  const bars = cache[viewKey];
  const error = errors[viewKey];
  const baseBars = baseKey ? cache[baseKey] : undefined;
  const baseLoading = !!baseKey && !baseBars && !errors[baseKey];

  // Series the user asked for (SMA×EMA adds its pair, deduped).
  const lines = React.useMemo<LineSeries[]>(() => {
    const out: LineSeries[] = [];
    const seen = new Set<string>();
    const add = (kind: 'sma' | 'ema', n: number) => {
      const key = `${kind}${n}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, kind, period: n, label: `${kind.toUpperCase()} ${n}`, color: PERIOD_COLOR[n] ?? 'rgb(var(--muted))', dashed: kind === 'ema' });
    };
    prefs.sma.forEach((n) => add('sma', n));
    prefs.ema.forEach((n) => add('ema', n));
    if (prefs.cross.on) { add('sma', prefs.cross.period); add('ema', prefs.cross.period); }
    return out;
  }, [prefs]);

  const model = React.useMemo(() => {
    const view = bars ?? [];
    // Computation series: long daily base when available (and it covers the view), else the visible bars themselves.
    const comp = !intraday && baseBars && baseBars.length >= view.length ? baseBars : view;
    const closes = comp.map((b) => b.close);
    const idx = new Map<string, number>();
    comp.forEach((b, i) => idx.set(b.date, i));
    const computed: Record<string, Out> = {};
    for (const l of lines) computed[l.key] = l.kind === 'sma' ? sma(closes, l.period) : ema(closes, l.period);
    if (prefs.macd) { const m = macd(closes, 12, 26, 9); computed.macd = m.macd; computed.macdSignal = m.signal; computed.macdHist = m.hist; }
    if (prefs.rsi.on) computed.rsi = rsi(closes, prefs.rsi.period);

    const keys = Object.keys(computed);
    const data: Point[] = view.map((b) => {
      const p: Point = { ...b, hl: [b.low, b.high] };
      const i = idx.get(b.date);
      for (const k of keys) p[k] = i == null ? null : computed[k][i];
      return p;
    });

    // Crossover marks, snapped onto displayed points (the view may be downsampled).
    const marks: CrossMark[] = [];
    let lastCross: { date: string; dir: 'up' | 'down' } | null = null;
    if (prefs.cross.on && data.length) {
      const sk = `sma${prefs.cross.period}`;
      const ek = `ema${prefs.cross.period}`;
      const viewDates = data.map((d) => d.date);
      const first = viewDates[0];
      const last = viewDates[viewDates.length - 1];
      for (const c of crossovers(computed[ek], computed[sk])) {
        const d = comp[c.index].date;
        if (d < first || d > last) continue;
        const j = Math.min(lowerBound(viewDates, d), data.length - 1);
        const y = data[j][ek];
        if (typeof y !== 'number') continue;
        marks.push({ date: data[j].date, y, dir: c.dir, srcDate: d });
        lastCross = { date: d, dir: c.dir };
      }
    }

    const lows = view.map((x) => x.low).filter((v) => v > 0);
    const highs = view.map((x) => x.high);
    const lo = lows.length ? Math.min(...lows) : 0;
    const hi = highs.length ? Math.max(...highs) : 1;
    const pad = (hi - lo) * 0.06 || hi * 0.02;
    const has = (k: string) => data.some((p) => typeof p[k] === 'number');
    return {
      data, marks, lastCross, has,
      domain: [Math.max(0, lo - pad * 1.5), hi + pad] as [number, number],
      maxVol: Math.max(1, ...view.map((x) => x.volume)),
      compLen: comp.length,
    };
  }, [bars, baseBars, intraday, lines, prefs.macd, prefs.rsi.on, prefs.rsi.period, prefs.cross.on, prefs.cross.period]);

  const { data } = model;
  const drawnLines = lines.filter((l) => model.has(l.key));
  const shortLines = baseLoading ? [] : lines.filter((l) => !model.has(l.key));
  const macdReady = prefs.macd && model.has('macd');
  const rsiReady = prefs.rsi.on && model.has('rsi');

  const first = data[0]?.close;
  const last = data[data.length - 1]?.close;
  const periodChange = first && last ? ((last - first) / first) * 100 : null;
  const up = (periodChange ?? 0) >= 0;
  const stroke = up ? 'rgb(var(--up))' : 'rgb(var(--down))';
  const spanDays = data.length > 1 ? (Date.parse(data[data.length - 1].date) - Date.parse(data[0].date)) / 864e5 : 0;
  const fmtTick = React.useMemo(() => tickFormatter(range, spanDays), [range, spanDays]);
  const syncId = `px-${ticker}`;
  const crossCfg = prefs.cross.on ? { smaKey: `sma${prefs.cross.period}`, emaKey: `ema${prefs.cross.period}`, period: prefs.cross.period } : undefined;

  const set = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const removeLine = (l: LineSeries) => {
    const inList = (l.kind === 'sma' ? prefs.sma : prefs.ema).includes(l.period);
    if (!inList && prefs.cross.on && l.period === prefs.cross.period) { set({ cross: { ...prefs.cross, on: false } }); return; }
    set(l.kind === 'sma' ? { sma: prefs.sma.filter((n) => n !== l.period) } : { ema: prefs.ema.filter((n) => n !== l.period) });
  };

  const showChart = !!bars && !error && data.length >= 2;

  return (
    <div>
      {/* Row 1: range, chart type, period change */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Chart range" className="inline-flex flex-wrap rounded-md border border-border bg-panel-2 p-0.5">
          {RANGES.map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r}
              className={cn('rounded px-2.5 py-1 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', range === r ? 'bg-accent text-accent-foreground' : 'text-muted hover:text-text')}>
              {r}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Chart type" className="inline-flex rounded-md border border-border bg-panel-2 p-0.5">
          {(['area', 'line', 'candle'] as const).map((m) => {
            const Icon = m === 'area' ? AreaIcon : m === 'line' ? LineIcon : CandlestickChart;
            return (
              <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} aria-label={m === 'candle' ? 'Candlestick chart' : `${m} chart`} title={m === 'candle' ? 'Candlestick' : m === 'area' ? 'Area' : 'Line'}
                className={cn('rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', mode === m ? 'bg-border text-text' : 'text-muted hover:text-text')}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </button>
            );
          })}
        </div>
        {periodChange != null && showChart && (
          <span className="text-xs text-muted">
            {range} change <Delta value={periodChange} className="text-xs" />
          </span>
        )}
      </div>

      {/* Row 2: indicator toolbar */}
      <div role="toolbar" aria-label="Indicators" className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">Indicators</span>
        {(['sma', 'ema'] as const).map((kind) => {
          const sel = prefs[kind];
          return (
            <Popover.Root key={kind}>
              <Popover.Trigger asChild>
                <button type="button" className={toggleCls(sel.length > 0)} aria-label={`${kind.toUpperCase()} periods${sel.length ? ` (${sel.join(', ')} selected)` : ''}`}>
                  {kind.toUpperCase()}
                  {sel.length > 0 && <span className="rounded bg-info/25 px-1 font-mono text-[10px] tabular-nums">{sel.length}</span>}
                  <ChevronDown className="h-3 w-3" aria-hidden />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content sideOffset={6} align="start" className={popCls}>
                  <PeriodChecklist label={kind.toUpperCase()} selected={sel} dashed={kind === 'ema'} onChange={(next) => set(kind === 'sma' ? { sma: next } : { ema: next })} />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          );
        })}
        <SplitToggle label={<>SMA × EMA{prefs.cross.on && <span className="font-mono text-[10px] text-muted">{prefs.cross.period}</span>}</>}
          on={prefs.cross.on} onToggle={() => set({ cross: { ...prefs.cross, on: !prefs.cross.on } })} popLabel="SMA × EMA crossover period">
          <RadioPeriods name={`cross-${ticker}`} label="Crossover period" options={PERIODS} value={prefs.cross.period} onChange={(n) => set({ cross: { on: true, period: n } })} />
        </SplitToggle>
        <button type="button" aria-pressed={prefs.macd} onClick={() => set({ macd: !prefs.macd })} className={toggleCls(prefs.macd)} title="MACD 12, 26, 9">MACD</button>
        <SplitToggle label={<>RSI{prefs.rsi.on && <span className="font-mono text-[10px] text-muted">{prefs.rsi.period}</span>}</>}
          on={prefs.rsi.on} onToggle={() => set({ rsi: { ...prefs.rsi, on: !prefs.rsi.on } })} popLabel="RSI period">
          <RadioPeriods name={`rsi-${ticker}`} label="RSI period" options={RSI_PERIODS} value={prefs.rsi.period} onChange={(n) => set({ rsi: { on: true, period: n } })} />
        </SplitToggle>
        {anyIndicator && (
          <button type="button" onClick={() => setPrefs({ ...DEFAULT_PREFS, sma: [] })} className="ml-1 rounded px-1 text-[11px] text-muted hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">Clear</button>
        )}
      </div>

      {/* Legend chips */}
      {(lines.length > 0 || baseLoading) && showChart && (
        <ul className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Active indicators">
          {drawnLines.map((l) => (
            <li key={l.key} className="inline-flex items-center gap-1.5 rounded border border-border bg-panel-2 py-0.5 pl-1.5 pr-0.5 text-[11px]">
              <Swatch color={l.color} dashed={l.dashed} />
              <span>{l.label}</span>
              <span className="font-mono tabular-nums text-muted">· {fmtVal(lastDefined(data, l.key))}</span>
              <button type="button" onClick={() => removeLine(l)} aria-label={`Remove ${l.label}`} className="rounded p-0.5 text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
          {prefs.cross.on && !baseLoading && model.has(`sma${prefs.cross.period}`) && model.has(`ema${prefs.cross.period}`) && (
            <li className="inline-flex items-center gap-1 rounded border border-border bg-panel-2 px-1.5 py-0.5 text-[11px]">
              <span className="font-medium">SMA × EMA {prefs.cross.period}</span>
              {model.lastCross ? (
                <span className={model.lastCross.dir === 'up' ? 'text-up' : 'text-down'}>
                  · last {model.lastCross.dir === 'up' ? '▲ EMA crossed above' : '▼ EMA crossed below'} SMA · {fmtStamp(model.lastCross.date)}
                </span>
              ) : (
                <span className="text-muted">· no cross in range</span>
              )}
            </li>
          )}
          {baseLoading && <li className="text-[11px] text-muted">Computing indicators…</li>}
          {shortLines.map((l) => (
            <li key={l.key} className="inline-flex items-center gap-1 rounded border border-dashed border-warn/50 px-1.5 py-0.5 text-[11px] text-warn">
              {l.label} needs more bars ({model.compLen} available)
              <button type="button" onClick={() => removeLine(l)} aria-label={`Remove ${l.label}`} className="rounded p-0.5 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"><X className="h-3 w-3" aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative h-[300px]">
        {!bars && !error ? (
          <Skeleton className="h-full w-full" />
        ) : error ? (
          <EmptyState title="Couldn't load price history" description={`${error}. Try another range.`} className="h-full" />
        ) : data.length < 2 ? (
          <EmptyState icon={CalendarClock} title="No price history for this range" description="The data provider returned no bars. Try a longer range such as 1Y or 5Y." className="h-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} syncId={syncId} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`fill-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'rgb(var(--border))' }} minTickGap={48} tickFormatter={fmtTick} />
              <XAxis xAxisId="candle" dataKey="date" hide />
              <YAxis yAxisId="price" orientation="right" domain={model.domain} tick={{ fill: 'rgb(var(--muted))', fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmt.price(v)} />
              <YAxis yAxisId="vol" hide domain={[0, model.maxVol * 4]} />
              <Tooltip content={(p) => <ChartTooltip active={p.active} payload={p.payload as ReadonlyArray<{ payload?: Point }>} lines={drawnLines} cross={crossCfg} />} cursor={{ stroke: 'rgb(var(--muted))', strokeDasharray: '3 3' }} isAnimationActive={false} />
              <RBar yAxisId="vol" dataKey="volume" fill="rgb(var(--muted))" opacity={0.25} isAnimationActive={false} />
              {mode === 'area' && (
                <Area yAxisId="price" type="monotone" dataKey="close" stroke={stroke} strokeWidth={1.6} fill={`url(#fill-${ticker})`} isAnimationActive={false} dot={false} activeDot={{ r: 3 }} />
              )}
              {mode === 'line' && (
                <Line yAxisId="price" type="monotone" dataKey="close" stroke={stroke} strokeWidth={1.6} isAnimationActive={false} dot={false} activeDot={{ r: 3 }} />
              )}
              {mode === 'candle' && (
                <RBar xAxisId="candle" yAxisId="price" dataKey="hl" isAnimationActive={false} shape={(p: unknown) => <Candle {...(p as CandleProps)} />} />
              )}
              {drawnLines.map((l) => (
                <Line key={l.key} yAxisId="price" type="linear" dataKey={l.key} stroke={l.color} strokeWidth={1.3} strokeDasharray={l.dashed ? '5 3' : undefined}
                  dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} name={l.label} />
              ))}
              {model.marks.map((m) => (
                <ReferenceDot key={`${m.srcDate}-${m.dir}`} yAxisId="price" x={m.date} y={m.y} ifOverflow="hidden"
                  shape={(p: { cx?: number; cy?: number }) => {
                    const cx = p.cx ?? 0;
                    const cy = p.cy ?? 0;
                    const upMark = m.dir === 'up';
                    const ty = upMark ? cy + 9 : cy - 9; // ▲ below the line, ▼ above it
                    const path = upMark ? `M${cx},${ty - 5} L${cx + 5},${ty + 4} L${cx - 5},${ty + 4} Z` : `M${cx},${ty + 5} L${cx + 5},${ty - 4} L${cx - 5},${ty - 4} Z`;
                    return (
                      <path d={path} fill={upMark ? 'rgb(var(--up))' : 'rgb(var(--down))'} stroke="rgb(var(--panel))" strokeWidth={1}>
                        <title>{`EMA ${prefs.cross.period} crossed ${upMark ? 'above' : 'below'} SMA ${prefs.cross.period} · ${fmtStamp(m.srcDate)}`}</title>
                      </path>
                    );
                  }} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {showChart && prefs.macd && (
        <SubPane name="MACD" title={<>MACD <span className="font-mono text-muted">12, 26, 9</span></>}
          summary={macdReady ? <>
            <span className="inline-flex items-center gap-1"><Swatch color={MACD_COLOR} />MACD <span className="font-mono tabular-nums text-text">{lastDefined(data, 'macd')?.toFixed(2) ?? '—'}</span></span>
            <span className="inline-flex items-center gap-1"><Swatch color={SIGNAL_COLOR} dashed />Signal <span className="font-mono tabular-nums text-text">{lastDefined(data, 'macdSignal')?.toFixed(2) ?? '—'}</span></span>
            <span>Hist <span className="font-mono tabular-nums text-text">{lastDefined(data, 'macdHist')?.toFixed(2) ?? '—'}</span></span>
          </> : null}
          onClose={() => set({ macd: false })}
          empty={baseLoading ? 'Computing…' : !macdReady ? `MACD needs at least 34 bars (${model.compLen} available)` : null}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} syncId={syncId} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis orientation="right" width={56} tick={{ fill: 'rgb(var(--muted))', fontSize: 10, fontFamily: 'var(--font-mono, monospace)' }} tickLine={false} axisLine={false} tickCount={3} tickFormatter={(v: number) => v.toFixed(1)} />
              <ReferenceLine y={0} stroke="rgb(var(--border))" />
              <Tooltip content={(p) => <PaneTooltip active={p.active} payload={p.payload as ReadonlyArray<{ payload?: Point }>} rows={[{ key: 'macd', label: 'MACD' }, { key: 'macdSignal', label: 'Sig' }, { key: 'macdHist', label: 'Hist' }]} />} cursor={{ stroke: 'rgb(var(--muted))', strokeDasharray: '3 3' }} isAnimationActive={false} />
              <RBar dataKey="macdHist" isAnimationActive={false}>
                {data.map((p) => <Cell key={p.date} fill={(p.macdHist as number) >= 0 ? 'rgb(var(--up))' : 'rgb(var(--down))'} fillOpacity={0.55} />)}
              </RBar>
              <Line type="linear" dataKey="macd" stroke={MACD_COLOR} strokeWidth={1.2} dot={false} activeDot={false} isAnimationActive={false} />
              <Line type="linear" dataKey="macdSignal" stroke={SIGNAL_COLOR} strokeWidth={1.2} strokeDasharray="4 2" dot={false} activeDot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </SubPane>
      )}

      {showChart && prefs.rsi.on && (
        <SubPane name="RSI" title={<>RSI <span className="font-mono text-muted">{prefs.rsi.period}</span></>}
          summary={rsiReady ? <RsiSummary value={lastDefined(data, 'rsi')} /> : null}
          onClose={() => set({ rsi: { ...prefs.rsi, on: false } })}
          empty={baseLoading ? 'Computing…' : !rsiReady ? `RSI ${prefs.rsi.period} needs at least ${prefs.rsi.period + 1} bars (${model.compLen} available)` : null}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} syncId={syncId} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis orientation="right" width={56} domain={[0, 100]} ticks={[30, 70]} tick={{ fill: 'rgb(var(--muted))', fontSize: 10, fontFamily: 'var(--font-mono, monospace)' }} tickLine={false} axisLine={false} />
              <ReferenceLine y={70} stroke="rgb(var(--down))" strokeOpacity={0.6} strokeDasharray="3 3" />
              <ReferenceLine y={30} stroke="rgb(var(--up))" strokeOpacity={0.6} strokeDasharray="3 3" />
              <Tooltip content={(p) => <PaneTooltip active={p.active} payload={p.payload as ReadonlyArray<{ payload?: Point }>} rows={[{ key: 'rsi', label: `RSI ${prefs.rsi.period}`, dp: 1 }]} />} cursor={{ stroke: 'rgb(var(--muted))', strokeDasharray: '3 3' }} isAnimationActive={false} />
              <Line type="linear" dataKey="rsi" stroke={RSI_COLOR} strokeWidth={1.3} dot={false} activeDot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </SubPane>
      )}
    </div>
  );
}

function RsiSummary({ value }: { value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Swatch color={RSI_COLOR} />
      <span className="font-mono tabular-nums text-text">{value?.toFixed(1) ?? '—'}</span>
      {value != null && value >= 70 ? <span>· above 70</span> : value != null && value <= 30 ? <span>· below 30</span> : null}
    </span>
  );
}

function SubPane({ name, title, summary, onClose, empty, children }: { name: string; title: React.ReactNode; summary: React.ReactNode; onClose: () => void; empty: string | null; children: React.ReactNode }) {
  return (
    <section className="mt-2 border-t border-border pt-1.5" aria-label={`${name} pane`}>
      <div className="mb-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
        <span className="font-medium text-text">{title}</span>
        {summary}
        <button type="button" onClick={onClose} aria-label={`Hide ${name}`} className="ml-auto rounded p-0.5 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"><X className="h-3 w-3" aria-hidden /></button>
      </div>
      <div className="relative h-[110px]">
        {empty ? <p className="flex h-full items-center justify-center text-xs text-muted">{empty}</p> : children}
      </div>
    </section>
  );
}
