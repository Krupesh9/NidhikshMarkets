/** Wire types for the screener API. Pure (client-safe). */
import type { DataMeta, ScreenRow, SourceRef } from '@/lib/data/types';
import type { GateResult, Plan } from '@/lib/plans';
import type { FilterKey, FilterState } from './engine';

export interface ScreenResultRow extends ScreenRow { whyNowSources: SourceRef[] }
export interface Facets { sector: { value: string; count: number }[]; industry: { value: string; count: number }[]; country: { value: string; count: number }[] }

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
  updatedAt: string;
}
