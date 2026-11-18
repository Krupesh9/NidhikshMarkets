'use client';
import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/** Route-level error boundary: branded, no stack traces in production (Next only passes a digest). */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => { console.error('page.error', error.digest ?? error.message); }, [error]);
  return (
    <div role="alert" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-down/40 bg-down/10 text-down"><AlertTriangle className="h-5 w-5" aria-hidden /></span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">This view hit an unexpected error. Try again — if it keeps happening, share the reference below with the workspace owner.</p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-muted">Reference: {error.digest}</p>}
      <div className="mt-6 flex gap-2">
        <button type="button" onClick={reset} className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
          <RotateCcw className="h-4 w-4" aria-hidden /> Try again
        </button>
        <Link href="/dashboard" className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">Dashboard</Link>
      </div>
    </div>
  );
}
