'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Briefcase, FileUp, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Delta } from '@/components/ui/delta';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/ui/sparkline';
import { toast } from '@/components/ui/toast';
import { MockBanner } from '@/components/shell/MockBanner';
import { PageHeader } from '@/components/shell/PageHeader';
import { UpgradeHint } from '@/components/shell/UpgradeHint';
import { useCurrentUser } from '@/components/shell/UserContext';
import { PLAN_INFO, formatLimit } from '@/lib/plans';
import type { PortfolioSummary } from '@/lib/analytics/server';
import { CsvImportDialog } from './CsvImportDialog';
import { api, BENCHMARK_OPTIONS, pct, signedUsd, usd } from './format';

export function PortfolioList() {
  const { user } = useCurrentUser();
  const router = useRouter();
  const [items, setItems] = React.useState<PortfolioSummary[] | null>(null);
  const [isMock, setIsMock] = React.useState(false);
  const [provider, setProvider] = React.useState<string>();
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await api<{ items: PortfolioSummary[]; meta: { isMock: boolean; providers: string[] } }>('/api/portfolios?summary=1');
      setItems(r.items); setIsMock(r.meta.isMock); setProvider(r.meta.providers.filter((p) => p !== 'Mock').join(' + ') || undefined); setError(null);
    } catch (e) { setError((e as Error).message); setItems([]); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const limit = PLAN_INFO[user.plan].limits.positions;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Portfolios"
        description="Exposure, risk and attribution across your books. Research only — not investment advice."
        actions={<>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}><FileUp /> Import CSV</Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus /> New portfolio</Button>
        </>}
      />
      <MockBanner isMock={isMock} provider={provider} />
      <p className="text-xs text-muted">Plan: {PLAN_INFO[user.plan].label} · {limit === Infinity ? 'unlimited' : `up to ${formatLimit(limit)}`} positions per portfolio.</p>
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
      {!items ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading portfolios">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Briefcase} title="No portfolios yet" description="Create a portfolio or import positions from a CSV (ticker, quantity, cost basis) to see exposure, VaR and attribution."
          action={<div className="flex gap-2"><Button size="sm" onClick={() => setCreateOpen(true)}><Plus /> New portfolio</Button><Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}><FileUp /> Import CSV</Button></div>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <Link key={p.id} href={`/portfolios/${p.id}`} className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
              <Card className="flex h-full flex-col gap-3 p-4 transition-colors group-hover:border-accent/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{p.name}</h2>
                    <p className="line-clamp-1 text-xs text-muted">{p.description || `${p.positionCount} positions · vs ${p.benchmark}`}</p>
                  </div>
                  {p.isMock && <span className="rounded border border-warn/40 px-1 text-[10px] text-warn">demo</span>}
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="font-mono text-xl font-semibold tabular-nums">{usd(p.value)}</div>
                    <div className="flex items-center gap-2 text-xs">
                      <Delta value={p.dayPct * 100} />
                      <span className="font-mono tabular-nums text-muted">{signedUsd(p.dayPnl)} today</span>
                    </div>
                  </div>
                  <Sparkline data={p.sparkline} width={110} height={36} label={`${p.name} 30-day value trend`} />
                </div>
                <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-2 text-[11px]">
                  <div><dt className="text-muted">Positions</dt><dd className="font-mono tabular-nums">{p.positionCount}</dd></div>
                  <div><dt className="text-muted">Gross / Net</dt><dd className="font-mono tabular-nums">{pct(p.grossPct, 0)} / {pct(p.netPct, 0)}</dd></div>
                  <div><dt className="text-muted">Unrealised</dt><dd className={`font-mono tabular-nums ${p.unrealizedPnl >= 0 ? 'text-up' : 'text-down'}`}>{signedUsd(p.unrealizedPnl)}</dd></div>
                </dl>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <CreatePortfolioDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => router.push(`/portfolios/${id}`)} />
      <CsvImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={(id) => { void load(); router.push(`/portfolios/${id}`); }} />
      <p className="text-[11px] text-muted">Values use latest available prices; sparkline = current holdings revalued over the last 30 sessions. Research only — not investment advice.</p>
    </div>
  );
}

function CreatePortfolioDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [bench, setBench] = React.useState('SPY');
  const [busy, setBusy] = React.useState(false);
  const [gate, setGate] = React.useState<{ reason: string; upgradeTo?: 'PRO_PLUS' } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ portfolio: { id: string } }>('/api/portfolios', { method: 'POST', json: { name: name.trim(), description: desc.trim() || undefined, benchmark: bench } });
      toast({ title: 'Portfolio created', variant: 'success' });
      onOpenChange(false); setName(''); setDesc('');
      onCreated(r.portfolio.id);
    } catch (err) {
      const e2 = err as Error & { status?: number; details?: { upgradeTo?: 'PRO_PLUS' } };
      if ((e2 as { code?: string }).code === 'upgrade_required' || e2.status === 402) setGate({ reason: e2.message, upgradeTo: e2.details?.upgradeTo });
      else toast({ title: 'Could not create portfolio', description: e2.message, variant: 'error' });
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New portfolio</DialogTitle>
            <DialogDescription>Add positions after creating it, or import a CSV.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="pf-name">Name</Label><Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus /></div>
          <div className="grid gap-1.5"><Label htmlFor="pf-desc">Description (optional)</Label><Textarea id="pf-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={1000} /></div>
          <div className="grid gap-1.5">
            <Label htmlFor="pf-bench">Benchmark</Label>
            <Select value={bench} onValueChange={setBench}>
              <SelectTrigger id="pf-bench"><SelectValue /></SelectTrigger>
              <SelectContent>{BENCHMARK_OPTIONS.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {gate && <UpgradeHint reason={gate.reason} upgradeTo={gate.upgradeTo} />}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
