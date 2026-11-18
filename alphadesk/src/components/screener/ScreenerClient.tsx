'use client';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { SortingState, VisibilityState } from '@tanstack/react-table';
import { Bookmark, Columns3, Download, FileSpreadsheet, FolderOpen, Rows3, Rows4, SearchX, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Kbd } from '@/components/ui/kbd';
import { toast } from '@/components/ui/toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MockBanner } from '@/components/shell/MockBanner';
import { PageHeader } from '@/components/shell/PageHeader';
import { UpgradeHint } from '@/components/shell/UpgradeHint';
import { useCurrentUser } from '@/components/shell/UserContext';
import { ShareButton } from '@/components/sharing/ShareButton';
import { assertFeature, type GateResult } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { DEFAULT_COLUMNS, SCREEN_COLUMNS } from '@/lib/screener/columns';
import { DEFAULT_SORT, normalizeFilters, parseSort, screenerLimits, type FilterState, type Preset, type SortSpec } from '@/lib/screener/engine';
import type { SavedScreenWire, ScreenRunApiResponse } from '@/lib/screener/types';
import { FilterBuilder } from './FilterBuilder';
import { ScreenerGrid } from './ScreenerGrid';

const visibilityFrom = (cols: string[]): VisibilityState => {
  const on = new Set(cols.length ? cols : DEFAULT_COLUMNS);
  on.add('ticker');
  return Object.fromEntries(SCREEN_COLUMNS.map((c) => [c.id, on.has(c.id)]));
};
const visibleIds = (v: VisibilityState) => SCREEN_COLUMNS.filter((c) => v[c.id] !== false).map((c) => c.id);

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j?.error?.message ?? `HTTP ${r.status}`) as Error & { status?: number; upgradeTo?: string };
    err.status = r.status;
    err.upgradeTo = j?.error?.details?.upgradeTo;
    throw err;
  }
  return j as T;
}

