'use client';
import * as React from 'react';
import { RefreshCw, ScrollText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface AuditItem { id: string; action: string; target: string | null; userName: string; meta: Record<string, unknown>; correlationId: string | null; createdAt: string }

const FILTERS = [
  { v: '', label: 'All' },
  { v: 'ai', label: 'AI queries' },
  { v: 'data', label: 'Data access' },
  { v: 'share', label: 'Sharing' },
  { v: 'settings', label: 'Settings' },
  { v: 'team', label: 'Team' },
] as const;

const tone = (a: string) => (a.startsWith('ai') ? 'info' : a.startsWith('data') ? 'default' : a.startsWith('share') ? 'accent' : a.startsWith('settings') || a.startsWith('team') ? 'warn' : 'outline') as 'info' | 'default' | 'accent' | 'warn' | 'outline';

function metaSummary(m: Record<string, unknown>): string {
  const parts = Object.entries(m ?? {}).filter(([k]) => k !== 'method').slice(0, 4).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return parts.join(' · ');
}

export function AuditLog({ initial }: { initial: AuditItem[] }) {
  const [items, setItems] = React.useState(initial);
  const [filter, setFilter] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async (f: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/settings/audit?take=100${f ? `&action=${encodeURIComponent(f)}` : ''}`, { cache: 'no-store' });
      if (r.ok) setItems((await r.json()).items);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <Card id="audit" className="scroll-mt-16">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><ScrollText className="h-4 w-4 text-muted" aria-hidden /> Audit log</CardTitle>
          <CardDescription>Recent data access and AI queries across your organisation — who, what, when. Admins only.</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => load(filter)} disabled={loading} aria-label="Refresh audit log"><RefreshCw className={cn(loading && 'animate-spin')} aria-hidden /> Refresh</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div role="tablist" aria-label="Filter audit events" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.v} role="tab" aria-selected={filter === f.v} onClick={() => { setFilter(f.v); load(f.v); }}
              className={cn('rounded border px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', filter === f.v ? 'border-info bg-info/10 text-info' : 'border-border text-muted hover:text-text')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="max-h-[420px] overflow-auto rounded-md border border-border scrollbar-thin">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel-2 text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">When</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Who</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Action</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Target</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-3 py-2"><Skeleton className="h-4 w-full" /></td></tr>)
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No events for this filter yet. Run an AI query or open a company page to generate some.</td></tr>
              ) : (
                items.map((i) => (
                  <tr key={i.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-muted" title={i.correlationId ?? undefined}>{new Date(i.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{i.userName}</td>
                    <td className="px-3 py-1.5"><Badge variant={tone(i.action)} className="font-mono">{i.action}</Badge></td>
                    <td className="max-w-[220px] truncate px-3 py-1.5 font-mono" title={i.target ?? ''}>{i.target ?? '—'}</td>
                    <td className="max-w-[260px] truncate px-3 py-1.5 text-muted" title={metaSummary(i.meta)}>{metaSummary(i.meta) || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
