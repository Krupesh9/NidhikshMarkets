'use client';
import * as React from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { RotateCcw } from 'lucide-react';
import type { SourceRef } from '@/lib/data/types';
import type { DcfParams, DcfResult } from '@/lib/fundamentals/formulas';
import type { DcfModel, RateInput } from '@/lib/fundamentals/types';
import { Button } from '@/components/ui/button';
import { Delta } from '@/components/ui/delta';
import { MetricButton } from '@/components/company/MetricButton';
import { cn } from '@/lib/utils';
import { AXIS_TICK, TOOLTIP_STYLE, fmtBig, fmtPct, fmtShares, fmtUsd } from './format';

interface SliderProps { id: string; label: string; help: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; changed: boolean }

export function AssumptionSlider({ id, label, help, value, min, max, step = 0.1, onChange, changed }: SliderProps) {
  const [text, setText] = React.useState(value.toFixed(1));
  React.useEffect(() => setText(value.toFixed(1)), [value]);
  const commit = (s: string) => {
    const n = Number(s);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n * 10) / 10)));
    else setText(value.toFixed(1));
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}{changed && <span className="ml-1.5 rounded bg-accent/15 px-1 text-[10px] font-semibold uppercase tracking-wide text-accent">edited</span>}
        </label>
        <div className="flex items-center gap-1">
          <input
            aria-label={`${label} (percent)`} inputMode="decimal" value={text}
            onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
            className="h-7 w-16 rounded-md border border-border bg-panel-2 px-2 text-right font-mono text-[13px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
          />
          <span className="text-xs text-muted">%</span>
        </div>
      </div>
      <input
        id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${value.toFixed(1)} percent`}
        className="h-1.5 w-full cursor-pointer appearance-auto accent-[rgb(var(--info))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
      />
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted"><span>{min}%</span><span className="font-sans">{help}</span><span>{max}%</span></div>
    </div>
  );
}

type Range = readonly [number, number];
/** Slider range from the owner's settings, widened to include the default and any saved value. */
export function sliderRange(r: Range, ...include: number[]): [number, number] {
  const vals = include.filter((v) => Number.isFinite(v));
  return [Math.min(r[0], ...vals.map(Math.floor)), Math.max(r[1], ...vals.map(Math.ceil))];
}

export function DcfCard({ ticker, model, params, setParams, result, price, riskFree, ranges: cfgRanges, baseline, hasSaved = false, actions, chip }: {
  ticker: string; model: DcfModel; params: DcfParams; setParams: (p: DcfParams) => void; result: DcfResult | null; price: number | null; riskFree: RateInput;
  /** owner's slider ranges (Settings → Valuation defaults) */
  ranges: { growth: Range; discount: Range; terminal: Range };
  /** what "Reset" returns to: the user's saved assumptions, else the defaults */
  baseline: DcfParams;
  hasSaved?: boolean;
  actions?: React.ReactNode;
  chip?: React.ReactNode;
}) {
  const d = model.defaults;
  const ranges = {
    growth: sliderRange(cfgRanges.growth, d.growth, baseline.growth),
    discount: sliderRange(cfgRanges.discount, d.discount, baseline.discount),
    terminal: sliderRange(cfgRanges.terminal, d.terminal, baseline.terminal),
  };
  const edited = params.growth !== d.growth || params.discount !== d.discount || params.terminal !== d.terminal;
  const offBaseline = params.growth !== baseline.growth || params.discount !== baseline.discount || params.terminal !== baseline.terminal;
  const resetLabel = hasSaved ? 'Revert to saved' : 'Reset to defaults';
  const inputs = model.inputs;
  const ok = result?.ok ? result : null;

  const liveSource: SourceRef = {
    ...model.source,
    id: `${model.source.id}:${params.growth}:${params.discount}:${params.terminal}`,
    excerpt: ok && inputs
      ? `Value/share = (Σ PV(FCF₁…₃) ${fmtBig(ok.sumPvFcf)} + PV(terminal) ${fmtBig(ok.pvTerminal)} + cash ${fmtBig(inputs.cash)} − debt ${fmtBig(inputs.totalDebt)}) ÷ ${fmtShares(inputs.shares)} diluted shares = ${fmtUsd(ok.perShare)}. Assumptions: growth ${params.growth.toFixed(1)}%/yr for 3 years, discount rate ${params.discount.toFixed(1)}%, terminal growth ${params.terminal.toFixed(1)}%${edited ? ' (edited; defaults ' + `${d.growth}% / ${d.discount}% / ${d.terminal}%)` : ' (defaults)'}. Base FCF: ${model.baseFcfBasis}. ${model.growthBasis}. ${model.discountBasis}.`
      : model.source.excerpt,
  };

  const chartData = ok ? ok.years.map((y) => ({ name: `Year ${y.year}`, fcf: y.fcf, pv: y.pv, df: y.discountFactor })) : [];

  return (
    <div className="rounded-xl border border-border bg-panel-2/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="eyebrow">Discounted cash flow · 3-year projection</h3>
          <p className="mt-1 text-xs text-muted">Free cash flow grown for 3 years, a terminal value at year 3, all discounted to today.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setParams(baseline)} disabled={!offBaseline} aria-label={hasSaved ? 'Revert DCF assumptions to your saved values' : 'Reset DCF assumptions to defaults'}>
            <RotateCcw aria-hidden /> {resetLabel}
          </Button>
          {actions}
        </div>
      </div>
      {chip && <div className="mt-3">{chip}</div>}

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        {/* assumptions */}
        <div className="space-y-5">
          <AssumptionSlider id={`${ticker}-dcf-g`} label="FCF growth, years 1–3" help={`default ${d.growth}%`} value={params.growth} min={ranges.growth[0]} max={ranges.growth[1]} onChange={(v) => setParams({ ...params, growth: v })} changed={params.growth !== d.growth} />
          <AssumptionSlider id={`${ticker}-dcf-r`} label="Discount rate" help={`default ${d.discount}%`} value={params.discount} min={ranges.discount[0]} max={ranges.discount[1]} onChange={(v) => setParams({ ...params, discount: v })} changed={params.discount !== d.discount} />
          <AssumptionSlider id={`${ticker}-dcf-t`} label="Terminal growth" help={`default ${d.terminal}%`} value={params.terminal} min={ranges.terminal[0]} max={ranges.terminal[1]} onChange={(v) => setParams({ ...params, terminal: v })} changed={params.terminal !== d.terminal} />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-border bg-panel p-3 text-xs">
            <dt className="text-muted">Base FCF (TTM)</dt>
            <dd className="text-right font-mono tabular-nums"><MetricButton source={{ ...model.balanceSource, excerpt: model.baseFcfBasis }} label="Base free cash flow">{fmtBig(inputs?.baseFcf)}</MetricButton></dd>
            <dt className="text-muted">Risk-free (10y UST)</dt>
            <dd className="text-right font-mono tabular-nums"><MetricButton source={riskFree.source} label="Risk-free rate">{fmtPct(riskFree.value, 2)}</MetricButton></dd>
            <dt className="text-muted">Beta</dt>
            <dd className="text-right font-mono tabular-nums"><MetricButton source={model.beta.source} label="Beta">{model.beta.value.toFixed(2)}</MetricButton></dd>
            <dt className="text-muted">Equity risk premium</dt>
            <dd className="text-right font-mono tabular-nums">{fmtPct(model.erp, 1)}</dd>
          </dl>
          <p className="text-[11px] leading-relaxed text-muted">{model.growthBasis}. {model.discountBasis}.{model.discountMode === 'capm' ? ` ${model.beta.basis}.` : ''}</p>
        </div>

        {/* results */}
        <div className="min-w-0 space-y-5">
          {ok && inputs ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-[11px] text-muted">DCF value per share</div>
                  <MetricButton source={liveSource} label="DCF value per share" className="font-mono text-3xl font-semibold tabular-nums">{fmtUsd(ok.perShare)}</MetricButton>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {price != null && ok.upsidePct != null && <Delta value={ok.upsidePct} badge amount={ok.perShare - price} dp={1} />}
                  <span className="text-[11px] text-muted">vs price {fmtUsd(price)}</span>
                </div>
              </div>

              <figure className="space-y-1">
                <figcaption className="text-[11px] text-muted">Projected free cash flow and its present value</figcaption>
                <div className="h-48 w-full" role="img" aria-label={`Projected FCF ${chartData.map((c) => `${c.name} ${fmtBig(c.fcf)}, present value ${fmtBig(c.pv)}`).join('; ')}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
                      <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={58} tickFormatter={(v: number) => fmtBig(v)} />
                      <Tooltip isAnimationActive={false} contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'rgb(var(--muted))' }} cursor={{ fill: 'rgb(var(--border) / 0.35)' }}
                        formatter={(v, n) => [fmtBig(Number(v)), n === 'fcf' ? 'Projected FCF' : 'Present value']} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'rgb(var(--muted))' }} formatter={(v) => (v === 'fcf' ? 'Projected FCF' : 'Present value')} />
                      <Bar dataKey="fcf" fill="rgb(var(--muted))" fillOpacity={0.55} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="pv" fill="rgb(var(--info))" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </figure>

              {/* composition: explicit years vs terminal */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-muted">
                  <span>Value from years 1–3 <span className="font-mono tabular-nums text-text">{fmtPct(100 - ok.terminalSharePct, 0)}</span></span>
                  <span>From terminal value <span className="font-mono tabular-nums text-text">{fmtPct(ok.terminalSharePct, 0)}</span></span>
                </div>
                <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={`${ok.terminalSharePct.toFixed(0)} percent of enterprise value comes from the terminal value`}>
                  <div className="h-full bg-info" style={{ width: `${100 - ok.terminalSharePct}%` }} />
                  <div className="h-full bg-accent/80" style={{ width: `${ok.terminalSharePct}%` }} />
                </div>
                {ok.terminalSharePct > 75 && <p className="text-[11px] text-muted">Most of the value sits in the terminal value, so the result is very sensitive to the discount rate and terminal growth.</p>}
              </div>

              {/* bridge */}
              <div className="overflow-x-auto">
                <ol className="flex min-w-max items-stretch gap-1.5 text-center text-[11px]" aria-label="Equity value bridge">
                  {[
                    { k: 'PV of FCF', v: fmtBig(ok.sumPvFcf) },
                    { op: '+' },
                    { k: 'PV of terminal', v: fmtBig(ok.pvTerminal), sub: `TV ${fmtBig(ok.terminalValue)}` },
                    { op: '+' },
                    { k: 'Cash', v: fmtBig(inputs.cash), src: true },
                    { op: '−' },
                    { k: 'Debt', v: fmtBig(inputs.totalDebt), src: true },
                    { op: '=' },
                    { k: 'Equity value', v: fmtBig(ok.equityValue), strong: true },
                    { op: '÷' },
                    { k: 'Diluted shares', v: fmtShares(inputs.shares), src: true },
                    { op: '=' },
                    { k: 'Per share', v: fmtUsd(ok.perShare), strong: true },
                  ].map((s, i) => 'op' in s ? (
                    <li key={i} className="flex items-center px-0.5 font-mono text-sm text-muted" aria-hidden>{s.op}</li>
                  ) : (
                    <li key={i} className={cn('rounded-md border border-border bg-panel px-2.5 py-1.5', s.strong && 'border-info/40 bg-info/10')}>
                      <div className="text-muted">{s.k}</div>
                      <div className="font-mono text-[13px] font-semibold tabular-nums">
                        {s.src ? <MetricButton source={model.balanceSource} label={s.k} highlight={s.k === 'Diluted shares' ? undefined : s.k.toLowerCase()}>{s.v}</MetricButton> : s.v}
                      </div>
                      {s.sub && <div className="font-mono text-[10px] tabular-nums text-muted">{s.sub}</div>}
                    </li>
                  ))}
                </ol>
              </div>

              <table className="w-full text-xs">
                <caption className="sr-only">DCF projection table</caption>
                <thead><tr className="border-b border-border text-muted"><th className="py-1 text-left font-medium">Year</th><th className="py-1 text-right font-medium">FCF</th><th className="py-1 text-right font-medium">Discount factor</th><th className="py-1 text-right font-medium">Present value</th></tr></thead>
                <tbody className="font-mono tabular-nums">
                  {ok.years.map((y) => (
                    <tr key={y.year} className="border-b border-border/50"><td className="py-1 font-sans">Year {y.year}</td><td className="py-1 text-right">{fmtBig(y.fcf)}</td><td className="py-1 text-right">{y.discountFactor.toFixed(3)}</td><td className="py-1 text-right">{fmtBig(y.pv)}</td></tr>
                  ))}
                  <tr><td className="py-1 font-sans">Terminal (yr 3)</td><td className="py-1 text-right">{fmtBig(ok.terminalValue)}</td><td className="py-1 text-right">{ok.years[ok.years.length - 1].discountFactor.toFixed(3)}</td><td className="py-1 text-right">{fmtBig(ok.pvTerminal)}</td></tr>
                </tbody>
              </table>
            </>
          ) : (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm font-medium">DCF not meaningful with these inputs</p>
              <p className="max-w-md text-xs text-muted">{result && !result.ok ? result.reason : model.reason}</p>
              {offBaseline && <Button variant="outline" size="sm" onClick={() => setParams(baseline)}><RotateCcw aria-hidden /> {resetLabel}</Button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
