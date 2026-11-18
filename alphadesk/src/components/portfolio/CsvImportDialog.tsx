'use client';
/** CSV import: paste or upload → instant client-side preview (same parser as the server) → server dry-run gate → commit. */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, FileUp, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { UpgradeHint } from '@/components/shell/UpgradeHint';
import { useCurrentUser } from '@/components/shell/UserContext';
import { CSV_TEMPLATE, mergeCsvRows, parsePositionsCsv } from '@/lib/analytics/csv';
import { newTickerCount, positionsGate } from '@/lib/analytics/limits';
import { api, num, pct } from './format';

export function CsvImportDialog({ open, onOpenChange, portfolio, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** import into an existing portfolio; otherwise a new one is created */
  portfolio?: { id: string; name: string; tickers: string[] };
  onDone?: (portfolioId: string) => void;
}) {
  const { user } = useCurrentUser();
  const router = useRouter();
  const [text, setText] = React.useState('');
  const [name, setName] = React.useState('');
  const [mode, setMode] = React.useState<'replace' | 'append'>('replace');
  const [busy, setBusy] = React.useState(false);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (!open) { setText(''); setName(''); setJobId(null); setBusy(false); } }, [open]);

  const parsed = React.useMemo(() => (text.trim() ? parsePositionsCsv(text) : null), [text]);
  const rows = React.useMemo(() => (parsed ? mergeCsvRows(parsed.rows) : []), [parsed]);
  const have = portfolio && mode === 'append' ? portfolio.tickers : [];
  const gate = positionsGate(user, have.length, newTickerCount(have, rows.map((r) => r.ticker)));

  // poll background job
  React.useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      try {
        const j = await api<{ status: string; portfolioId?: string; imported?: number; error?: string }>(`/api/portfolios/import?jobId=${jobId}`);
        if (j.status === 'done') {
          clearInterval(t);
          toast({ title: `Imported ${j.imported} rows`, variant: 'success' });
          onOpenChange(false);
          onDone?.(j.portfolioId!);
          router.refresh();
        } else if (j.status === 'failed') {
          clearInterval(t);
          setBusy(false); setJobId(null);
          toast({ title: 'Import failed', description: j.error, variant: 'error' });
        }
      } catch { /* keep polling */ }
    }, 1200);
    return () => clearInterval(t);
  }, [jobId, onDone, onOpenChange, router]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 2_000_000) { toast({ title: 'File too large', description: 'Maximum 2 MB.', variant: 'error' }); return; }
    setText(await f.text());
    if (!name && !portfolio) setName(f.name.replace(/\.csv$/i, ''));
  }

  async function submit() {
    if (!parsed) return;
    setBusy(true);
    try {
      const r = await api<{ status: string; portfolioId?: string; jobId?: string; imported?: number }>('/api/portfolios/import', {
        method: 'POST',
        json: { csv: text, portfolioId: portfolio?.id, name: portfolio ? undefined : name.trim() || 'Imported portfolio', mode, skipInvalid: parsed.errors.length > 0 },
      });
      if (r.status === 'queued' && r.jobId) { setJobId(r.jobId); return; }
      toast({ title: `Imported ${r.imported} position${r.imported === 1 ? '' : 's'}`, variant: 'success' });
      onOpenChange(false);
      onDone?.(r.portfolioId!);
      router.refresh();
    } catch (e) {
      toast({ title: 'Import failed', description: (e as Error).message, variant: 'error' });
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{portfolio ? `Import positions into ${portfolio.name}` : 'Import portfolio from CSV'}</DialogTitle>
          <DialogDescription>
            Columns: <code className="font-mono">ticker,quantity,cost_basis[,target_weight]</code>. Negative quantity = short. Weights as 0.05, 5 or 5%.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {!portfolio && (
            <div className="grid gap-1.5">
              <Label htmlFor="imp-name">Portfolio name</Label>
              <Input id="imp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q4 Pairs Book" maxLength={120} />
            </div>
          )}
          {portfolio && (
            <fieldset className="flex gap-4 text-sm">
              <legend className="sr-only">Import mode</legend>
              {(['replace', 'append'] as const).map((m) => (
                <label key={m} className="flex cursor-pointer items-center gap-1.5">
                  <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="accent-[rgb(var(--accent))]" />
                  {m === 'replace' ? 'Replace all positions' : 'Merge into existing'}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><FileUp /> Choose CSV file</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setText(CSV_TEMPLATE)}>Use sample</Button>
            <span className="text-xs text-muted">or paste below</span>
          </div>
          <Textarea aria-label="CSV contents" value={text} onChange={(e) => setText(e.target.value)} rows={5} className="font-mono text-xs" placeholder={CSV_TEMPLATE} />

          {parsed && (
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-3 text-xs text-muted">
                <span>{parsed.totalRows} rows</span>
                <span className="text-up">{parsed.rows.length} valid</span>
                {parsed.errors.length > 0 && <span className="text-down">{parsed.errors.length} error{parsed.errors.length === 1 ? '' : 's'}</span>}
                {parsed.warnings.length > 0 && <span className="text-warn">{parsed.warnings.length} warning{parsed.warnings.length === 1 ? '' : 's'}</span>}
                <span>→ {rows.length} position{rows.length === 1 ? '' : 's'} after merging duplicates</span>
                {parsed.totalRows > 250 && <span className="text-info">Large file: imported in the background</span>}
              </div>
              {(parsed.errors.length > 0 || parsed.warnings.length > 0) && (
                <ul className="max-h-28 space-y-0.5 overflow-auto rounded-md border border-border bg-panel-2 p-2 text-xs scrollbar-thin" aria-label="Row errors and warnings">
                  {parsed.errors.map((e, i) => (
                    <li key={`e${i}`} className="flex gap-2 text-down"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />Line {e.line} · {e.field}: {e.message}{e.value ? ` (“${e.value}”)` : ''}</li>
                  ))}
                  {parsed.warnings.map((e, i) => <li key={`w${i}`} className="text-warn">Line {e.line}: {e.message}</li>)}
                </ul>
              )}
              {rows.length > 0 && (
                <div className="max-h-56 overflow-auto rounded-md border border-border scrollbar-thin">
                  <Table>
                    <TableHeader><TableRow><TableHead>Ticker</TableHead><TableHead numeric>Quantity</TableHead><TableHead numeric>Cost basis</TableHead><TableHead numeric>Target wt</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {rows.slice(0, 100).map((r) => (
                        <TableRow key={r.ticker}>
                          <TableCell className="font-mono font-semibold">{r.ticker}</TableCell>
                          <TableCell numeric className={r.quantity < 0 ? 'text-down' : ''}>{num(r.quantity, 0)}</TableCell>
                          <TableCell numeric>{num(r.costBasis)}</TableCell>
                          <TableCell numeric>{r.targetWeight == null ? '—' : pct(r.targetWeight)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {rows.length > 100 && <p className="p-2 text-xs text-muted">…and {rows.length - 100} more</p>}
                </div>
              )}
              {!gate.allowed && <UpgradeHint gate={gate} />}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !rows.length || !gate.allowed}>
            <Upload /> {jobId ? 'Importing in background…' : busy ? 'Importing…' : parsed?.errors.length ? `Import ${rows.length} valid row${rows.length === 1 ? '' : 's'}` : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
