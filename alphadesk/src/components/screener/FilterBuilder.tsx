'use client';
import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Plus, Search, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UpgradeHint } from '@/components/shell/UpgradeHint';
import { cn } from '@/lib/utils';
import {
  activeFilterKeys, CATALYST_FILTERS, CATALYST_LABELS, describeFilter, FILTER_LABELS, MARKET_CAP_BOUNDS, MARKET_CAP_BUCKETS,
  PRESETS, RANGE_KEYS, type FilterKey, type FilterState, type Preset, type Range, type RangeKey,
} from '@/lib/screener/engine';
import type { Facets } from '@/lib/screener/types';
import type { Plan } from '@/lib/plans';

const ADDABLE: FilterKey[] = ['marketCap', 'sector', 'industry', 'country', ...RANGE_KEYS, 'insiderBuying', 'earningsWithinDays', 'catalysts'];

/** Sensible default value when a filter is first added. */
function defaultValue(k: FilterKey): FilterState[FilterKey] {
  switch (k) {
    case 'pe': return { min: 0, max: 25 };
    case 'evEbitda': return { max: 15 };
    case 'revenueGrowth': return { min: 10 };
    case 'epsRevision30d': return { min: 0 };
    case 'shortInterestPct': return { min: 5 };
    case 'esgScore': return { min: 60 };
    case 'changePct': return { min: 0 };
    case 'price': return { min: 5 };
    case 'insiderBuying': return true;
    case 'earningsWithinDays': return 30;
    case 'marketCap': return ['large'];
    default: return undefined;
  }
}

interface Props {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  onPreset: (p: Preset) => void;
  facets?: Facets;
  maxFilters: number;
  plan: Plan;
  droppedFilters: FilterKey[];
  className?: string;
}

