// Client-safe model types for the "Fundamental values" section (types only).
import type { SourceRef } from '@/lib/data/types';
import type { DcfInputs, DcfParams, DcfResult, PegBand } from './formulas';

export type FundamentalsKind = 'company' | 'financial' | 'fund' | 'unavailable';
export type GrowthBasis = 'consensus' | 'historical-eps' | 'historical-fcf' | 'none';

export interface RateInput {
  /** percent */
  value: number | null;
  date: string | null;
  series: string;
  label: string;
  source: SourceRef;
}

export interface GrowthEstimate {
  /** capped value used by the formulas (percent) */
  value: number | null;
  /** uncapped estimate (percent) */
  raw: number | null;
  capped: boolean;
  basis: GrowthBasis;
  /** e.g. "Consensus FY2028 EPS $10.60 vs TTM EPS $8.98, 2-yr CAGR" */
  label: string;
  source: SourceRef;
}

export interface NotMeaningful { status: 'nm'; reason: string }

export interface GrahamModel {
  status: 'ok' | 'nm';
  reason?: string;
  eps: number | null;
  epsBasis: string;
  /** growth used in the formula (percent; floored at 0 for Graham) */
  g: number | null;
  /** AAA yield (percent) */
  y: number | null;
  value: number | null;
  grahamNumber: number | null;
  bvps: number | null;
  marginOfSafety: number | null;
  upsidePct: number | null;
  source: SourceRef;
  numberSource: SourceRef;
}

export interface DcfModel {
  status: 'ok' | 'nm';
  reason?: string;
  inputs: DcfInputs | null;
  baseFcfBasis: string;
  defaults: DcfParams;
  /** params actually used for `result` (defaults unless overridden via the API) */
  params: DcfParams;
  result: DcfResult | null;
  beta: { value: number; basis: string; source: SourceRef };
  erp: number;
  source: SourceRef;
  balanceSource: SourceRef;
}

export interface PegModel {
  status: 'ok' | 'nm';
  reason?: string;
  value: number | null;
  pe: number | null;
  peBasis: string;
  growth: number | null;
  growthBasis: GrowthBasis;
  growthLabel: string;
  band: PegBand | null;
  source: SourceRef;
}

export interface RatioPoint {
  /** e.g. "FY2024" or "Now" */
  label: string;
  fiscalYear: number;
  periodEnd: string;
  value: number | null;
  /** inputs for tooltips */
  detail: string;
  negativeEquity?: boolean;
  source: SourceRef;
}

export interface PbModel {
  status: 'ok' | 'nm';
  reason?: string;
  value: number | null;
  bvps: number | null;
  equity: number | null;
  shares: number | null;
  asOf: string | null;
  history: RatioPoint[];
  source: SourceRef;
}

export interface DeModel {
  status: 'ok' | 'nm' | 'negative-equity';
  reason?: string;
  value: number | null;
  debt: number | null;
  equity: number | null;
  asOf: string | null;
  history: RatioPoint[];
  source: SourceRef;
}

export interface FundamentalsModel {
  ticker: string;
  name: string | null;
  kind: FundamentalsKind;
  /** why the section shows a not-applicable state (kind fund/unavailable) */
  reason?: string;
  asOf: string;
  isMock: boolean;
  providers: string[];
  price: number | null;
  priceSource: SourceRef;
  growth: GrowthEstimate;
  riskFree: RateInput;
  aaa: RateInput;
  graham: GrahamModel;
  dcf: DcfModel;
  peg: PegModel;
  pb: PbModel;
  de: DeModel;
  /** methodology / source list for the footer */
  sources: SourceRef[];
  notes: string[];
}
