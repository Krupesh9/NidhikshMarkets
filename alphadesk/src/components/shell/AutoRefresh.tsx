'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Re-renders the current server page on an interval (only while the tab is visible) so quotes, news and
 * ratings stay fresh. Server-side caches decide how often providers are actually called.
 */
export function AutoRefresh({ everyMs = 60_000, className }: { everyMs?: number; className?: string }) {
  const router = useRouter();
  const [at, setAt] = React.useState<Date | null>(null);
  const [pending, start] = React.useTransition();
  const refresh = React.useCallback(() => start(() => { router.refresh(); setAt(new Date()); }), [router]);

  React.useEffect(() => {
    setAt(new Date());
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const id = window.setInterval(tick, everyMs);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [everyMs, refresh]);

  const mins = Math.round(everyMs / 60_000);
  return (
    <button type="button" onClick={refresh} disabled={pending} title="Refresh now"
      className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted hover:bg-panel-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', className)}>
      <RefreshCw className={cn('h-3 w-3', pending && 'animate-spin')} aria-hidden />
      <span suppressHydrationWarning>{at ? `Updated ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Live'} · auto {mins < 1 ? `${Math.round(everyMs / 1000)}s` : `${mins} min`}</span>
    </button>
  );
}
