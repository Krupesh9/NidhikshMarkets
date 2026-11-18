/** Calendar event model shared by the server lib, API and client UI (no server imports). */

export type CalendarCategory = 'earnings' | 'inflation' | 'jobs' | 'fed' | 'growth' | 'market';
export type Importance = 'high' | 'medium' | 'low';

export interface CalendarEvent {
  id: string;
  /** ET calendar date YYYY-MM-DD */
  date: string;
  /** display time, e.g. "8:30 AM ET", "After close" */
  time?: string;
  category: CalendarCategory;
  /** finer kind for icons: cpi, ppi, jobs, claims, jolts, fomc, minutes, gdp, pce, retail, sentiment, ip, earnings, holiday, early-close */
  kind: string;
  title: string;
  detail?: string;
  importance: Importance;
  ticker?: string;
  /** earnings: ticker is on the user's watchlist */
  inWatchlist?: boolean;
  /** weekly / low-signal events the UI collapses by default */
  recurring?: boolean;
  /** date is an estimate (not confirmed by the issuer / agency) */
  estimated?: boolean;
  source: { name: string; url?: string };
}

export interface CalendarSourceStatus { id: string; name: string; ok: boolean; count: number; note?: string }

export interface CalendarResult {
  events: CalendarEvent[];
  meta: { from: string; to: string; asOf: string; today: string; sources: CalendarSourceStatus[] };
}

export const CATEGORY_LABEL: Record<CalendarCategory, string> = {
  earnings: 'Earnings', inflation: 'Inflation', jobs: 'Jobs', fed: 'Fed', growth: 'Growth', market: 'Market',
};
