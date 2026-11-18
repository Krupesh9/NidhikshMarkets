'use client';
import * as React from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, Calculator } from 'lucide-react';
import type { EstimatePeriod, Estimates, SourceRef } from '@/lib/data/types';
import { Delta } from '@/components/ui/delta';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { compactUsd, pickNextEstimates, revisionChange, revisionCounts } from './lib/helpers';
import { MetricButton } from './MetricButton';
import { AnalystOverview } from './AnalystOverview';

const fmtMetric = (v: number, metric: EstimatePeriod['metric']) => (metric === 'eps' ? `$${v.toFixed(2)}` : compactUsd(v));

function estSource(base: SourceRef, p: EstimatePeriod, ticker: string): SourceRef {
  return {
    ...base,
    id: `${base.id}:${p.period}:${p.metric}`,
    excerpt: `${ticker} ${p.period} ${p.metric.toUpperCase()} consensus ${fmtMetric(p.consensus, p.metric)} (range ${fmtMetric(p.low, p.metric)} – ${fmtMetric(p.high, p.metric)}) from ${p.numAnalysts} analysts; ${p.change30dPct >= 0 ? '+' : ''}${p.change30dPct.toFixed(1)}% over 30 days, ${p.change90dPct >= 0 ? '+' : ''}${p.change90dPct.toFixed(1)}% over 90 days.`,
    locator: `${p.period} ${p.metric.toUpperCase()}`,
  };
}

function EstimateTile({ label, p, ticker, source }: { label: string; p: EstimatePeriod | null; ticker: string; source: SourceRef | null }) {
  return (
    <div className="rounded-md border border-border bg-panel-2/50 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}{p ? ` · ${p.period}` : ''}</div>
      {p ? (
        <>
          <div className="mt-1 flex items-baseline gap-2">
            {source ? (
              <MetricButton source={estSource(source, p, ticker)} highlight={fmtMetric(p.consensus, p.metric)} label={`${label} consensus`}>
                <span className="font-mono text-lg font-semibold tabular-nums">{fmtMetric(p.consensus, p.metric)}</span>
              </MetricButton>
            ) : <span className="font-mono text-lg font-semibold tabular-nums">{fmtMetric(p.consensus, p.metric)}</span>}
            <Delta value={p.change30dPct} className="text-xs" />
            <span className="text-[10px] text-muted">30d</span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">
            {fmtMetric(p.low, p.metric)} – {fmtMetric(p.high, p.metric)} · {p.numAnalysts} analysts
          </div>
        </>
      ) : (
        <div className="mt-1 text-xs text-muted">No quarterly consensus from the current provider.</div>
      )}
    </div>
  );
}

export function EstimatesPanel({ ticker, estimates, source, price = null }: { ticker: string; estimates: Estimates | null; source: SourceRef | null; price?: number | null }) {
  const [metric, setMetric] = React.useState<'eps' | 'revenue'>('eps');
  if (!estimates || !estimates.periods.length) {
    return <EmptyState icon={Calculator} title="No consensus estimates" description={`No provider returned analyst estimates for ${ticker}. Consensus coverage is limited for small caps and recent IPOs.`} />;
  }
  const eps = pickNextEstimates(estimates.periods, 'eps');
  const rev = pickNextEstimates(estimates.periods, 'revenue');
  const sel = (metric === 'eps' ? eps.fy : rev.fy) ?? null;
  const revs = sel?.revisions ?? [];
  const windows = [30, 60, 90].map((d) => ({ d, chg: revisionChange(revs, d), counts: revisionCounts(revs, d) }));

  return (
    <div className="space-y-6">
    <AnalystOverview ticker={ticker} estimates={estimates} price={price} />
    <h3 className="eyebrow">Consensus estimates</h3>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <EstimateTile label="Next FY EPS" p={eps.fy} ticker={ticker} source={source} />
          <EstimateTile label="Next FY revenue" p={rev.fy} ticker={ticker} source={source} />
          <EstimateTile label="Next Q EPS" p={eps.q} ticker={ticker} source={source} />
          <EstimateTile label="Next Q revenue" p={rev.q} ticker={ticker} source={source} />
        </div>
      </div>

      <div className="rounded-md border border-border p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium">Consensus revision history{sel ? ` · ${sel.period}` : ''}</span>
          <div role="group" aria-label="Revision metric" className="inline-flex rounded-md border border-border bg-panel-2 p-0.5">
            {(['eps', 'revenue'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMetric(m)} aria-pressed={metric === m}
                className={cn('rounded px-2 py-0.5 text-[11px] uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', metric === m ? 'bg-accent text-accent-foreground' : 'text-muted hover:text-text')}>
                {m === 'eps' ? 'EPS' : 'Revenue'}
              </button>
            ))}
          </div>
        </div>
        {revs.length < 2 ? (
          <p className="py-10 text-center text-xs text-muted">Not enough revision history to chart.</p>
        ) : (
          <div className="h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revs} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'rgb(var(--muted))', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={30} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis domain={['auto', 'auto']} tick={{ fill: 'rgb(var(--muted))', fontSize: 10 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmtMetric(v, metric)} />
                <Tooltip isAnimationActive={false} contentStyle={{ background: 'rgb(var(--panel-2))', border: '1px solid rgb(var(--border))', borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: 'rgb(var(--muted))' }} formatter={(v) => [fmtMetric(Number(v), metric), 'Consensus']} />
                <Line type="stepAfter" dataKey="value" stroke="rgb(var(--info))" strokeWidth={1.8} dot={{ r: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <table className="mt-2 w-full text-xs">
          <caption className="sr-only">Consensus revisions over 30, 60 and 90 days</caption>
          <thead>
            <tr className="text-muted"><th scope="col" className="py-1 text-left font-medium">Window</th><th scope="col" className="text-right font-medium">Change</th><th scope="col" className="text-right font-medium">Up</th><th scope="col" className="text-right font-medium">Down</th></tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {windows.map((w) => (
              <tr key={w.d} className="border-t border-border">
                <td className="py-1">{w.d}d</td>
                <td className="text-right"><Delta value={w.chg} className="justify-end text-xs" /></td>
                <td className="text-right text-up"><ArrowUp className="mr-0.5 inline h-3 w-3" aria-hidden />{w.counts.up}</td>
                <td className="text-right text-down"><ArrowDown className="mr-0.5 inline h-3 w-3" aria-hidden />{w.counts.down}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-muted">Up/Down = weekly consensus snapshots that moved higher/lower within the window.</p>
      </div>
    </div>
    </div>
  );
}
