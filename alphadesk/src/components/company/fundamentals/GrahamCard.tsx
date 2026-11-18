'use client';
import * as React from 'react';
import type { GrahamModel, GrowthEstimate, RateInput } from '@/lib/fundamentals/types';
import { MetricButton } from '@/components/company/MetricButton';
import { cn } from '@/lib/utils';
import { fmtPct, fmtUsd } from './format';
import { AssumptionSlider } from './DcfCard';

/** Margin-of-safety gauge: −100%…+100% track, centre = price equals value. Positive (right) = price below the estimate. */
function SafetyGauge({ mos, required }: { mos: number | null; required: number }) {
  if (mos == null) return null;
  const c = Math.max(-100, Math.min(100, mos));
  const left = 50 + c / 2;
  const good = c >= required;
  const reqLeft = 50 + Math.min(100, required) / 2;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[11px] text-muted">
        <span>Margin of safety</span>
        <span className={cn('font-mono text-sm font-semibold tabular-nums', good ? 'text-up' : 'text-down')}>{fmtPct(mos, 1, true)}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-border/70" role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(c)} aria-label={`Margin of safety ${mos.toFixed(1)} percent`}>
        <div className={cn('absolute inset-y-0 rounded-full', good ? 'bg-up/80' : c >= 0 ? 'bg-warn/80' : 'bg-down/80')} style={c >= 0 ? { left: '50%', width: `${left - 50}%` } : { left: `${left}%`, width: `${50 - left}%` }} />
        <div className="absolute -top-1 h-[18px] w-0.5 bg-text/60" style={{ left: '50%' }} aria-hidden />
        <div className="absolute -top-1.5 h-[22px] w-0.5 bg-accent" style={{ left: `${reqLeft}%` }} title={`Your required margin: ${required}%`} aria-hidden />
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-text shadow" style={{ left: `${left}%` }} aria-hidden />
      </div>
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted"><span>≤ −100%</span><span>0 · price = value</span><span>+100%</span></div>
      <p className="text-[11px] text-muted"><span className="mr-1 inline-block h-2 w-0.5 bg-accent align-middle" aria-hidden />Orange marker = your required margin ({required}%). Graham looked for roughly 25–50%.</p>
    </div>
  );
}

/**
 * Graham card. The required margin of safety is owned by FundamentalsPanel: the user's saved assumptions for this
 * ticker, else their saved global margin (server + localStorage), else the owner's default (`defaultRequired`).
 */
