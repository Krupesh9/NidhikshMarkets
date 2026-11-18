'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Layers, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { PageHeader } from '@/components/shell/PageHeader';
import type { BasketDTO } from '@/lib/repos/types';
import { api, pct } from './format';
import { rowsToHoldings, rowsValid, WeightsEditor, type WeightRow } from './WeightsEditor';

export function BasketList() {
  const router = useRouter();
  const [items, setItems] = React.useState<BasketDTO[] | null>(null);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    api<{ items: BasketDTO[] }>('/api/baskets').then((r) => setItems(r.items)).catch((e) => { toast({ title: 'Could not load baskets', description: (e as Error).message, variant: 'error' }); setItems([]); });
  }, []);
  return (
    <div className="space-y-4">
      <PageHeader title="Baskets" description="Thematic synthetic ETFs with target weights, drift monitoring and rebalancing suggestions. Research only — not investment advice."
        actions={<Button size="sm" onClick={() => setOpen(true)}><Plus /> New basket</Button>} />
      {!items ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading baskets">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={Layers} title="No baskets yet" description="Build a thematic basket: pick tickers, set target weights that sum to 100%, and track drift." action={<Button size="sm" onClick={() => setOpen(true)}><Plus /> New basket</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((b) => (
            <Link key={b.id} href={`/baskets/${b.id}`} className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
              <Card className="flex h-full flex-col gap-3 p-4 group-hover:border-accent/50">
                <div>
                  <h2 className="text-sm font-semibold">{b.name}</h2>
                  <p className="line-clamp-2 text-xs text-muted">{b.description || b.thesis || `${b.holdings.length} holdings`}</p>
                </div>
                <div className="flex h-2 overflow-hidden rounded" aria-label="Target weights">
                  {b.holdings.map((h, i) => <span key={h.id} style={{ width: `${h.targetWeight * 100}%`, opacity: 1 - i * (0.7 / Math.max(1, b.holdings.length)) }} className="h-full border-r border-panel bg-accent" title={`${h.ticker} ${pct(h.targetWeight)}`} />)}
                </div>
                <div className="mt-auto flex flex-wrap gap-1">
                  {b.holdings.slice(0, 6).map((h) => <span key={h.id} className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11px]">{h.ticker} <span className="text-muted">{pct(h.targetWeight, 0)}</span></span>)}
                  {b.holdings.length > 6 && <span className="text-[11px] text-muted">+{b.holdings.length - 6}</span>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <CreateBasketDialog open={open} onOpenChange={setOpen} onCreated={(id) => router.push(`/baskets/${id}`)} />
    </div>
  );
}

function CreateBasketDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [thesis, setThesis] = React.useState('');
  const [rows, setRows] = React.useState<WeightRow[]>([{ ticker: '', weight: '50', rationale: '' }, { ticker: '', weight: '50', rationale: '' }]);
  const [busy, setBusy] = React.useState(false);
  const v = rowsValid(rows);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.ok || !name.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ basket: { id: string } }>('/api/baskets', { method: 'POST', json: { name: name.trim(), description: desc.trim() || null, thesis: thesis.trim() || null, holdings: rowsToHoldings(rows) } });
      toast({ title: 'Basket created', variant: 'success' });
      onOpenChange(false);
      onCreated(r.basket.id);
    } catch (err) { toast({ title: 'Could not create basket', description: (err as Error).message, variant: 'error' }); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={submit} className="grid gap-3">
          <DialogHeader><DialogTitle>New basket</DialogTitle><DialogDescription>A synthetic ETF: target weights must sum to 100%.</DialogDescription></DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="bk-name">Name</Label><Input id="bk-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></div>
          <div className="grid gap-1.5"><Label htmlFor="bk-desc">Description</Label><Input id="bk-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} /></div>
          <div className="grid gap-1.5"><Label htmlFor="bk-thesis">Thesis (optional)</Label><Textarea id="bk-thesis" value={thesis} onChange={(e) => setThesis(e.target.value)} rows={2} maxLength={4000} /></div>
          <WeightsEditor rows={rows} onChange={setRows} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !v.ok || !name.trim()}>{busy ? 'Creating…' : 'Create basket'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
