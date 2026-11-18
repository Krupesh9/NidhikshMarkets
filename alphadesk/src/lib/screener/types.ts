/** Wire types for the screener API. Pure (client-safe). */
import type { DataMeta, ScreenRow, SourceRef } from '@/lib/data/types';
import type { GateResult, Plan } from '@/lib/plans';
import type { FilterKey, FilterState } from './engine';

/** Numeric ScreenRow fields that a live source may not have for a given ticker. */
export type NullableScreenField =
  | 'marketCap' | 'price' | 'changePct' | 'pe' | 'evEbitda' | 'revenueGrowth' | 'epsRevision30d'
  | 'shortInterestPct' | 'insiderBuying90d' | 'esgScore';

/**
 * Screener row built from live sources. Same shape as the shared `ScreenRow` but every metric can be null
 * (unavailable → shown as '—', excluded from numeric filters). A mock `ScreenRow` is assignable to it.
 */
export interface LiveScreenRow extends Omit<ScreenRow, NullableScreenField | 'sector'> {
  sector: string;
  marketCap: number | null;
  price: number | null;
  changePct: number | null;
  pe: number | null;
  evEbitda: number | null;
  revenueGrowth: number | null;
  epsRevision30d: number | null;
  shortInterestPct: number | null;
  insiderBuying90d: number | null;
  esgScore: number | null;
  /** user-defined group from the saved list (e.g. "Technology", "Index Fund") */
  group?: string | null;
  /** 'not_found' = no quote and no profile anywhere; 'partial' = some sources still loading (retry soon) */
  status?: 'ok' | 'partial' | 'not_found';
  /** exchange-traded fund (no company financials) */
  isEtf?: boolean;
}

export interface ScreenResultRow extends LiveScreenRow { whyNowSources: SourceRef[] }
export type FacetList = { value: string; count: number }[];
export interface Facets { sector: FacetList; industry: FacetList; country: FacetList; group: FacetList }

export interface ScreenRunResponse {
  rows: ScreenResultRow[];
  matched: number;
  universe: number;
  returned: number;
  applied: FilterState;
  droppedFilters: FilterKey[];
  rowCapped: boolean;
  limits: { maxFilters: number | null; maxRows: number | null };
  facets: Facets;
  meta: DataMeta;
  cached: boolean;
  /** the ticker list that was screened (explicit list, or the default list when none was sent) */
  list: { tickers: string[]; isDefault: boolean };
  /** the user's default list (watchlist, topped up with S&P 500 leaders when short) */
  defaultTickers: string[];
  /** tickers whose data is still loading in the background (refresh shortly) */
  pending: string[];
}

export interface ScreenRunApiResponse extends ScreenRunResponse {
  plan: Plan;
  gates: { export: GateResult; savedScreens: GateResult; sharing: GateResult };
}

export interface SavedScreenWire {
  id: string;
  name: string;
  description: string | null;
  filters: FilterState;
  columns: string[];
  sort: { id: string; desc: boolean }[];
  /** null = old screen without a list → default list */
  tickers: string[] | null;
  groups: Record<string, string>;
  updatedAt: string;
}
