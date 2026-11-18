import 'server-only';
import { screenRepo } from '@/lib/repos';
import type { Facets, FacetList, ScreenResultRow, ScreenRunResponse } from './types';
export type { Facets, ScreenResultRow, ScreenRunResponse } from './types';
import { capFilters, runScreen, screenerLimits, type FilterState, type SortSpec } from './engine';
import { defaultList, sanitizeGroups, sanitizeTickers } from './list';
import { getLiveRows } from './live';

function facetsOf(rows: ScreenResultRow[]): Facets {
  const count = (pick: (r: ScreenResultRow) => string | null | undefined): FacetList => {
    const m = new Map<string, number>();
    rows.forEach((r) => { const v = pick(r); if (v && v !== '—') m.set(v, (m.get(v) ?? 0) + 1); });
    return [...m.entries()].map(([value, c]) => ({ value, count: c })).sort((a, b) => a.value.localeCompare(b.value));
  };
  return { sector: count((r) => r.sector), industry: count((r) => r.industry), country: count((r) => r.country), group: count((r) => r.group) };
}

/** The user's default list: watchlist (≥ 10 names) or watchlist + S&P 500 leaders. */
export async function defaultTickersFor(user: { id: string; orgId: string }): Promise<string[]> {
  const wl = await screenRepo.getWatchlist({ orgId: user.orgId, userId: user.id }).catch(() => null);
  return defaultList(wl?.symbols ?? []);
}

export interface RunInput {
  filters: FilterState;
  sort: SortSpec;
  /** explicit list; null/undefined = default list */
  tickers?: string[] | null;
  groups?: Record<string, string>;
  limit?: number;
}

/** Screen a ticker list for a plan. Filters beyond the plan cap are dropped (reported), rows are capped. */
export async function runScreenForPlan(user: { id: string; orgId: string; plan: string }, input: RunInput): Promise<ScreenRunResponse> {
  const lim = screenerLimits(user.plan);
  const { applied, dropped } = capFilters(input.filters, lim.maxFilters);
  const defaults = await defaultTickersFor(user);
  const explicit = input.tickers ? sanitizeTickers(input.tickers) : null;
  const tickers = explicit ?? defaults;
  const groups = sanitizeGroups(input.groups ?? {}, tickers);
  const live = await getLiveRows(tickers, groups);
  const full = runScreen(live.rows, applied, input.sort);
  const take = Math.min(input.limit ?? Infinity, lim.maxRows);
  const rows = full.rows.slice(0, take);
  return {
    rows,
    matched: full.matched,
    universe: full.universe,
    returned: rows.length,
    applied,
    droppedFilters: dropped,
    rowCapped: full.matched > lim.maxRows && (input.limit ?? Infinity) > lim.maxRows,
    limits: { maxFilters: Number.isFinite(lim.maxFilters) ? lim.maxFilters : null, maxRows: Number.isFinite(lim.maxRows) ? lim.maxRows : null },
    facets: facetsOf(live.rows),
    meta: live.meta,
    cached: live.cached,
    list: { tickers, isDefault: !explicit },
    defaultTickers: defaults,
    pending: live.pending,
  };
}
