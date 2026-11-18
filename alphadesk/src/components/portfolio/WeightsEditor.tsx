'use client';
/** Target-weights editor for baskets: weights in %, must sum to 100% before saving. */
import * as React from 'react';
import { Plus, Scale, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface WeightRow { ticker: string; weight: string; rationale: string }

export const toRows = (h: { ticker: string; targetWeight: number; rationale?: string | null }[]): WeightRow[] =>
  h.map((x) => ({ ticker: x.ticker, weight: String(Math.round(x.targetWeight * 10000) / 100), rationale: x.rationale ?? '' }));

export function rowsValid(rows: WeightRow[]): { ok: boolean; sum: number; message?: string } {
  const sum = rows.reduce((a, r) => a + (Number(r.weight) || 0), 0);
  if (!rows.length) return { ok: false, sum, message: 'Add at least one holding.' };
  if (rows.some((r) => !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(r.ticker))) return { ok: false, sum, message: 'Every row needs a valid ticker.' };
  const dup = rows.map((r) => r.ticker).find((t, i, a) => a.indexOf(t) !== i);
  if (dup) return { ok: false, sum, message: `Duplicate ticker ${dup}.` };
  if (rows.some((r) => !(Number(r.weight) >= 0) || r.weight.trim() === '')) return { ok: false, sum, message: 'Weights must be non-negative numbers.' };
  if (Math.abs(sum - 100) > 0.01) return { ok: false, sum, message: `Weights sum to ${sum.toFixed(2)}% — must be 100%.` };
  return { ok: true, sum };
}

export const rowsToHoldings = (rows: WeightRow[]) => rows.map((r) => ({ ticker: r.ticker, targetWeight: Math.round(Number(r.weight) * 100) / 10000, rationale: r.rationale.trim() || null }));

export function WeightsEditor({ rows, onChange }: { rows: WeightRow[]; onChange: (r: WeightRow[]) => void }) {
  const v = rowsValid(rows);
  const set = (i: number, patch: Partial<WeightRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const normalize = () => {
    const s = rows.reduce((a, r) => a + (Number(r.weight) || 0), 0);
    if (!s) return;
    const scaled = rows.map((r) => Math.round(((Number(r.weight) || 0) / s) * 10000) / 100);
    const drift = Math.round((100 - scaled.reduce((a, b) => a + b, 0)) * 100) / 100;
    if (scaled.length) scaled[scaled.indexOf(Math.max(...scaled))] += drift;
    onChange(rows.map((r, i) => ({ ...r, weight: String(Math.round(scaled[i] * 100) / 100) })));
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[96px_96px_1fr_32px] gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
        <span>Ticker</span><span className="text-right">Target %</span><span>Rationale</span><span />
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[96px_96px_1fr_32px] items-center gap-2">
          <Input aria-label={`Ticker row ${i + 1}`} value={r.ticker} onChange={(e) => set(i, { ticker: e.target.value.toUpperCase().trim() })} className="h-8 font-mono" maxLength={10} />
          <Input aria-label={`${r.ticker || 'Row ' + (i + 1)} target weight percent`} value={r.weight} onChange={(e) => set(i, { weight: e.target.value })} className="h-8 text-right font-mono" inputMode="decimal" />
          <Input aria-label={`${r.ticker || 'Row ' + (i + 1)} rationale`} value={r.rationale} onChange={(e) => set(i, { rationale: e.target.value })} className="h-8" maxLength={500} placeholder="Why it's in the basket" />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${r.ticker || 'row'}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...rows, { ticker: '', weight: '0', rationale: '' }])}><Plus /> Add holding</Button>
        <Button type="button" variant="ghost" size="sm" onClick={normalize} disabled={!rows.length}><Scale /> Normalise to 100%</Button>
        <span className={cn('ml-auto font-mono text-xs tabular-nums', v.ok ? 'text-up' : 'text-warn')} role="status" aria-live="polite">
          Sum {v.sum.toFixed(2)}%{!v.ok && v.message ? ` · ${v.message}` : ''}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-panel-2" aria-hidden>
        <div className={cn('h-full', Math.abs(v.sum - 100) <= 0.01 ? 'bg-up' : v.sum > 100 ? 'bg-down' : 'bg-warn')} style={{ width: `${Math.min(100, v.sum)}%` }} />
      </div>
    </div>
  );
}
