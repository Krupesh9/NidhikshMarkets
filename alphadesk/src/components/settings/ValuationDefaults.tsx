'use client';
import * as React from 'react';
import { Calculator, RotateCcw, Save, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  FACTORY_VALUATION_DEFAULTS, PROJECTION_YEARS, VALUATION_BOUNDS, sameDefaults, valuationDefaultsSchema,
  type BoundKey, type ValuationDefaults,
} from '@/lib/fundamentals/defaults';

export interface ValuationSettingProps {
  defaults: ValuationDefaults;
  updatedAt: string | null;
  updatedByName: string | null;
}

// ---- form model: every number is edited as text; '' in a nullable field = "use the live value"
type Draft = Record<string, string>;
interface NumField { path: string; label: string; unit: string; bound: BoundKey; help: string; nullable?: boolean; step?: number; placeholder?: string }

const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((a, k) => (a == null ? a : (a as Record<string, unknown>)[k]), o);
function set(o: Record<string, unknown>, path: string, v: unknown) {
  const ks = path.split('.');
  let cur: Record<string, unknown> = o;
  ks.slice(0, -1).forEach((k) => { cur = cur[k] as Record<string, unknown>; });
  cur[ks[ks.length - 1]] = v;
}

const F = {
  fixedGrowth: { path: 'dcf.fixedGrowth', label: 'Fixed FCF growth', unit: '%/yr', bound: 'fixedGrowth', help: 'Years 1–3 free-cash-flow growth for every company.' },
  capMin: { path: 'dcf.growthCapMin', label: 'Growth cap — floor', unit: '%', bound: 'growthCapMin', help: 'Model-derived growth is clamped to this floor (also Graham g).' },
  capMax: { path: 'dcf.growthCapMax', label: 'Growth cap — ceiling', unit: '%', bound: 'growthCapMax', help: 'Model-derived growth is clamped to this ceiling (also Graham g).' },
  fixedDiscount: { path: 'dcf.fixedDiscount', label: 'Fixed discount rate', unit: '%', bound: 'fixedDiscount', help: 'Same discount rate for every company. Must exceed terminal growth.' },
  erp: { path: 'dcf.erp', label: 'Equity risk premium', unit: '%', bound: 'erp', help: 'CAPM: discount = risk-free + β × ERP.' },
  rf: { path: 'dcf.riskFreeOverride', label: 'Risk-free override', unit: '%', bound: 'riskFreeOverride', help: 'Blank = live 10-year Treasury (FRED DGS10).', nullable: true, placeholder: 'live' },
  terminal: { path: 'dcf.terminal', label: 'Terminal growth', unit: '%', bound: 'terminal', help: 'Perpetual growth after year 3.' },
  mos: { path: 'graham.requiredMos', label: 'Required margin of safety', unit: '%', bound: 'requiredMos', help: 'Buy-below price = Graham value × (1 − margin). Users can save their own.', step: 1 },
  gFixed: { path: 'graham.fixedGrowth', label: 'Fixed Graham g', unit: '%/yr', bound: 'grahamFixedGrowth', help: 'Used instead of the consensus/history estimate.' },
  basePe: { path: 'graham.basePe', label: 'No-growth P/E', unit: '×', bound: 'basePe', help: 'Graham’s 8.5.' },
  mult: { path: 'graham.growthMultiplier', label: 'Growth multiplier', unit: '×', bound: 'growthMultiplier', help: 'Graham’s 2 (the “2g” term).' },
  baseYield: { path: 'graham.baseYield', label: 'Base AAA yield', unit: '%', bound: 'baseYield', help: 'Graham’s 4.4 (AAA yield in 1962).' },
  aaa: { path: 'graham.aaaOverride', label: 'Aaa yield override (Y)', unit: '%', bound: 'aaaOverride', help: 'Blank = live Moody’s Aaa yield (FRED DAAA).', nullable: true, placeholder: 'live' },
  pegFair: { path: 'peg.fairFrom', label: '“Fair” from', unit: 'PEG', bound: 'pegFairFrom', help: 'Below this = low vs growth.' },
  pegRich: { path: 'peg.richAbove', label: '“Rich” above', unit: 'PEG', bound: 'pegRichAbove', help: 'Above this = rich vs growth.' },
} satisfies Record<string, NumField>;
const RANGES = [
  { key: 'growth', label: 'FCF growth slider', bound: 'rangeGrowth' as BoundKey },
  { key: 'discount', label: 'Discount rate slider', bound: 'rangeDiscount' as BoundKey },
  { key: 'terminal', label: 'Terminal growth slider', bound: 'rangeTerminal' as BoundKey },
] as const;
const NUM_PATHS = [...Object.values(F).map((f) => f.path), ...RANGES.flatMap((r) => [`dcf.ranges.${r.key}.0`, `dcf.ranges.${r.key}.1`])];