export function ScreenerClient() {
  const { user } = useCurrentUser();
  const router = useRouter();
  const params = useSearchParams();
  const screenParam = params.get('screen');

  const [filters, setFilters] = React.useState<FilterState>({});
  const [sorting, setSorting] = React.useState<SortingState>(DEFAULT_SORT);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => visibilityFrom([]));
  const [compact, setCompact] = React.useState(true);
  const [data, setData] = React.useState<ScreenRunApiResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState<{ id: string; name: string } | null>(null);
  const [saved, setSaved] = React.useState<SavedScreenWire[]>([]);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState('');
  const [saveAsNew, setSaveAsNew] = React.useState(false);
  const [hint, setHint] = React.useState<GateResult | null>(null);
  const [adhocId] = React.useState(() => `adhoc:screen-${Date.now().toString(36)}`);

  const limits = screenerLimits(user.plan);
  const maxFilters = data?.limits.maxFilters ?? (Number.isFinite(limits.maxFilters) ? limits.maxFilters : null);
  const exportGate = data?.gates.export ?? assertFeature(user, 'export');
  const saveGate = data?.gates.savedScreens ?? assertFeature(user, 'savedScreens');
  const sort: SortSpec = parseSort(sorting);

  // persisted density
  React.useEffect(() => {
    try { const v = localStorage.getItem('nd.screener.compact'); if (v !== null) setCompact(v === '1'); } catch { /* ignore */ }
  }, []);
  const toggleDensity = () => setCompact((c) => { try { localStorage.setItem('nd.screener.compact', c ? '0' : '1'); } catch { /* ignore */ } return !c; });

  const loadSavedList = React.useCallback(async () => {
    try { setSaved((await api<{ screens: SavedScreenWire[] }>('/api/screener/saved')).screens); } catch { /* non-fatal */ }
  }, []);
  React.useEffect(() => { void loadSavedList(); }, [loadSavedList]);

  // load ?screen=<id>
  React.useEffect(() => {
    if (!screenParam) return;
    let cancelled = false;
    api<{ screen: SavedScreenWire }>(`/api/screener/saved?id=${encodeURIComponent(screenParam)}`)
      .then(({ screen }) => {
        if (cancelled) return;
        setFilters(screen.filters ?? {});
        setSorting(parseSort(screen.sort));
        setColumnVisibility(visibilityFrom(screen.columns ?? []));
        setCurrent({ id: screen.id, name: screen.name });
      })
      .catch((e: Error) => toast({ title: 'Could not open saved screen', description: e.message, variant: 'error' }));
    return () => { cancelled = true; };
  }, [screenParam]);

  // run (debounced)
  const reqKey = JSON.stringify([normalizeFilters(filters), sort]);
  React.useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const j = await api<ScreenRunApiResponse>('/api/screener/run', { method: 'POST', body: JSON.stringify({ filters, sort }), signal: ctrl.signal });
        setData(j);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);

  const applyPreset = (p: Preset) => {
    setFilters(p.filters);
    setSorting(p.sort);
    setCurrent(null);
    if (screenParam) router.replace('/screener');
  };

  const exportHref = (format: 'csv' | 'xlsx') => {
    const q = new URLSearchParams({ format, filters: JSON.stringify(normalizeFilters(filters)), sort: JSON.stringify(sort), columns: visibleIds(columnVisibility).join(',') });
    return `/api/screener/export?${q.toString()}`;
  };
  const onExport = (format: 'csv' | 'xlsx') => {
    if (!exportGate.allowed) { setHint(exportGate); return; }
    window.location.href = exportHref(format);
  };

  const openSave = () => {
    if (!saveGate.allowed) { setHint(saveGate); return; }
    setSaveName(current?.name ?? '');
    setSaveAsNew(!current);
    setSaveOpen(true);
  };
  const doSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = { ...(current && !saveAsNew ? { id: current.id } : {}), name: saveName, filters: normalizeFilters(filters), columns: visibleIds(columnVisibility), sort };
      const { screen } = await api<{ screen: SavedScreenWire }>('/api/screener/saved', { method: 'POST', body: JSON.stringify(body) });
      setCurrent({ id: screen.id, name: screen.name });
      setSaveOpen(false);
      toast({ title: 'Screen saved', description: screen.name, variant: 'success' });
      void loadSavedList();
      router.replace(`/screener?screen=${screen.id}`);
      router.refresh(); // sidebar saved-screens list
    } catch (err) {
      const e2 = err as Error & { status?: number; upgradeTo?: string };
      if (e2.status === 402) { setSaveOpen(false); setHint({ allowed: false, reason: e2.message, upgradeTo: e2.upgradeTo as GateResult['upgradeTo'] }); return; }
      toast({ title: 'Save failed', description: e2.message, variant: 'error' });
    }
  };
  const deleteSaved = async (s: SavedScreenWire) => {
    try {
      await api(`/api/screener/saved?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      toast({ title: 'Screen deleted', description: s.name });
      if (current?.id === s.id) { setCurrent(null); router.replace('/screener'); }
      void loadSavedList();
      router.refresh();
    } catch (e) {
      toast({ title: 'Delete failed', description: (e as Error).message, variant: 'error' });
    }
  };

  const shareSnapshot = () => ({
    name: current?.name ?? 'Ad-hoc screen',
    filters: normalizeFilters(filters),
    columns: visibleIds(columnVisibility),
    sort,
    resultCount: data?.matched ?? 0,
    rows: (data?.rows ?? []).slice(0, 250).map((r) => ({
      ticker: r.ticker, name: r.name, sector: r.sector, marketCap: r.marketCap, price: r.price, changePct: r.changePct, pe: r.pe,
      evEbitda: r.evEbitda, revenueGrowth: r.revenueGrowth, epsRevision30d: r.epsRevision30d, shortInterestPct: r.shortInterestPct,
      nextEarnings: r.nextEarnings, whyNow: r.whyNow.headline,
    })),
    isMock: data?.meta.isMock ?? true,
    asOf: data?.meta.asOf,
  });

  const rows = data?.rows ?? [];
  const first = loading && !data;

  return (
    <div className="space-y-3">
      <PageHeader
        title={current ? <>Screener <span className="text-muted">/</span> {current.name}</> : 'Screener'}
        description="Filter the universe on valuation, revisions, ownership and catalysts. Research only — not investment advice."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><FolderOpen aria-hidden /> Saved</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted">Saved screens (org)</DropdownMenuLabel>
                {saved.length === 0 && <div className="px-2 py-2 text-xs text-muted">No saved screens yet.</div>}
                {saved.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => router.push(`/screener?screen=${s.id}`)} className="justify-between">
                    <span className="truncate">{s.name}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void deleteSaved(s); }}
                      className="rounded p-0.5 text-muted hover:text-down"
                      aria-label={`Delete saved screen ${s.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={openSave}><Bookmark aria-hidden /> {current ? 'Save' : 'Save screen'}</Button>
            <ShareButton
              itemType="screen"
              itemId={current?.id ?? adhocId}
              title={current?.name ?? 'Ad-hoc screen'}
              snapshot={shareSnapshot}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><Download aria-hidden /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onExport('csv')}><Download aria-hidden /> CSV</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onExport('xlsx')}><FileSpreadsheet aria-hidden /> Excel (.xlsx)</DropdownMenuItem>
                {!exportGate.allowed && <div className="px-2 pb-1 pt-0.5 text-[11px] text-accent">Pro feature</div>}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <MockBanner isMock={data?.meta.isMock ?? false} provider={data?.meta.provider} />
      {hint && !hint.allowed && (
        <div className="flex items-center gap-2">
          <UpgradeHint gate={hint} className="flex-1" />
          <button className="text-xs text-muted hover:text-text" onClick={() => setHint(null)} aria-label="Dismiss">Dismiss</button>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <FilterBuilder
          className="lg:w-64 lg:shrink-0"
          filters={filters}
          onChange={(f) => setFilters(f)}
          onPreset={applyPreset}
          facets={data?.facets}
          maxFilters={maxFilters ?? Infinity}
          plan={user.plan}
          droppedFilters={data?.droppedFilters ?? []}
        />

        <section className="min-w-0 flex-1 space-y-2" aria-label="Results">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span aria-live="polite">
              {first ? 'Running screen…' : data ? (
                <>
                  <strong className="font-mono text-text">{data.matched}</strong> of <span className="font-mono">{data.universe}</span> match
                  {data.returned < data.matched && <> · showing top <span className="font-mono">{data.returned}</span></>}
                  {data.cached && <span className="ml-1 opacity-70">(cached)</span>}
                </>
              ) : null}
            </span>
            {data?.meta.asOf && <span className="hidden sm:inline">· as of {new Date(data.meta.asOf).toLocaleString()} · {data.meta.provider}</span>}
            <span className="ml-auto hidden items-center gap-1 md:flex">
              <Kbd>j</Kbd>/<Kbd>k</Kbd> move · <Kbd>↵</Kbd> open · <Kbd>w</Kbd> why now
            </span>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={toggleDensity} aria-pressed={compact} title="Toggle row density">
              {compact ? <Rows4 aria-hidden /> : <Rows3 aria-hidden />} {compact ? 'Compact' : 'Comfortable'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"><Columns3 aria-hidden /> Columns</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                {SCREEN_COLUMNS.filter((c) => c.id !== 'ticker').map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={columnVisibility[c.id] !== false}
                    onCheckedChange={(v) => setColumnVisibility((cur) => ({ ...cur, [c.id]: !!v }))}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setColumnVisibility(visibilityFrom([]))}>Reset columns</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {data?.rowCapped && user.plan === 'FREE' && (
            <UpgradeHint compact upgradeTo="PRO" reason={`Free shows the top ${data.limits.maxRows} of ${data.matched} matches. Pro shows the full result set and unlocks export.`} />
          )}

          {error && !data ? (
            <EmptyState icon={SearchX} title="Screen failed to run" description={error} action={<Button size="sm" variant="secondary" onClick={() => setFilters({ ...filters })}>Retry</Button>} />
          ) : first ? (
            <GridSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No matches — loosen P/E or try a preset"
              description="Your filters exclude every company in the universe. Widen a range, remove a filter, or start from one of the presets on the left."
              action={<Button size="sm" variant="secondary" onClick={() => setFilters({})}>Clear filters</Button>}
            />
          ) : (
            <ScreenerGrid
              rows={rows}
              sorting={sorting}
              onSortingChange={(s) => setSorting(s.length ? s : DEFAULT_SORT)}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              compact={compact}
              dim={loading}
            />
          )}
        </section>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm">
          <form onSubmit={doSave} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{current && !saveAsNew ? 'Update saved screen' : 'Save screen'}</DialogTitle>
              <DialogDescription>Saves filters, sort and visible columns. Visible to your organisation.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="screen-name">Name</Label>
              <Input id="screen-name" autoFocus required maxLength={80} value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. Cheap growth — mid caps" />
            </div>
            {current && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={saveAsNew} onChange={(e) => setSaveAsNew(e.target.checked)} /> Save as a new screen
              </label>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!saveName.trim()}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-panel p-3" role="status" aria-label="Loading results">
      <Skeleton className="h-6 w-full" />
      {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className={cn('h-5', i % 3 === 0 ? 'w-11/12' : 'w-full')} />)}
    </div>
  );
}
