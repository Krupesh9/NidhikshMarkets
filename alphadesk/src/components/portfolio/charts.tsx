'use client';
/** Recharts visualisations for portfolio + basket screens. Colours come from CSS tokens so light/dark both work. */
import * as React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ExposureBucket, HistogramBin } from '@/lib/analytics';
import { pct, usdCompact } from './format';

const C = {
  up: 'rgb(var(--up))', down: 'rgb(var(--down))', info: 'rgb(var(--info))', accent: 'rgb(var(--accent))', muted: 'rgb(var(--muted))',
  border: 'rgb(var(--border))', text: 'rgb(var(--text))', warn: 'rgb(var(--warn))',
};
const axis = { stroke: C.muted, fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = { contentStyle: { background: 'rgb(var(--panel))', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, color: C.text }, labelStyle: { color: C.muted }, itemStyle: { color: C.text }, cursor: { fill: 'rgb(var(--panel-2))' } };

/** Long/short exposure by bucket (horizontal diverging bars, % of NAV). */
export function ExposureBars({ buckets, nav, height }: { buckets: ExposureBucket[]; nav: number; height?: number }) {
  const data = buckets.slice(0, 12).map((b) => ({ key: b.key, long: nav ? b.long / nav : 0, short: nav ? -b.short / nav : 0, net: b.netWeight }));
  const h = height ?? Math.max(160, data.length * 28 + 40);
  return (
    <div style={{ height: h }} role="img" aria-label={`Exposure by bucket: ${data.map((d) => `${d.key} net ${pct(d.net)}`).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" stackOffset="sign" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={C.border} strokeDasharray="3 3" />
          <XAxis type="number" tickFormatter={(v) => pct(v, 0)} {...axis} />
          <YAxis type="category" dataKey="key" width={150} {...axis} tick={{ fill: C.text, fontSize: 11 }} />
          <Tooltip {...tooltipStyle} formatter={(v, n) => [pct(Number(v), 1), n === 'long' ? 'Long' : 'Short']} />
          <ReferenceLine x={0} stroke={C.muted} />
          <Bar dataKey="long" stackId="x" fill={C.up} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          <Bar dataKey="short" stackId="x" fill={C.down} radius={[3, 0, 0, 3]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Monte Carlo 1-day P&L distribution with VaR markers. */
export function VarHistogram({ bins, var95, var99 }: { bins: HistogramBin[]; var95: number; var99: number }) {
  const data = bins.map((b) => ({ mid: b.mid, count: b.count, tail: b.mid <= -var99 ? 2 : b.mid <= -var95 ? 1 : 0 }));
  return (
    <div className="h-56" role="img" aria-label={`Simulated one-day P&L distribution. 95% VaR ${usdCompact(var95)}, 99% VaR ${usdCompact(var99)}.`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} barCategoryGap={1}>
          <CartesianGrid vertical={false} stroke={C.border} strokeDasharray="3 3" />
          <XAxis dataKey="mid" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => usdCompact(v)} {...axis} />
          <YAxis {...axis} width={36} />
          <Tooltip {...tooltipStyle} labelFormatter={(v) => `P&L ≈ ${usdCompact(Number(v))}`} formatter={(v) => [String(v), 'Paths']} />
          <Bar dataKey="count" isAnimationActive={false}>
            {data.map((d, i) => <Cell key={i} fill={d.tail === 2 ? C.down : d.tail === 1 ? C.warn : C.info} fillOpacity={d.tail ? 0.9 : 0.55} />)}
          </Bar>
          <ReferenceLine x={-var95} stroke={C.warn} strokeDasharray="4 3" label={{ value: 'VaR 95', fill: C.warn, fontSize: 10, position: 'insideTopLeft' }} />
          <ReferenceLine x={-var99} stroke={C.down} strokeDasharray="4 3" label={{ value: 'VaR 99', fill: C.down, fontSize: 10, position: 'insideTopRight' }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cumulative return: portfolio vs benchmark. */
export function PerformanceChart({ series, benchmarkLabel, height = 220 }: { series: { date: string; portfolio: number; benchmark: number }[]; benchmarkLabel: string; height?: number }) {
  const step = Math.max(1, Math.floor(series.length / 120));
  const data = series.filter((_, i) => i % step === 0 || i === series.length - 1);
  return (
    <div style={{ height }} role="img" aria-label={`Cumulative return: portfolio ${pct(series.at(-1)?.portfolio)} vs ${benchmarkLabel} ${pct(series.at(-1)?.benchmark)}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={C.border} strokeDasharray="3 3" />
          <XAxis dataKey="date" {...axis} minTickGap={40} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis {...axis} width={44} tickFormatter={(v) => pct(v, 0)} />
          <Tooltip {...tooltipStyle} formatter={(v, n) => [pct(Number(v), 2, true), n === 'portfolio' ? 'Portfolio' : benchmarkLabel]} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === 'portfolio' ? 'Portfolio' : benchmarkLabel)} />
          <ReferenceLine y={0} stroke={C.muted} />
          <Line type="monotone" dataKey="portfolio" stroke={C.accent} dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="monotone" dataKey="benchmark" stroke={C.info} dot={false} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Brinson allocation / selection (+interaction) by sector. */
export function AttributionChart({ segments }: { segments: { sector: string; allocation: number; selection: number; interaction: number }[] }) {
  const data = segments.filter((s) => Math.abs(s.allocation) + Math.abs(s.selection) + Math.abs(s.interaction) > 1e-6);
  return (
    <div style={{ height: Math.max(180, data.length * 30 + 50) }} role="img" aria-label={`Attribution by sector: ${data.map((d) => `${d.sector} allocation ${pct(d.allocation, 2)}, selection ${pct(d.selection, 2)}`).join('; ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }} stackOffset="sign">
          <CartesianGrid horizontal={false} stroke={C.border} strokeDasharray="3 3" />
          <XAxis type="number" tickFormatter={(v) => pct(v, 1)} {...axis} />
          <YAxis type="category" dataKey="sector" width={150} {...axis} tick={{ fill: C.text, fontSize: 11 }} />
          <Tooltip {...tooltipStyle} formatter={(v, n) => [pct(Number(v), 2, true), String(n)]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine x={0} stroke={C.muted} />
          <Bar dataKey="allocation" name="Allocation" stackId="a" fill={C.info} isAnimationActive={false} />
          <Bar dataKey="selection" name="Selection" stackId="a" fill={C.accent} isAnimationActive={false} />
          <Bar dataKey="interaction" name="Interaction" stackId="a" fill={C.muted} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Basket NAV since rebalance. */
export function ValueLine({ data, height = 160 }: { data: { date: string; value: number }[]; height?: number }) {
  const up = (data.at(-1)?.value ?? 0) >= (data[0]?.value ?? 0);
  return (
    <div style={{ height }} role="img" aria-label={`Basket value from ${usdCompact(data[0]?.value)} to ${usdCompact(data.at(-1)?.value)}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={C.border} strokeDasharray="3 3" />
          <XAxis dataKey="date" {...axis} minTickGap={40} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis {...axis} width={56} domain={['auto', 'auto']} tickFormatter={(v) => usdCompact(v)} />
          <Tooltip {...tooltipStyle} formatter={(v) => [usdCompact(Number(v)), 'Value']} />
          <Line type="monotone" dataKey="value" stroke={up ? C.up : C.down} dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut-free compact share bars (current vs target) for basket drift. Pure HTML for crisp rendering + a11y. */
export function DriftBars({ rows, tolerance }: { rows: { ticker: string; targetWeight: number; currentWeight: number; drift: number; breach: boolean }[]; tolerance: number }) {
  const max = Math.max(0.01, ...rows.flatMap((r) => [r.targetWeight, r.currentWeight]));
  return (
    <ul className="space-y-2" aria-label="Current versus target weights">
      {rows.map((r) => (
        <li key={r.ticker} className="grid grid-cols-[56px_1fr_120px] items-center gap-3 text-xs">
          <span className="font-mono font-semibold">{r.ticker}</span>
          <div className="relative h-5 rounded bg-panel-2" aria-hidden>
            <div className="absolute inset-y-0 left-0 rounded bg-info/40" style={{ width: `${(r.currentWeight / max) * 100}%` }} />
            <div className="absolute inset-y-[-3px] w-0.5 bg-accent" style={{ left: `${(r.targetWeight / max) * 100}%` }} title="Target" />
            <div className="absolute inset-y-0 rounded bg-accent/15" style={{ left: `${(Math.max(0, r.targetWeight - tolerance) / max) * 100}%`, width: `${((Math.min(max, r.targetWeight + tolerance) - Math.max(0, r.targetWeight - tolerance)) / max) * 100}%` }} />
          </div>
          <span className="text-right font-mono tabular-nums">
            {pct(r.currentWeight)} <span className="text-muted">/ {pct(r.targetWeight)}</span>{' '}
            <span className={r.breach ? 'font-semibold text-warn' : r.drift >= 0 ? 'text-up' : 'text-down'}>{pct(r.drift, 1, true)}</span>
            <span className="sr-only">{r.breach ? ' outside tolerance band' : ' within band'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