function toDraft(d: ValuationDefaults): Draft {
  const out: Draft = { 'dcf.growthMode': d.dcf.growthMode, 'dcf.discountMode': d.dcf.discountMode, 'graham.growthMode': d.graham.growthMode };
  for (const p of NUM_PATHS) { const v = get(d, p); out[p] = v == null ? '' : String(v); }
  return out;
}
function fromDraft(draft: Draft): unknown {
  const o = JSON.parse(JSON.stringify(FACTORY_VALUATION_DEFAULTS)) as Record<string, unknown>;
  set(o, 'dcf.growthMode', draft['dcf.growthMode']);
  set(o, 'dcf.discountMode', draft['dcf.discountMode']);
  set(o, 'graham.growthMode', draft['graham.growthMode']);
  for (const p of NUM_PATHS) {
    const s = (draft[p] ?? '').trim();
    set(o, p, s === '' ? (p.endsWith('Override') ? null : Number.NaN) : Number(s));
  }
  return o;
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border bg-panel-2 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn('rounded px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', value === o.value ? 'bg-panel font-medium text-text shadow-sm' : 'text-muted hover:text-text')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NumberInput({ id, value, onChange, step, placeholder, invalid, label }: { id: string; value: string; onChange: (v: string) => void; step?: number; placeholder?: string; invalid?: boolean; label: string }) {
  return (
    <input id={id} aria-label={label} type="number" inputMode="decimal" step={step ?? 0.1} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined}
      className={cn('h-8 w-20 rounded-md border bg-panel-2 px-2 text-right font-mono text-[13px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', invalid ? 'border-down' : 'border-border')} />
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      {description && <p className="-mt-1 mb-3 text-[11px] text-muted">{description}</p>}
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

export function ValuationDefaultsCard({ initial }: { initial: ValuationSettingProps }) {
  const [saved, setSaved] = React.useState(initial);
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(initial.defaults));
  const [busy, setBusy] = React.useState<'save' | 'reset' | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  const parsed = React.useMemo(() => valuationDefaultsSchema.safeParse(fromDraft(draft)), [draft]);
  const errors = React.useMemo(() => {
    const m: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) { const k = i.path.join('.'); if (!m[k]) m[k] = i.message; }
    return m;
  }, [parsed]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved.defaults));
  const isFactory = sameDefaults(saved.defaults, FACTORY_VALUATION_DEFAULTS);
  const up = (path: string, v: string) => setDraft((d) => ({ ...d, [path]: v }));

  const field = (f: NumField) => {
    const id = `val-${f.path.replace(/\./g, '-')}`;
    const b = VALUATION_BOUNDS[f.bound];
    const err = errors[f.path];
    const factory = get(FACTORY_VALUATION_DEFAULTS, f.path);
    return (
      <div key={f.path} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5">
        <label htmlFor={id} className="text-[13px] font-medium">{f.label}</label>
        <div className="flex items-center gap-1.5">
          <NumberInput id={id} label={`${f.label} (${f.unit})`} value={draft[f.path] ?? ''} onChange={(v) => up(f.path, v)} step={f.step} placeholder={f.placeholder} invalid={submitted ? !!err : !!err && draft[f.path] !== ''} />
          <span className="w-9 text-xs text-muted">{f.unit}</span>
        </div>
        <p className={cn('col-span-2 text-[11px]', err ? 'text-down' : 'text-muted')}>
          {err ? err : `${f.help} Range ${b.min}…${b.max}${f.unit.startsWith('%') ? '%' : ''}. Factory ${factory == null ? 'live' : String(factory)}.`}
        </p>
      </div>
    );
  };

  const call = async (method: 'PUT' | 'DELETE', body?: unknown) => {
    const r = await fetch('/api/settings/valuation', { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.details?.[0]?.message ?? j?.error?.message ?? `HTTP ${r.status}`);
    return j as { defaults: ValuationDefaults; updatedAt: string | null };
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!parsed.success) { toast({ title: 'Check the highlighted fields', description: parsed.error.issues[0]?.message, variant: 'error' }); return; }
    setBusy('save');
    try {
      const j = await call('PUT', parsed.data);
      setSaved({ defaults: j.defaults, updatedAt: j.updatedAt, updatedByName: 'you' });
      setDraft(toDraft(j.defaults));
      setSubmitted(false);
      toast({ title: 'Valuation defaults saved', description: 'Every user’s Fundamental values section now starts from these values (users’ own saved assumptions still win).', variant: 'success' });
    } catch (err) {
      toast({ title: 'Defaults not saved', description: (err as Error).message, variant: 'error' });
    } finally { setBusy(null); }
  };
  const reset = async () => {
    if (!window.confirm('Reset all valuation defaults to the factory values?')) return;
    setBusy('reset');
    try {
      const j = await call('DELETE');
      setSaved({ defaults: j.defaults, updatedAt: j.updatedAt, updatedByName: 'you' });
      setDraft(toDraft(j.defaults));
      setSubmitted(false);
      toast({ title: 'Factory defaults restored', variant: 'success' });
    } catch (err) {
      toast({ title: 'Reset failed', description: (err as Error).message, variant: 'error' });
    } finally { setBusy(null); }
  };

  const gMode = draft['dcf.growthMode'] as 'model' | 'fixed';
  const rMode = draft['dcf.discountMode'] as 'capm' | 'fixed';
  const grahamMode = draft['graham.growthMode'] as 'model' | 'fixed';

  return (
    <Card id="valuation" className="scroll-mt-28">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><Calculator className="h-4 w-4 text-muted" aria-hidden /> Valuation defaults</CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {dirty && <Badge variant="warn">Unsaved changes</Badge>}
            {isFactory ? <Badge variant="outline">Factory defaults</Badge> : <Badge variant="info">Customised</Badge>}
          </div>
        </div>
        <CardDescription>
          Starting assumptions for the Pro “Fundamental values” section on every company page, for every user in the workspace.
          Users can still move the sliders and save their own assumptions per ticker, which override these for them only.
          {saved.updatedAt ? ` Last saved ${new Date(saved.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${saved.updatedByName ? ` by ${saved.updatedByName}` : ''}.` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4" noValidate>
          <div className="grid gap-4 lg:grid-cols-2">
            <Group title="DCF · growth" description="Free-cash-flow growth for years 1–3.">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium">Default growth</span>
                <Segmented label="DCF growth mode" value={gMode} onChange={(v) => up('dcf.growthMode', v)} options={[{ value: 'fixed', label: 'Fixed %' }, { value: 'model', label: 'Consensus / history' }]} />
              </div>
              {gMode === 'fixed' ? field(F.fixedGrowth) : <p className="text-[11px] text-muted">Each company’s consensus EPS growth (else 3–5 yr EPS or FCF CAGR), clamped to the cap below.</p>}
              {field(F.capMin)}
              {field(F.capMax)}
            </Group>
            <Group title="DCF · discount & terminal" description={`Projection horizon: ${PROJECTION_YEARS} years (fixed).`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium">Default discount rate</span>
                <Segmented label="Discount rate mode" value={rMode} onChange={(v) => up('dcf.discountMode', v)} options={[{ value: 'fixed', label: 'Fixed %' }, { value: 'capm', label: 'CAPM (rf + β × ERP)' }]} />
              </div>
              {rMode === 'fixed' ? field(F.fixedDiscount) : <>{field(F.erp)}{field(F.rf)}</>}
              {field(F.terminal)}
            </Group>
            <Group title="Graham intrinsic value" description="V = EPS × (no-growth P/E + multiplier × g) × base yield ÷ Y.">
              {field(F.mos)}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium">Growth g</span>
                <Segmented label="Graham growth mode" value={grahamMode} onChange={(v) => up('graham.growthMode', v)} options={[{ value: 'model', label: 'Consensus / history' }, { value: 'fixed', label: 'Fixed %' }]} />
              </div>
              {grahamMode === 'fixed' && field(F.gFixed)}
              {field(F.basePe)}
              {field(F.mult)}
              {field(F.baseYield)}
              {field(F.aaa)}
            </Group>
            <div className="space-y-4">
              <Group title="PEG bands">
                {field(F.pegFair)}
                {field(F.pegRich)}
              </Group>
              <Group title="Slider ranges" description="Min and max of the company-page sliders (they widen automatically to include a default or saved value).">
                {RANGES.map((r) => {
                  const b = VALUATION_BOUNDS[r.bound];
                  const err = errors[`dcf.ranges.${r.key}`] ?? errors[`dcf.ranges.${r.key}.0`] ?? errors[`dcf.ranges.${r.key}.1`];
                  return (
                    <div key={r.key} className="space-y-0.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[13px] font-medium">{r.label}</span>
                        <div className="flex items-center gap-1.5">
                          <NumberInput id={`val-range-${r.key}-min`} label={`${r.label} minimum (%)`} value={draft[`dcf.ranges.${r.key}.0`]} onChange={(v) => up(`dcf.ranges.${r.key}.0`, v)} invalid={!!err} />
                          <span className="text-xs text-muted">to</span>
                          <NumberInput id={`val-range-${r.key}-max`} label={`${r.label} maximum (%)`} value={draft[`dcf.ranges.${r.key}.1`]} onChange={(v) => up(`dcf.ranges.${r.key}.1`, v)} invalid={!!err} />
                          <span className="w-9 text-xs text-muted">%</span>
                        </div>
                      </div>
                      <p className={cn('text-[11px]', err ? 'text-down' : 'text-muted')}>{err ?? `Allowed ${b.min}…${b.max}%. Factory ${FACTORY_VALUATION_DEFAULTS.dcf.ranges[r.key].join('–')}%.`}</p>
                    </div>
                  );
                })}
              </Group>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button type="submit" size="sm" disabled={!dirty || busy !== null}><Save aria-hidden /> {busy === 'save' ? 'Saving…' : 'Save defaults'}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setDraft(toDraft(saved.defaults)); setSubmitted(false); }} disabled={!dirty || busy !== null}><Undo2 aria-hidden /> Discard changes</Button>
            <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={reset} disabled={busy !== null || (isFactory && !dirty)}><RotateCcw aria-hidden /> {busy === 'reset' ? 'Resetting…' : 'Reset to factory defaults'}</Button>
          </div>
          <p className="text-[11px] text-muted">Research only — not investment advice. Changes apply within a minute (settings are cached for 60 seconds per server instance; saving clears this server’s cache immediately).</p>
        </form>
      </CardContent>
    </Card>
  );
}
