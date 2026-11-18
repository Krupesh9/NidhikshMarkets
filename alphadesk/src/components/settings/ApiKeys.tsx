'use client';
import * as React from 'react';
import { CheckCircle2, KeyRound, PlugZap, Trash2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export interface KeyRow { provider: 'anthropic' | 'gemini' | 'polygon'; label: string; purpose: string; configured: boolean; source: 'user' | 'env' | null; masked: string | null; updatedAt: string | null }
interface TestOut { ok: boolean; configured: boolean; message: string; latencyMs?: number; source?: string }

const PLACEHOLDER: Record<KeyRow['provider'], string> = { anthropic: 'sk-ant-…', gemini: 'AIza…', polygon: 'Massive / Polygon API key' };

async function call(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.details?.[0]?.message ?? j?.error?.message ?? `HTTP ${r.status}`);
  return j;
}

function KeyItem({ row, onKeys }: { row: KeyRow; onKeys: (k: KeyRow[]) => void }) {
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState<'save' | 'test' | 'delete' | null>(null);
  const [test, setTest] = React.useState<TestOut | null>(null);
  const id = `key-${row.provider}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy('save');
    try {
      const j = await call('/api/settings/keys', { method: 'PUT', body: JSON.stringify({ provider: row.provider, key: value.trim() }) });
      setValue('');
      setTest(null);
      onKeys(j.keys);
      toast({ title: `${row.label} key saved`, description: `Stored encrypted (AES-256-GCM) as ${j.masked}.`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Key not saved', description: (err as Error).message, variant: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const runTest = async () => {
    setBusy('test');
    try {
      setTest(await call('/api/settings/keys/test', { method: 'POST', body: JSON.stringify({ provider: row.provider }) }));
    } catch (err) {
      setTest({ ok: false, configured: row.configured, message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete your saved ${row.label} key?`)) return;
    setBusy('delete');
    try {
      const j = await call(`/api/settings/keys?provider=${row.provider}`, { method: 'DELETE' });
      setTest(null);
      onKeys(j.keys);
      toast({ title: `${row.label} key deleted`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Delete failed', description: (err as Error).message, variant: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{row.label}</div>
          <div className="text-[11px] text-muted">{row.purpose}</div>
        </div>
        <div className="flex items-center gap-2">
          {row.masked ? <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-xs">{row.masked}</code> : null}
          {row.source === 'user' ? <Badge variant="up">Your key</Badge> : row.source === 'env' ? <Badge variant="info">Server env</Badge> : <Badge variant="outline">Not configured · mock fallback</Badge>}
        </div>
      </div>
      <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <Label htmlFor={id} className="sr-only">{row.label} API key</Label>
          <Input id={id} type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder={row.source === 'user' ? 'Replace key…' : PLACEHOLDER[row.provider]} className="font-mono text-xs" />
        </div>
        <Button type="submit" size="sm" disabled={!value.trim() || busy !== null}><KeyRound aria-hidden /> {busy === 'save' ? 'Saving…' : row.source === 'user' ? 'Replace' : 'Save'}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={runTest} disabled={busy !== null}><PlugZap aria-hidden /> {busy === 'test' ? 'Testing…' : 'Test connection'}</Button>
        {row.source === 'user' && <Button type="button" size="sm" variant="ghost" onClick={remove} disabled={busy !== null} aria-label={`Delete ${row.label} key`}><Trash2 aria-hidden /> Delete</Button>}
      </form>
      {test && (
        <p role="status" className={cn('mt-2 flex items-start gap-1.5 text-xs', test.ok ? 'text-up' : test.configured ? 'text-down' : 'text-muted')}>
          {test.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> : <XCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span>{test.message}{test.source ? ` (using ${test.source === 'user' ? 'your key' : 'server env key'})` : ''}</span>
        </p>
      )}
    </div>
  );
}

export function ApiKeys({ initial }: { initial: KeyRow[] }) {
  const [keys, setKeys] = React.useState(initial);
  return (
    <Card id="keys" className="scroll-mt-16">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-muted" aria-hidden /> AI provider &amp; data keys</CardTitle>
        <CardDescription>
          Keys are encrypted with AES-256-GCM before storage and never sent back to the browser — only the last 4 characters are shown.
          Your key takes precedence over the server&apos;s env key. Without any key the app uses the mock AI provider and demo data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {keys.map((k) => <KeyItem key={k.provider} row={k} onKeys={setKeys} />)}
      </CardContent>
    </Card>
  );
}
