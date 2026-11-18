import 'server-only';
import { cache } from '@/lib/cache';
import { getMarketData, resolveMockSource } from '@/lib/data';
import type { DataMeta, ScreenRow, SourceRef } from '@/lib/data/types';
import type { Facets, ScreenResultRow, ScreenRunResponse } from './types';
export type { Facets, ScreenResultRow, ScreenRunResponse } from './types';
import { capFilters, runScreen, screenCacheKey, screenerLimits, type FilterState, type SortSpec } from './engine';

const TTL = 5 * 60_000;

function resolveSource(id: string): SourceRef {
  return resolveMockSource(id) ?? { id, name: id, kind: 'mock' };
}

function facetsOf(rows: ScreenRow[]): Facets {
  const count = (pick: (r: ScreenRow) => string) => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(pick(r), (m.get(pick(r)) ?? 0) + 1));
    return [...m.entries()].map(([value, c]) => ({ value, count: c })).sort((a, b) => a.value.localeCompare(b.value));
  };
  return { sector: count((r) => r.sector), industry: count((r) => r.industry), country: count((r) => r.country) };
}

/** Universe rows enriched with resolved why-now sources. Cached 5 min (getScreenRows is itself cached by the data layer). */
async function universe(): Promise<{ rows: ScreenResultRow[]; meta: DataMeta; facets: Facets }> {
  return cache.wrap('screener:universe', async () => {
    const { data, meta } = await getMarketData().getScreenRows();
    const rows = data.map((r) => ({ ...r, whyNowSources: (r.whyNow?.sourceIds ?? []).map(resolveSource) }));
    return { rows, meta, facets: facetsOf(data) };
  }, TTL);
}

/** Run a screen for a plan. Filters beyond the plan cap are dropped (reported), rows are capped. */
export async function runScreenForPlan(plan: string, filters: FilterState, sort: SortSpec, limit?: number): Promise<ScreenRunResponse> {
  const lim = screenerLimits(plan);
  const { applied, dropped } = capFilters(filters, lim.maxFilters);
  const key = 'screener:run:' + screenCacheKey(applied, sort, 0);
  let cached = true;
  const u = await universe();
  const full = await cache.wrap(key, async () => {
    cached = false;
    return runScreen(u.rows, applied, sort);
  }, TTL);
  const take = Math.min(limit ?? Infinity, lim.maxRows);
  const rows = full.rows.slice(0, take);
  return {
    rows,
    matched: full.matched,
    universe: full.universe,
    returned: rows.length,
    applied,
    droppedFilters: dropped,
    rowCapped: full.matched > lim.maxRows && (limit ?? Infinity) > lim.maxRows,
    limits: { maxFilters: Number.isFinite(lim.maxFilters) ? lim.maxFilters : null, maxRows: Number.isFinite(lim.maxRows) ? lim.maxRows : null },
    facets: u.facets,
    meta: u.meta,
    cached,
  };
}
