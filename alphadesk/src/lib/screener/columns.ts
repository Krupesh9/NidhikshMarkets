/** Column catalogue shared by the grid and exports. Pure. */
import type { LiveScreenRow } from './types';

export type ColumnFormat = 'text' | 'money' | 'bigMoney' | 'pct' | 'signedPct' | 'multiple' | 'score' | 'date' | 'list';

export interface ColumnDef {
  id: string;
  label: string;
  format: ColumnFormat;
  /** colour-code positive/negative */
  signed?: boolean;
  /** visible by default */
  default?: boolean;
  /** excel number format */
  numFmt?: string;
  /** header tooltip (e.g. why a column is empty) */
  note?: string;
  get: (r: LiveScreenRow) => string | number | null;
}

export const SCREEN_COLUMNS: ColumnDef[] = [
  { id: 'ticker', label: 'Ticker', format: 'text', default: true, get: (r) => r.ticker },
  { id: 'name', label: 'Name', format: 'text', default: true, get: (r) => r.name },
  { id: 'group', label: 'Group', format: 'text', default: true, note: 'Your own grouping for this list (set when adding a ticker)', get: (r) => r.group || null },
  { id: 'sector', label: 'Sector', format: 'text', default: true, get: (r) => r.sector },
  { id: 'industry', label: 'Industry', format: 'text', get: (r) => r.industry },
  { id: 'country', label: 'Country', format: 'text', get: (r) => r.country },
  { id: 'marketCap', label: 'Mkt cap', format: 'bigMoney', default: true, numFmt: '$#,##0.0,,,"B"', get: (r) => r.marketCap },
  { id: 'price', label: 'Price', format: 'money', default: true, numFmt: '$#,##0.00', get: (r) => r.price },
  { id: 'changePct', label: 'Chg %', format: 'signedPct', signed: true, default: true, numFmt: '+0.00"%";-0.00"%";0.00"%"', get: (r) => r.changePct },
  { id: 'sparkline', label: '30d', format: 'list', default: true, get: () => null },
  { id: 'pe', label: 'P/E', format: 'multiple', default: true, numFmt: '0.0"x"', get: (r) => r.pe },
  { id: 'evEbitda', label: 'EV/EBITDA', format: 'multiple', default: true, numFmt: '0.0"x"', get: (r) => r.evEbitda },
  { id: 'revenueGrowth', label: 'Rev growth', format: 'signedPct', signed: true, default: true, numFmt: '+0.0"%";-0.0"%";0.0"%"', get: (r) => r.revenueGrowth },
  { id: 'epsRevision30d', label: 'EPS rev 30d', format: 'signedPct', signed: true, default: true, note: 'From Alpha Vantage estimates already loaded on a company page (25 calls/day) — otherwise —', numFmt: '+0.0"%";-0.0"%";0.0"%"', get: (r) => r.epsRevision30d },
  { id: 'shortInterestPct', label: 'Short int %', format: 'pct', numFmt: '0.0"%"', note: 'No free data source for short interest — shows — until a feed is connected', get: (r) => r.shortInterestPct },
  { id: 'insiderBuying90d', label: 'Insider 90d', format: 'bigMoney', signed: true, default: true, numFmt: '$#,##0;[Red]-$#,##0', get: (r) => r.insiderBuying90d },
  { id: 'esgScore', label: 'ESG', format: 'score', numFmt: '0', note: 'No free data source for ESG scores — shows — until a feed is connected', get: (r) => r.esgScore },
  { id: 'nextEarnings', label: 'Next earnings', format: 'date', default: true, get: (r) => r.nextEarnings || null },
  { id: 'catalystFlags', label: 'Catalysts', format: 'list', default: true, get: (r) => r.catalystFlags.join(', ') || null },
  { id: 'whyNow', label: 'Why now', format: 'text', default: true, get: (r) => r.whyNow?.headline ?? null },
];

export const DEFAULT_COLUMNS = SCREEN_COLUMNS.filter((c) => c.default).map((c) => c.id);
export const COLUMN_BY_ID = Object.fromEntries(SCREEN_COLUMNS.map((c) => [c.id, c])) as Record<string, ColumnDef>;

export function formatBigMoney(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}
