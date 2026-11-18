'use client';
/** Positions grid with inline-editable quantity / cost basis, weights, P&L and sparklines. */
import * as React from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkline } from '@/components/ui/sparkline';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { UpgradeHint } from '@/components/shell/UpgradeHint';
import { useCurrentUser } from '@/components/shell/UserContext';
import { positionsGate } from '@/lib/analytics/limits';
import type { AnalyzedPosition } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { api, num, pct, signedUsd, tone, usd } from './format';

type SortKey = 'ticker' | 'marketValue' | 'weight' | 'dayPct' | 'unrealizedPnl' | 'beta';

export function PositionsTable({ portfolioId, positions, onChanged }: { portfolioId: string; positions: AnalyzedPosition[]; onChanged: () => void }) {
  const { user } = useCurrentUser();
  const [sort, setSort] = React.useState<{ key: SortKey; desc: boolean }>({ key: 'marketValue', desc: true });
  const [gateMsg, setGateMsg] = React.useState<{ reason: string; upgradeTo?: 'PRO' | 'PRO_PLUS' } | null>(null);
  const sorted = React.useMemo(() => {
    const s = [...positions].sort((a, b) => {
      if (sort.key === 'ticker') return a.ticker.localeCompare(b.ticker);
      if (sort.key === 'marketValue') return Math.abs(a.marketValue) - Math.abs(b.marketValue);
      return (a[sort.key] as number) - (b[sort.key] as number);
    });
    return sort.desc ? s.reverse() : s;
  }, [positions, sort]);
  const gate = positionsGate(user, positions.length, 1);

  async function patch(id: string | undefined, body: Record<string, number>) {
    if (!id) return;
    try {
      await api(`/api/portfolios/${portfolioId}/positions/${id}`, { method: 'PATCH', json: body });
      onChanged();
    } catch (e) { toast({ title: 'Update failed', description: (e as Error).message, variant: 'error' }); }
  }
  async function remove(p: AnalyzedPosition) {
    if (!p.id || !confirm(`Remove ${p.ticker} from this portfolio?`)) return;
    try { await api(`/api/portfolios/${portfolioId}/positions/${p.id}`, { method: 'DELETE' }); onChanged(); }
    catch (e) { toast({ title: 'Delete failed', description: (e as Error).message, variant: 'error' }); }
  }

  const H = ({ k, children, numeric }: { k: SortKey; children: React.ReactNode; numeric?: boolean }) => (
    <TableHead numeric={numeric} aria-sort={sort.key === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button className="inline-flex items-center gap-0.5 uppercase hover:text-text" onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : true }))}>
        {children}{sort.key === k && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <H k="ticker">Ticker</H>
            <TableHead numeric>Qty</TableHead>
            <TableHead numeric>Cost</TableHead>
            <TableHead numeric>Price</TableHead>
            <H k="marketValue" numeric>Mkt value</H>
            <H k="weight" numeric>Weight</H>
            <H k="dayPct" numeric>Day</H>
            <H k="unrealizedPnl" numeric>Unreal. P&L</H>
            <H k="beta" numeric>Beta</H>
            <TableHead>30d</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((p) => (
            <TableRow key={p.ticker}>
              <TableCell>
                <Link href={`/company/${p.ticker}`} className="font-mono font-semibold text-info hover:underline">{p.ticker}</Link>
                {p.side === 'short' && <span className="ml-1 rounded bg-down/15 px-1 text-[10px] text-down">SHORT</span>}
                <div className="max-w-[160px] truncate text-[11px] text-muted">{p.sector}</div>
              </TableCell>
              <TableCell numeric><EditableNumber value={p.quantity} dp={0} label={`${p.ticker} quantity`} onSave={(v) => v !== 0 && patch(p.id, { quantity: v })} /></TableCell>
              <TableCell numeric><EditableNumber value={p.costBasis} dp={2} min={0} label={`${p.ticker} cost basis`} onSave={(v) => patch(p.id, { costBasis: v })} /></TableCell>
              <TableCell numeric>{num(p.price)}</TableCell>
              <TableCell numeric className={p.marketValue < 0 ? 'text-down' : ''}>{usd(p.marketValue)}</TableCell>
              <TableCell numeric>{pct(p.weight, 1)}</TableCell>
              <TableCell numeric className={tone(p.dayPct * Math.sign(p.quantity))}>{pct(p.dayPct, 2, true)}</TableCell>
              <TableCell numeric className={tone(p.unrealizedPnl)}>{signedUsd(p.unrealizedPnl)}<div className="text-[10px]">{pct(p.unrealizedPct, 1, true)}</div></TableCell>
              <TableCell numeric title={p.betaSource === 'assumption' ? 'Reference beta (assumption)' : 'Regression beta vs benchmark'}>{num(p.beta)}{p.betaSource === 'assumption' && <sup className="text-warn">*</sup>}</TableCell>
              <TableCell><Sparkline data={p.sparkline} width={72} height={22} label={`${p.ticker} 30-day trend`} /></TableCell>
              <TableCell><Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.ticker}`} onClick={() => remove(p)}><Trash2 /></Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <AddPositionRow portfolioId={portfolioId} disabled={!gate.allowed} onAdded={onChanged} onGate={setGateMsg} />
      {!gate.allowed && <UpgradeHint gate={gate} />}
      {gate.allowed && gateMsg && <UpgradeHint reason={gateMsg.reason} upgradeTo={gateMsg.upgradeTo} />}
      <p className="text-[11px] text-muted">Click a quantity or cost to edit (Enter to save, Esc to cancel). <sup className="text-warn">*</sup> reference beta — see methodology.</p>
    </div>
  );
}

function EditableNumber({ value, dp, label, onSave, min }: { value: number; dp: number; label: string; onSave: (v: number) => void; min?: number }) {
  const [editing, setEditing] = React.useState(false);
  const [v, setV] = React.useState(String(value));
  React.useEffect(() => setV(String(value)), [value]);
  if (!editing) {
    return (
      <button className="rounded px-1 font-mono tabular-nums hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-info" onClick={() => setEditing(true)} aria-label={`Edit ${label}: ${num(value, dp)}`}>
        {num(value, dp)}
      </button>
    );
  }
  const commit = () => {
    const n = Number(v.replace(/,/g, ''));
    setEditing(false);
    if (isFinite(n) && n !== value && (min == null || n >= min)) onSave(n);
    else setV(String(value));
  };
  return (
    <Input autoFocus aria-label={label} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} inputMode="decimal"
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setV(String(value)); setEditing(false); } }}
      className="ml-auto h-7 w-24 text-right font-mono text-xs" />
  );
}

function AddPositionRow({ portfolioId, disabled, onAdded, onGate }: { portfolioId: string; disabled: boolean; onAdded: () => void; onGate: (g: { reason: string; upgradeTo?: 'PRO' | 'PRO_PLUS' } | null) => void }) {
  const [t, setT] = React.useState('');
  const [q, setQ] = React.useState('');
  const [c, setC] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const quantity = Number(q.replace(/,/g, ''));
    const costBasis = Number(c.replace(/,/g, ''));
    if (!t.trim() || !isFinite(quantity) || quantity === 0 || !isFinite(costBasis) || costBasis < 0) { toast({ title: 'Enter ticker, non-zero quantity and cost basis', variant: 'error' }); return; }
    setBusy(true);
    try {
      await api(`/api/portfolios/${portfolioId}/positions`, { method: 'POST', json: { ticker: t.trim().toUpperCase(), quantity, costBasis } });
      setT(''); setQ(''); setC(''); onGate(null);
      onAdded();
    } catch (err) {
      const e2 = err as Error & { status?: number; details?: { upgradeTo?: 'PRO' | 'PRO_PLUS' } };
      if (e2.status === 402) onGate({ reason: e2.message, upgradeTo: e2.details?.upgradeTo });
      else toast({ title: 'Could not add position', description: e2.message, variant: 'error' });
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className={cn('flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-2', disabled && 'opacity-60')} aria-label="Add position">
      <Input aria-label="Ticker" placeholder="Ticker" value={t} onChange={(e) => setT(e.target.value.toUpperCase())} className="h-8 w-24 font-mono" maxLength={10} disabled={disabled} />
      <Input aria-label="Quantity (negative for short)" placeholder="Qty (−short)" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-28 font-mono" inputMode="decimal" disabled={disabled} />
      <Input aria-label="Cost basis per share" placeholder="Cost / sh" value={c} onChange={(e) => setC(e.target.value)} className="h-8 w-28 font-mono" inputMode="decimal" disabled={disabled} />
      <Button type="submit" size="sm" variant="secondary" disabled={busy || disabled}><Plus /> Add position</Button>
    </form>
  );
}
