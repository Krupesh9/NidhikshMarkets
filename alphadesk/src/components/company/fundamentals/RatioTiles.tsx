'use client';
import * as React from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PEG_BAND_TEXT } from '@/lib/fundamentals/formulas';
import type { DeModel, PbModel, PegModel, RatioPoint } from '@/lib/fundamentals/types';
import { MetricButton, useOpenSource } from '@/components/company/MetricButton';
import { cn } from '@/lib/utils';
import { AXIS_TICK, TOOLTIP_STYLE, fmtBig, fmtUsd, fmtX } from './format';

function Tile({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-border bg-panel-2/40 p-5">
      <h3 className="eyebrow">{title}</h3>
      <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </div>
  );
}

function RatioHistory({ points, name }: { points: RatioPoint[]; name: string }) {
  const open = useOpenSource();
  const data = points.map((p) => ({ ...p, v: p.value }));
  if (data.filter((d) => d.v != null).length < 2) return <p className="mt-3 text-[11px] text-muted">Not enough history for a 5-year chart.</p>;
  return (
    <figure className="mt-3">
      <figcaption className="mb-1 text-[11px] text-muted">{name}, fiscal year-ends{points.some((p) => p.label === 'Now') ? ' + now' : ''} — click a point for its filing</figcaption>
      <div className="h-24 w-full" role="img" aria-label={`${name} history: ${points.map((p) => `${p.label} ${p.value != null ? p.value.toFixed(2) : p.negativeEquity ? 'negative equity' : 'n/a'}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} tickFormatter={(l: string) => (l.startsWith('FY') ? `’${l.slice(-2)}` : l)} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(v >= 10 ? 0 : 1)} />
            <Tooltip isAnimationActive={false} contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'rgb(var(--muted))' }}
              formatter={(v, _n, item) => [`${fmtX(Number(v))} — ${(item?.payload as RatioPoint | undefined)?.detail ?? ''}`, name]} />
            <Line type="monotone" dataKey="v" stroke="rgb(var(--info))" strokeWidth={2} connectNulls={false} isAnimationActive={false}
              dot={{ r: 3.5, fill: 'rgb(var(--info))', stroke: 'rgb(var(--panel))', strokeWidth: 2 }}
              activeDot={{ r: 5, cursor: 'pointer', onClick: (_e: unknown, p: unknown) => { const pt = (p as { payload?: RatioPoint }).payload; if (pt) open(pt.source, { heading: <span>{name} {pt.label}: {pt.value != null ? fmtX(pt.value) : 'n/a'} — {pt.detail}</span> }); } }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function PegScale({ value }: { value: number }) {
  const max = 3;
  const left = (Math.min(value, max) / max) * 100;
  return (
    <div className="mt-3 space-y-1">
      <div className="relative flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`PEG ${value.toFixed(2)} on a 0 to 3 scale`}>
        <div className="h-full bg-info/30" style={{ width: '33.333%' }} />
        <div className="h-full bg-muted/30" style={{ width: '33.333%' }} />
        <div className="h-full bg-accent/30" style={{ width: '33.333%' }} />
      </div>
      <div className="relative h-0">
        <div className="absolute -top-[13px] h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-panel bg-text shadow" style={{ left: `${left}%` }} aria-hidden />
      </div>
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted"><span>0</span><span>1</span><span>2</span><span>3+</span></div>
    </div>
  );
}

export function PegTile({ model }: { model: PegModel }) {
  return (
    <Tile title="PEG ratio" subtitle="P/E (TTM) ÷ expected EPS growth">
      {model.value != null ? (
        <>
          <MetricButton source={model.source} label="PEG ratio" className="self-start font-mono text-3xl font-semibold tabular-nums">{model.value.toFixed(2)}</MetricButton>
          <div className="mt-1 font-mono text-[11px] tabular-nums text-muted">
            P/E {fmtX(model.pe, 1)} ÷ growth {model.growth?.toFixed(1)}%
          </div>
          <PegScale value={model.value} />
          <p className="mt-3 text-xs leading-relaxed">{model.band ? PEG_BAND_TEXT[model.band] : ''}</p>
          <p className="mt-auto pt-3 text-[11px] text-muted">Growth: {model.growthBasis === 'consensus' ? 'forward consensus' : 'historical'} — {model.growthLabel}.</p>
        </>
      ) : (
        <>
          <MetricButton source={model.source} label="PEG ratio" className="self-start text-sm font-medium text-muted">Not meaningful</MetricButton>
          <p className="mt-2 text-xs text-muted">{model.reason}</p>
        </>
      )}
    </Tile>
  );
}

export function PbTile({ model, isFinancial }: { model: PbModel; isFinancial: boolean }) {
  return (
    <Tile title="Price-to-book" subtitle="Price ÷ book value (equity) per share">
      {model.value != null ? (
        <>
          <MetricButton source={model.source} label="Price to book" className="self-start font-mono text-3xl font-semibold tabular-nums">{fmtX(model.value)}</MetricButton>
          <div className="mt-1 font-mono text-[11px] tabular-nums text-muted">BVPS {fmtUsd(model.bvps)} · equity {fmtBig(model.equity)}</div>
          <p className="mt-2 text-xs leading-relaxed">
            {isFinancial
              ? 'For banks and insurers, P/B is a primary yardstick: around 1x means the market values the balance sheet near its stated book; well above 1x implies returns on equity above the cost of capital.'
              : model.value < 1 ? 'Below 1x: the market values the company below its accounting book value.' : model.value > 10 ? 'High P/B is common for asset-light businesses or companies whose buybacks have shrunk book equity — it says little on its own.' : 'Compare with the company’s own history and its sector; book value understates intangible-heavy businesses.'}
          </p>
        </>
      ) : (
        <>
          <MetricButton source={model.source} label="Price to book" className="self-start text-sm font-medium text-muted">Not meaningful</MetricButton>
          <p className="mt-2 text-xs text-muted">{model.reason}</p>
        </>
      )}
      <RatioHistory points={model.history} name="P/B" />
    </Tile>
  );
}

export function DeTile({ model }: { model: DeModel }) {
  return (
    <Tile title="Debt-to-equity" subtitle="Total debt ÷ total shareholders’ equity">
      {model.status === 'ok' && model.value != null ? (
        <>
          <MetricButton source={model.source} label="Debt to equity" className="self-start font-mono text-3xl font-semibold tabular-nums">{fmtX(model.value)}</MetricButton>
          <div className="mt-1 font-mono text-[11px] tabular-nums text-muted">debt {fmtBig(model.debt)} ÷ equity {fmtBig(model.equity)}</div>
          <p className="mt-2 text-xs leading-relaxed">
            {model.value < 0.5 ? 'Low leverage: debt is small relative to equity.' : model.value <= 1.5 ? 'Moderate leverage.' : 'High leverage relative to book equity — check interest cover and debt maturities.'}
          </p>
        </>
      ) : (
        <>
          <MetricButton source={model.source} label="Debt to equity" className={cn('self-start text-sm font-medium', model.status === 'negative-equity' ? 'text-warn' : 'text-muted')}>
            {model.status === 'negative-equity' ? 'Negative equity' : 'Not meaningful'}
          </MetricButton>
          <p className="mt-2 text-xs text-muted">{model.reason}</p>
        </>
      )}
      {model.history.length > 0 && (
        <>
          <RatioHistory points={model.history} name="D/E" />
          {model.history.some((p) => p.negativeEquity) && <p className="mt-1 text-[11px] text-warn">Gaps mark years with negative equity.</p>}
        </>
      )}
    </Tile>
  );
}
