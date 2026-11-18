/** Plan comparison + pricing math (pure; client-safe). Two plans: Free and Pro ($100/mo, stored as PRO_PLUS). */
import { PLAN_INFO, PLANS, formatLimit, type Feature, type Plan } from '@/lib/plans';

export function priceLabel(plan: Plan): string {
  const p = PLAN_INFO[plan];
  return p.priceMonthly === 0 ? '$0' : `$${p.priceMonthly.toLocaleString('en-US')}/mo`;
}

export interface PlanFeatureRow { label: string; values: Record<Plan, string | boolean> }

export function planComparisonRows(): PlanFeatureRow[] {
  const by = <T,>(f: (p: Plan) => T) => Object.fromEntries(PLANS.map((p) => [p, f(p)])) as Record<Plan, T>;
  const feat = (k: Feature) => by((p) => PLAN_INFO[p].features[k]);
  return [
    { label: 'Price chart (area/line, 1M–1Y), quote, P/E & EPS (TTM), market cap', values: by(() => true) },
    { label: 'News, filings list, calendar, watchlist, market charts', values: by(() => true) },
    { label: 'Company deep dives / day', values: by((p) => formatLimit(PLAN_INFO[p].limits.deepDivesPerDay)) },
    { label: 'Portfolio positions', values: by((p) => formatLimit(PLAN_INFO[p].limits.positions)) },
    { label: 'AI research assistant with citations', values: by((p) => (PLAN_INFO[p].limits.aiQueriesPerMonth === 0 ? false : formatLimit(PLAN_INFO[p].limits.aiQueriesPerMonth))) },
    { label: 'Advanced charts: indicators, candlesticks, 1D/1W, 5Y/MAX', values: feat('advancedCharts') },
    { label: 'Analyst research: ratings, targets, actions, consensus, Fwd EPS/P/E', values: feat('analystResearch') },
    { label: 'Financial statements and EV/EBITDA', values: feat('financials') },
    { label: 'Ownership: insiders (Form 4) and 13F holders', values: feat('ownership') },
    { label: 'Index holdings, sector weights, contribution', values: feat('marketHoldings') },
    { label: 'Sharing and export', values: feat('sharing') },
    { label: 'Team seats', values: by((p) => (PLAN_INFO[p].features.team ? String(PLAN_INFO[p].limits.seats) : false)) },
  ];
}

/** What changes when moving between plans (shown to the admin after changing a member's plan). */
export function planChangeSummary(from: Plan, to: Plan): string[] {
  if (from === to) return [];
  return to === 'PRO_PLUS'
    ? ['AI research, analyst data, financials, ownership and advanced charts unlocked', 'Unlimited deep dives and positions']
    : ['Premium sections locked', `Deep dives limited to ${PLAN_INFO.FREE.limits.deepDivesPerDay}/day, ${PLAN_INFO.FREE.limits.positions} positions`];
}

/** Usage meter fraction 0..1 (Infinity limit → 0, zero limit → 1 when any usage). */
export function usageFraction(used: number, limit: number): number {
  if (limit === Infinity) return 0;
  if (limit <= 0) return used > 0 ? 1 : 0;
  return Math.min(1, used / limit);
}

/** First day of next month (UTC) — when the monthly AI counter resets. */
export function nextResetDate(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
