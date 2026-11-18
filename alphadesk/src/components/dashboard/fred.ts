import 'server-only';
import { cache } from '@/lib/cache';
import { log } from '@/lib/log';

export interface Yield { series: string; value: number; change: number; date: string }

/** Latest two observations of a FRED daily series (e.g. DGS10). Null when FRED_API_KEY is missing or the call fails. */
export async function fredLatest(series: string): Promise<Yield | null> {
  const key = process.env.FRED_API_KEY;
  if (!key) return null;
  return cache.wrap(`fred:${series}`, async () => {
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(series)}&api_key=${key}&file_type=json&sort_order=desc&limit=10`;
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { observations?: { date: string; value: string }[] };
      const obs = (j.observations ?? []).map((o) => ({ date: o.date, v: Number(o.value) })).filter((o) => Number.isFinite(o.v));
      if (!obs.length) return null;
      return { series, value: obs[0].v, change: obs[1] ? obs[0].v - obs[1].v : 0, date: obs[0].date };
    } catch (e) {
      log.debug('fred.failed', { series, err: (e as Error).message });
      return null;
    }
  }, 60 * 60_000);
}
