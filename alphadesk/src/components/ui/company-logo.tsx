'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

const failed = new Set<string>(); // remember misses for the session so lists don't re-request

/** Company icon from /api/logo/:ticker with a monogram fallback. */
export function CompanyLogo({ ticker, size = 28, className }: { ticker: string; size?: number; className?: string }) {
  const [broken, setBroken] = React.useState(() => failed.has(ticker));
  const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) };
  const box = cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border', className);
  if (broken) {
    return <span className={cn(box, 'bg-panel-2 font-mono font-bold text-muted')} style={style} aria-hidden>{ticker.replace(/[^A-Z]/g, '').slice(0, 2)}</span>;
  }
  return (
    <span className={cn(box, 'bg-white')} style={style} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/logo/${encodeURIComponent(ticker)}`} alt="" width={size} height={size} loading="lazy" decoding="async" className="h-full w-full object-contain"
        onError={() => { failed.add(ticker); setBroken(true); }} />
    </span>
  );
}
