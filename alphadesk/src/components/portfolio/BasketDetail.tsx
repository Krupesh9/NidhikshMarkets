'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/ui/sparkline';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { MockBanner } from '@/components/shell/MockBanner';
import { PageHeader } from '@/components/shell/PageHeader';
import { useRightRail } from '@/components/shell/RightRail';
import { ShareButton } from '@/components/sharing/ShareButton';
import type { BasketRebalanceResponse } from '@/lib/analytics/server';
import type { BasketDTO } from '@/lib/repos/types';
import { cn } from '@/lib/utils';
import { DriftBars, ValueLine } from './charts';
import { Methodology } from './Methodology';
import { api, num, pct, tone, usd, usdCompact } from './format';
import { rowsToHoldings, rowsValid, toRows, WeightsEditor, type WeightRow } from './WeightsEditor';

const SINCE = [['1M', 'Monthly (1M)'], ['3M', 'Quarterly (3M)'], ['6M', 'Semi-annual (6M)'], ['1Y', 'Annual (1Y)'], ['inception', 'Since inception']] as const;
const TOL = ['0.01', '0.02', '0.03', '0.05'];

export function BasketDetail({ initial }: { initial: BasketDTO }) {
  const router = useRouter();
  const rail = useRightRail();
  const [basket, setBasket] = React.useState(initial);
  const [since, setSince] = React.useState('3M');
  const [tol, setTol] = React.useState('0.02');
  const [mode, setMode] = React.useState<'band' | 'full'>('band');
  const [notional, setNotional] = React.useState('1000000');
  const [notionalInput, setNotionalInput] = React.useState('1000000');
  const [data, setData] = React.useState<BasketRebalanceResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState(false);
  const [rows, setRows] = React.useState<WeightRow[]>(toRows(initial.holdings));
  const [meta, setMeta] = React.useState({ name: initial.name, description: initial.description ?? '', thesis: initial.thesis ?? '' });
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const n = Math.max(1000, Number(notional) || 1_000_000);
      setData(await api<BasketRebalanceResponse>(`/api/baskets/${basket.id}/rebalance?since=${since}&tolerance=${tol}&mode=${mode}&notional=${n}`));
    } catch (e) { toast({ title: 'Could not compute drift', description: (e as Error).message, variant: 'error' }); }
    finally { setLoading(false); }
  }, [basket.id, since, tol, mode, notional]);
  React.useEffect(() => { void load(); }, [load, basket.updatedAt]);

  const v = rowsValid(rows);
  async function save() {
    if (!v.ok || !meta.name.trim()) return;
    setSaving(true);
    try {
      const r = await api<{ basket: BasketDTO }>(`/api/baskets/${basket.id}`, { method: 'PATCH', json: { name: meta.name.trim(), description: meta.description.trim() || null, thesis: meta.thesis.trim() || null, holdings: rowsToHoldings(rows) } });
      setBasket(r.basket); setRows(toRows(r.basket.holdings)); setEditing(false);
      toast({ title: 'Basket saved', variant: 'success' });
    } catch (e) { toast({ title: 'Save failed', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  }
  async function del() {
    if (!confirm(`Delete basket “${basket.name}”?`)) return;
    try { await api(`/api/baskets/${basket.id}`, { method: 'DELETE' }); router.push('/baskets'); } catch (e) { toast({ title: 'Delete failed', description: (e as Error).message, variant: 'error' }); }
  }

  const r = data?.result;
  const assumptions = data ? [
    `Synthetic basket: ${usd(data.notional)} notional struck at target weights on ${data.rebalanceDate} (assumed last ${SINCE.find((s) => s[0] === data.since)?.[1].toLowerCase() ?? data.since} rebalance) at that day's close; shares then held constant.`,
    `Drift = current weight − target weight. Tolerance band ±${pct(r!.tolerance, 0)} (absolute). ${mode === 'band' ? 'Band mode trades only names outside the band, funded pro-rata from in-band names so the basket stays fully invested.' : 'Full mode trades every name back to target.'}`,
    'Share counts are rounded toward zero to whole shares; residual cash is shown. No commissions, spreads, taxes or market impact are modelled.',
    'Suggested trades are research output only — Nidhiksh Pulse does not route or execute orders.',
  ] : [];
  const snapshot = () => ({
    name: basket.name, description: basket.description, thesis: basket.thesis, isMock: data?.meta.isMock,
    holdings: basket.holdings.map((h) => ({ ticker: h.ticker, targetWeight: h.targetWeight, rationale: h.rationale, sector: h.sector })),
    metrics: data ? { 'Return since rebalance': pct(data.basketReturn, 2, true), 'Max drift': pct(data.result.maxAbsDrift, 2), 'Names outside band': data.result.breaches, 'Suggested turnover': pct(data.result.turnover, 2) } : {},
  });

  return (
    <div className="space-y-4">
      <PageHeader title={basket.name} description={basket.description ?? undefined}
        actions={<>
          <Button variant="ghost" size="sm" disabled={!data} onClick={() => rail.open({ key: `bk-${basket.id}`, title: 'Methodology', content: <Methodology assumptions={assumptions} sources={data?.meta.sources} /> })}><BookOpen /> Methodology</Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing((e) => !e)} aria-expanded={editing}><Pencil /> {editing ? 'Close editor' : 'Edit weights'}</Button>
          <ShareButton itemType="basket" itemId={basket.id} title={basket.name} snapshot={snapshot} />
          <Button variant="ghost" size="icon-sm" onClick={del} aria-label="Delete basket"><Trash2 /></Button>
        </>}
      />
      {data && <MockBanner isMock={data.meta.isMock} provider={data.meta.providers.filter((p) => p !== 'Mock').join(' + ') || undefined} />}
      {basket.thesis && !editing && <Card className="p-3 text-sm"><span className="text-[11px] font-medium uppercase tracking-wide text-muted">Thesis · </span>{basket.thesis}</Card>}

      {editing && (
        <Card>
          <CardHeader><CardTitle>Edit basket</CardTitle><CardDescription>Target weights must sum to exactly 100% to save.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="b-name">Name</Label><Input id="b-name" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} maxLength={120} /></div>
              <div className="grid gap-1.5"><Label htmlFor="b-desc">Description</Label><Input id="b-desc" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} maxLength={1000} /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="b-thesis">Thesis</Label><Textarea id="b-thesis" rows={2} value={meta.thesis} onChange={(e) => setMeta({ ...meta, thesis: e.target.value })} maxLength={4000} /></div>
            <WeightsEditor rows={rows} onChange={setRows} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setRows(toRows(basket.holdings)); setEditing(false); }}>Cancel</Button>
              <Button onClick={save} disabled={saving || !v.ok || !meta.name.trim()}>{saving ? 'Saving…' : 'Save basket'}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1"><Label htmlFor="since">Last rebalance</Label>
            <Select value={since} onValueChange={setSince}><SelectTrigger id="since" className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger><SelectContent>{SINCE.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="grid gap-1"><Label htmlFor="tol">Tolerance band</Label>
            <Select value={tol} onValueChange={setTol}><SelectTrigger id="tol" className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger><SelectContent>{TOL.map((t) => <SelectItem key={t} value={t}>±{pct(Number(t), 0)}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="grid gap-1"><span className="text-xs font-medium text-muted" id="mode-l">Mode</span>
            <div role="group" aria-labelledby="mode-l" className="flex rounded-md border border-border p-0.5">
              {(['band', 'full'] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} className={cn('rounded px-2 py-1 text-xs font-medium', mode === m ? 'bg-panel-2 text-text' : 'text-muted hover:text-text')}>{m === 'band' ? 'Outside band' : 'Full rebalance'}</button>)}
            </div>
          </div>
          <div className="grid gap-1"><Label htmlFor="notional">Notional ($)</Label>
            <Input id="notional" value={notionalInput} onChange={(e) => setNotionalInput(e.target.value.replace(/[^\d]/g, ''))} onBlur={() => setNotional(notionalInput)} onKeyDown={(e) => e.key === 'Enter' && setNotional(notionalInput)} className="h-8 w-32 font-mono text-xs" inputMode="numeric" />
          </div>
        </div>
      </Card>

      {!data || !r ? (
        <div className="space-y-4" role="status" aria-label="Computing drift"><Skeleton className="h-20" /><div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div></div>
      ) : (
        <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi label="Basket value" value={usd(r.totalValue)} hint={`from ${usdCompact(data.notional)} on ${data.rebalanceDate}`} />
            <Kpi label="Return since rebalance" value={pct(data.basketReturn, 2, true)} cls={tone(data.basketReturn)} />
            <Kpi label="Max drift" value={pct(r.maxAbsDrift, 2)} cls={r.maxAbsDrift > r.tolerance ? 'text-warn' : ''} />
            <Kpi label="Outside band" value={`${r.breaches} / ${r.rows.length}`} cls={r.breaches ? 'text-warn' : 'text-up'} />
            <Kpi label="Suggested turnover" value={pct(r.turnover, 2)} hint={`${r.trades.length} trade${r.trades.length === 1 ? '' : 's'}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Current vs target</CardTitle><CardDescription>Bar = current weight · orange tick = target · shaded = ±{pct(r.tolerance, 0)} band</CardDescription></CardHeader>
              <CardContent><DriftBars rows={r.rows} tolerance={r.tolerance} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Rebalancing suggestions</CardTitle><CardDescription>Trades to restore targets{mode === 'band' ? ' for names outside the band' : ''} · research only, no orders are placed</CardDescription></CardHeader>
              <CardContent>
                {r.trades.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted">All holdings are within the ±{pct(r.tolerance, 0)} band — no rebalance suggested.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Ticker</TableHead><TableHead>Side</TableHead><TableHead numeric>Shares</TableHead><TableHead numeric>Notional</TableHead><TableHead numeric>Weight</TableHead><TableHead>Why</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {r.trades.map((t) => (
                        <TableRow key={t.ticker}>
                          <TableCell className="font-mono font-semibold">{t.ticker}</TableCell>
                          <TableCell className={t.action === 'BUY' ? 'text-up' : 'text-down'}>{t.action === 'BUY' ? 'Add' : 'Trim'}</TableCell>
                          <TableCell numeric>{num(t.shares, 0)}</TableCell>
                          <TableCell numeric>{usd(t.notional)}</TableCell>
                          <TableCell numeric className="text-xs">{pct(t.fromWeight)} → {pct(t.toWeight)}</TableCell>
                          <TableCell className="text-xs text-muted">{t.reason === 'drift' ? 'Outside band' : t.reason === 'funding' ? 'Funding' : 'To target'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <p className="mt-2 text-[11px] text-muted">Residual cash after whole-share rounding: {usd(r.cashResidual)}.</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <Card>
              <CardHeader><CardTitle>Value since rebalance</CardTitle></CardHeader>
              <CardContent><ValueLine data={data.performance} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Holdings</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Ticker</TableHead><TableHead numeric>Target</TableHead><TableHead numeric>Price</TableHead><TableHead numeric>Since rebal.</TableHead><TableHead>30d</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.holdings.map((h) => (
                      <TableRow key={h.ticker}>
                        <TableCell><Link href={`/company/${h.ticker}`} className="font-mono font-semibold text-info hover:underline">{h.ticker}</Link><div className="max-w-[220px] truncate text-[11px] text-muted" title={h.rationale ?? undefined}>{h.rationale ?? h.name ?? h.sector}</div></TableCell>
                        <TableCell numeric>{pct(h.targetWeight)}</TableCell>
                        <TableCell numeric>{num(h.price)}</TableCell>
                        <TableCell numeric className={tone(h.sinceReturn)}>{pct(h.sinceReturn, 1, true)}</TableCell>
                        <TableCell><Sparkline data={h.sparkline} width={72} height={22} label={`${h.ticker} 30-day trend`} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Methodology & assumptions</h2>
            <Methodology assumptions={assumptions} sources={data.meta.sources} />
          </Card>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, cls }: { label: string; value: string; hint?: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn('mt-1 font-mono text-lg font-semibold tabular-nums', cls)}>{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
