'use client';
import * as React from 'react';
import type { UsageSnapshot } from '@/lib/usage-meter';

export type ApiUsageState = { data: UsageSnapshot | null; error: 'forbidden' | 'failed' | null; loading: boolean; refresh: () => void };

/** Polls GET /api/admin/usage (owner/ADMIN only) every `intervalMs` while `enabled` and the tab is visible. */
export function useApiUsage(enabled: boolean, intervalMs = 30_000): ApiUsageState {
  const [data, setData] = React.useState<UsageSnapshot | null>(null);
  const [error, setError] = React.useState<ApiUsageState['error']>(null);
  const [loading, setLoading] = React.useState(enabled);
  const stopped = React.useRef(false);

  const load = React.useCallback(async () => {
    if (stopped.current) return;
    try {
      const r = await fetch('/api/admin/usage', { cache: 'no-store' });
      if (r.status === 401 || r.status === 403) { stopped.current = true; setError('forbidden'); return; }
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as UsageSnapshot);
      setError(null);
    } catch {
      setError('failed');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    void load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, load]);

  return { data, error, loading, refresh: () => void load() };
}
