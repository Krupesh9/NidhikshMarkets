'use client';
import * as React from 'react';
import type { Quote } from '@/lib/data/types';

/** Poll /api/market/quotes for a ticker list (default every 30s). */
export function useQuotes(tickers: string[], intervalMs = 30_000) {
  const key = tickers.join(',');
  const [quotes, setQuotes] = React.useState<Record<string, Quote>>({});
  const [isMock, setIsMock] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    if (!key) { setLoading(false); return; }
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/market/quotes?tickers=${encodeURIComponent(key)}`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as { data: Quote[]; meta: { isMock: boolean } };
        if (!alive) return;
        setQuotes(Object.fromEntries(j.data.map((q) => [q.ticker, q])));
        setIsMock(j.meta.isMock);
      } catch { /* ignore */ } finally { if (alive) setLoading(false); }
    };
    load();
    const id = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [key, intervalMs]);
  return { quotes, isMock, loading };
}