export function GrahamCard({ model, growth, aaa, price, required, setRequired, defaultRequired }: {
  model: GrahamModel; growth: GrowthEstimate; aaa: RateInput; price: number | null;
  required: number; setRequired: (v: number) => void; defaultRequired: number;
}) {
  const epsSrc = { ...model.source, id: `${model.source.id}:eps`, excerpt: model.epsBasis };
  const c = model.constants;
  const MOS_DEFAULT = defaultRequired;
  const buyBelow = model.value != null && model.value > 0 ? model.value * (1 - required / 100) : null;
  const meets = buyBelow != null && price != null ? price <= buyBelow : null;
  const gapPct = buyBelow != null && price != null ? ((buyBelow - price) / price) * 100 : null;
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-panel-2/40 p-5">
      <h3 className="eyebrow">Intrinsic value · Graham formula</h3>
      <p className="mt-1 text-xs text-muted">Benjamin Graham’s revised (1974) growth formula, scaled by today’s Aaa bond yield.</p>

      <div className="mt-4 rounded-lg border border-border bg-panel p-3 font-mono text-[13px] tabular-nums">
        <div className="text-muted">V = EPS × ({c.basePe} + {c.growthMultiplier}g) × {c.baseYield} ÷ Y</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-muted">=</span>
          <MetricButton source={epsSrc} label="TTM EPS">{fmtUsd(model.eps)}</MetricButton>
          <span className="text-muted">× ({c.basePe} + {c.growthMultiplier} ×</span>
          <MetricButton source={growth.source} label="Growth g">{model.g != null ? model.g.toFixed(1) : '—'}</MetricButton>
          <span className="text-muted">) × {c.baseYield} ÷</span>
          <MetricButton source={aaa.source} label="Aaa yield Y">{model.y != null ? model.y.toFixed(2) : '—'}</MetricButton>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div><dt className="text-muted">EPS (TTM)</dt><dd className="font-mono tabular-nums">{fmtUsd(model.eps)}</dd></div>
        <div><dt className="text-muted">g, %/yr{growth.capped ? ' (capped)' : ''}</dt><dd className="font-mono tabular-nums">{fmtPct(model.g)}</dd></div>
        <div><dt className="text-muted">Y, Aaa yield</dt><dd className="font-mono tabular-nums">{fmtPct(model.y, 2)}</dd></div>
      </dl>
      <p className="mt-1 text-[11px] text-muted">g: {model.growthMode === 'fixed' ? `${model.g}% — owner default (Settings → Valuation defaults)` : `${growth.label}${growth.value != null && growth.value < 0 ? ' (floored at 0%)' : ''}`}.{aaa.series === 'override' ? ` Y: owner default ${aaa.value}%.` : ''}</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-[11px] text-muted">Graham value</div>
          {model.value != null
            ? <MetricButton source={model.source} label="Graham intrinsic value" className="font-mono text-2xl font-semibold tabular-nums">{fmtUsd(model.value)}</MetricButton>
            : <div className="mt-1 text-xs text-muted">Not meaningful</div>}
        </div>
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-[11px] text-muted">Graham Number <span className="text-muted/80">√(22.5 × EPS × BVPS)</span></div>
          {model.grahamNumber != null
            ? <MetricButton source={model.numberSource} label="Graham Number" className="font-mono text-2xl font-semibold tabular-nums">{fmtUsd(model.grahamNumber)}</MetricButton>
            : <div className="mt-1 text-xs text-muted">Not meaningful</div>}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {model.status === 'ok' && price != null ? (
          <>
            <AssumptionSlider id="graham-required-mos" label="Required margin of safety" help={`default ${MOS_DEFAULT}%`} value={required} min={0} max={60} step={1}
              onChange={setRequired} changed={required !== MOS_DEFAULT} />
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-panel p-3">
                <div className="text-[11px] text-muted">Buy-below price</div>
                <div className="font-mono text-xl font-semibold tabular-nums">{fmtUsd(buyBelow)}</div>
                <div className="text-[10px] text-muted">Graham value × (1 − {required}%)</div>
              </div>
              <div className={cn('rounded-lg border p-3', meets ? 'border-up/40 bg-up/10' : 'border-warn/40 bg-warn/10')} role="status">
                <div className="text-[11px] text-muted">vs today’s price {fmtUsd(price)}</div>
                <div className={cn('text-sm font-semibold', meets ? 'text-up' : 'text-warn')}>{meets ? 'Meets your margin' : 'Above buy-below price'}</div>
                <div className="text-[11px] text-muted">{gapPct == null ? '' : meets ? `${fmtPct(gapPct, 1)} headroom below the buy-below price` : `Needs a ${fmtPct(Math.abs(gapPct), 1)} drop to reach it`}</div>
              </div>
            </div>
            <SafetyGauge mos={model.marginOfSafety} required={required} />
            {required !== MOS_DEFAULT && <button type="button" onClick={() => setRequired(MOS_DEFAULT)} className="text-[11px] text-info hover:underline">Reset to {MOS_DEFAULT}%</button>}
          </>
        ) : <p className="text-xs text-muted">{model.reason}</p>}
      </div>
      <p className="mt-auto pt-3 text-[11px] text-muted">The Graham Number is a stricter defensive check (P/E ≤ 15 and P/B ≤ 1.5); it ignores growth entirely.</p>
    </div>
  );
}
