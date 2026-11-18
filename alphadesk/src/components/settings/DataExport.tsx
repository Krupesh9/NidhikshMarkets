'use client';
import * as React from 'react';
import { Download, HardDriveDownload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';

/** Export my data as JSON (GET /api/me/export). */
export function DataExport() {
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/me/export', { cache: 'no-store' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'pulse-my-data.json';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: 'Export ready', description: name, variant: 'success' });
    } catch (e) {
      toast({ title: 'Export failed', description: (e as Error).message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card id="data" className="scroll-mt-28">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><HardDriveDownload className="h-4 w-4 text-muted" aria-hidden /> Your data</CardTitle>
        <CardDescription>Download everything you created as JSON: watchlists, saved screens, portfolios and positions, baskets and holdings, AI research threads and notes. Credentials and audit logs are never included.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={run} disabled={busy}><Download aria-hidden /> {busy ? 'Preparing…' : 'Export my data (JSON)'}</Button>
      </CardContent>
    </Card>
  );
}