export function FilterBuilder({ filters, onChange, onPreset, facets, maxFilters, plan, droppedFilters, className }: Props) {
  const active = activeFilterKeys(filters).filter((k): k is Exclude<FilterKey, "q"> => k !== "q") as FilterKey[];
  const activeCount = activeFilterKeys(filters).length;
  const atCap = activeCount >= maxFilters;
  const [editing, setEditing] = React.useState<FilterKey | null>(null);
  const [capHint, setCapHint] = React.useState(false);
  const [q, setQ] = React.useState(filters.q ?? '');
  React.useEffect(() => setQ(filters.q ?? ''), [filters.q]);

  const set = (k: FilterKey, v: unknown) => {
    const next: Record<string, unknown> = { ...filters };
    if (v === undefined) delete next[k];
    else next[k] = v;
    onChange(next as FilterState);
  };
  const add = (k: FilterKey) => {
    if (filters[k] !== undefined) { setEditing(k); return; }
    if (atCap) { setCapHint(true); return; }
    const v = defaultValue(k);
    // multi-selects start empty; they become active once a value is picked
    if (v !== undefined) set(k, v);
    setEditing(k);
  };

  return (
    <aside className={cn('flex flex-col gap-4', className)} aria-label="Screen filters">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => q !== (filters.q ?? '') && set('q', q.trim() || undefined)}
          onKeyDown={(e) => { if (e.key === 'Enter') set('q', q.trim() || undefined); }}
          placeholder="Search ticker, name, theme…"
          className="h-8 pl-8 text-xs"
          aria-label="Search the universe"
        />
      </div>

      <section aria-labelledby="flt-active">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 id="flt-active" className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Filters{Number.isFinite(maxFilters) ? <span className="ml-1 normal-case tracking-normal">({activeCount}/{maxFilters})</span> : null}
          </h2>
          {activeCount > 0 && (
            <button className="text-[11px] text-info hover:underline" onClick={() => onChange({})}>Clear all</button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {active.length === 0 && <p className="text-xs text-muted">No filters — showing the whole universe. Add one below or start from a preset.</p>}
          {active.map((k) => (
            <Popover.Root key={k} open={editing === k} onOpenChange={(o) => setEditing(o ? k : null)}>
              <span className={cn('inline-flex items-center rounded-md border text-xs', droppedFilters.includes(k) ? 'border-warn/50 bg-warn/10 text-warn line-through' : 'border-info/40 bg-info/10 text-text')}>
                <Popover.Trigger asChild>
                  <button className="max-w-[200px] truncate px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info" title={droppedFilters.includes(k) ? 'Not applied on your plan' : 'Edit filter'}>
                    {describeFilter(k, filters)}
                  </button>
                </Popover.Trigger>
                <button onClick={() => set(k, undefined)} className="border-l border-border/60 px-1.5 py-1 text-muted hover:text-text" aria-label={`Remove ${FILTER_LABELS[k]} filter`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
              <EditorContent k={k} filters={filters} set={set} facets={facets} />
            </Popover.Root>
          ))}
          {/* pending multi-select / catalyst editors that have no value yet */}
          {editing && !active.includes(editing) && (
            <Popover.Root open onOpenChange={(o) => !o && setEditing(null)}>
              <Popover.Anchor asChild>
                <span className="inline-flex items-center rounded-md border border-dashed border-info/40 px-2 py-1 text-xs text-muted">{FILTER_LABELS[editing]}…</span>
              </Popover.Anchor>
              <EditorContent k={editing} filters={filters} set={set} facets={facets} />
            </Popover.Root>
          )}
        </div>
        {(capHint || droppedFilters.length > 0) && plan === 'FREE' && (
          <UpgradeHint
            className="mt-2"
            compact
            upgradeTo="PRO"
            reason={droppedFilters.length ? `Free applies the first ${maxFilters} filters; ${droppedFilters.map((d) => FILTER_LABELS[d]).join(', ')} not applied.` : `Free screens use up to ${maxFilters} filters. Pro unlocks unlimited filters.`}
          />
        )}
      </section>

      <section aria-labelledby="flt-add">
        <h2 id="flt-add" className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Add filter</h2>
        <div className="flex flex-wrap gap-1">
          {ADDABLE.filter((k) => filters[k] === undefined).map((k) => (
            <button
              key={k}
              onClick={() => add(k)}
              className={cn('inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:border-info/50 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', atCap && 'opacity-60')}
            >
              <Plus className="h-3 w-3" aria-hidden />{FILTER_LABELS[k]}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="flt-presets">
        <h2 id="flt-presets" className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted"><Sparkles className="h-3 w-3" aria-hidden /> Presets</h2>
        <ul className="space-y-1">
          {PRESETS.map((p) => (
            <li key={p.id}>
              <button onClick={() => onPreset(p)} className="w-full rounded-md border border-border bg-panel-2/40 px-2.5 py-1.5 text-left hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                <div className="text-xs font-medium">{p.label}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-muted">{p.description}</div>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function EditorContent({ k, filters, set, facets }: { k: FilterKey; filters: FilterState; set: (k: FilterKey, v: unknown) => void; facets?: Facets }) {
  return (
    <Popover.Portal>
      <Popover.Content side="right" align="start" sideOffset={8} className="z-50 w-64 rounded-md border border-border bg-panel p-3 text-sm shadow-xl focus:outline-none">
        <div className="mb-2 text-xs font-semibold">{FILTER_LABELS[k]}</div>
        <Editor k={k} filters={filters} set={set} facets={facets} />
        <Popover.Close asChild>
          <Button size="sm" variant="secondary" className="mt-3 h-7 w-full text-xs">Done</Button>
        </Popover.Close>
      </Popover.Content>
    </Popover.Portal>
  );
}

function Editor({ k, filters, set, facets }: { k: FilterKey; filters: FilterState; set: (k: FilterKey, v: unknown) => void; facets?: Facets }) {
  if ((RANGE_KEYS as string[]).includes(k)) return <RangeEditor value={filters[k as RangeKey]} onChange={(r) => set(k, r)} />;
  if (k === 'marketCap') {
    return <CheckList options={MARKET_CAP_BUCKETS.map((b) => ({ value: b, label: MARKET_CAP_BOUNDS[b].label }))} value={filters.marketCap ?? []} onChange={(v) => set(k, v.length ? v : undefined)} />;
  }
  if (k === 'sector' || k === 'industry' || k === 'country') {
    const opts = (facets?.[k] ?? []).map((o) => ({ value: o.value, label: o.value, count: o.count }));
    return <CheckList searchable={opts.length > 8} options={opts} value={filters[k] ?? []} onChange={(v) => set(k, v.length ? v : undefined)} />;
  }
  if (k === 'catalysts') {
    return <CheckList options={CATALYST_FILTERS.map((c) => ({ value: c, label: CATALYST_LABELS[c] }))} value={filters.catalysts ?? []} onChange={(v) => set(k, v.length ? v : undefined)} />;
  }
  if (k === 'insiderBuying') {
    return (
      <div className="flex gap-1" role="radiogroup" aria-label="Insider activity">
        {[{ v: true, l: 'Net buying' }, { v: false, l: 'Net selling' }].map((o) => (
          <button key={String(o.v)} role="radio" aria-checked={filters.insiderBuying === o.v} onClick={() => set(k, o.v)}
            className={cn('flex-1 rounded border px-2 py-1 text-xs', filters.insiderBuying === o.v ? 'border-info bg-info/15 text-text' : 'border-border text-muted hover:text-text')}>
            {o.l}
          </button>
        ))}
      </div>
    );
  }
  if (k === 'earningsWithinDays') {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {[7, 14, 30, 45, 90].map((d) => (
            <button key={d} onClick={() => set(k, d)} className={cn('rounded border px-2 py-0.5 font-mono text-xs', filters.earningsWithinDays === d ? 'border-info bg-info/15' : 'border-border text-muted hover:text-text')}>{d}d</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          Custom
          <Input type="number" min={0} max={365} className="h-7 w-20 font-mono text-xs" value={filters.earningsWithinDays ?? ''}
            onChange={(e) => set(k, e.target.value === '' ? undefined : Math.max(0, Math.min(365, Math.round(Number(e.target.value)))))} />
          days
        </label>
      </div>
    );
  }
  return null;
}

function RangeEditor({ value, onChange }: { value?: Range; onChange: (r: Range | undefined) => void }) {
  const upd = (side: 'min' | 'max', raw: string) => {
    const n = raw === '' ? null : Number(raw);
    const next = { ...(value ?? {}), [side]: n !== null && Number.isFinite(n) ? n : null };
    onChange(next.min == null && next.max == null ? undefined : next);
  };
  return (
    <div className="flex items-center gap-2">
      <Input aria-label="Minimum" type="number" step="any" placeholder="Min" className="h-7 font-mono text-xs" value={value?.min ?? ''} onChange={(e) => upd('min', e.target.value)} />
      <span className="text-muted">–</span>
      <Input aria-label="Maximum" type="number" step="any" placeholder="Max" className="h-7 font-mono text-xs" value={value?.max ?? ''} onChange={(e) => upd('max', e.target.value)} />
    </div>
  );
}

function CheckList<T extends string>({ options, value, onChange, searchable }: { options: { value: T; label: string; count?: number }[]; value: T[]; onChange: (v: T[]) => void; searchable?: boolean }) {
  const [q, setQ] = React.useState('');
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  if (!options.length) return <p className="text-xs text-muted">Loading options…</p>;
  return (
    <div>
      {searchable && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="mb-2 h-7 text-xs" aria-label="Filter options" />}
      <ul className="max-h-56 space-y-0.5 overflow-y-auto scrollbar-thin">
        {shown.map((o) => {
          const on = value.includes(o.value);
          return (
            <li key={o.value}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-panel-2">
                <input type="checkbox" className="accent-[rgb(var(--info))]" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])} />
                <span className="flex-1 truncate">{o.label}</span>
                {o.count != null && <span className="font-mono text-[10px] text-muted">{o.count}</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
