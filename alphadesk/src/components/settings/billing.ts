/** Plan comparison + pricing math (pure; client-safe). */
import { PLAN_INFO, PLANS, formatLimit, type Plan } from '@/lib/plans';

export type BillingCycle = 'monthly' | 'yearly';

/** Annual savings vs paying monthly for 12 months, computed from the plan constants (Pro: 12×50−500 = $100). */
export function yearlySavings(plan: Plan): number {
  const p = PLAN_INFO[plan];
  return Math.max(0, p.priceMonthly * 12 - p.priceYearly);
}

export function priceLabel(plan: Plan, cycle: BillingCycle): string {
  const p = PLAN_INFO[plan];
  if (p.priceMonthly === 0) return '$0';
  return cycle === 'monthly' ? `$${p.priceMonthly.toLocaleString('en-US')}/mo` : `$${p.priceYearly.toLocaleString('en-US')}/yr`;
}

export function savingsLabel(plan: Plan): string | null {
  const s = yearlySavings(plan);
  return s > 0 ? `save $${s.toLocaleString('en-US')}` : null;
}

export interface PlanFeatureRow { label: string; values: Record<Plan, string | boolean> }

export function planComparisonRows(): PlanFeatureRow[] {
  const by = <T,>(f: (p: Plan) => T) => Object.fromEntries(PLANS.map((p) => [p, f(p)])) as Record<Plan, T>;
  return [
    { label: 'AI research queries / month', values: by((p) => (PLAN_INFO[p].limits.aiQueriesPerMonth === 0 ? false : formatLimit(PLAN_INFO[p].limits.aiQueriesPerMonth))) },
    { label: 'Company deep dives / day', values: by((p) => formatLimit(PLAN_INFO[p].limits.deepDivesPerDay)) },
    { label: 'Portfolio positions', values: by((p) => formatLimit(PLAN_INFO[p].limits.positions)) },
    { label: 'Workspaces', values: by((p) => formatLimit(PLAN_INFO[p].limits.workspaces)) },
    { label: 'Share notes, screens & portfolios', values: by((p) => PLAN_INFO[p].features.sharing) },
    { label: 'Custom basket sharing', values: by((p) => PLAN_INFO[p].features.customBasketSharing) },
    { label: 'Team seats', values: by((p) => (PLAN_INFO[p].features.team ? String(PLAN_INFO[p].limits.seats) : false)) },
    { label: 'Priority data refresh', values: by((p) => PLAN_INFO[p].features.priorityRefresh) },
    { label: 'Export', values: by((p) => PLAN_INFO[p].features.export) },
  ];
}

/** What changes when moving between plans (for the toggle confirmation copy). */
export function planChangeSummary(from: Plan, to: Plan): string[] {
  if (from === to) return [];
  const a = PLAN_INFO[from], b = PLAN_INFO[to];
  const out: string[] = [];
  if (a.limits.aiQueriesPerMonth !== b.limits.aiQueriesPerMonth) out.push(`AI queries: ${formatLimit(a.limits.aiQueriesPerMonth)} → ${formatLimit(b.limits.aiQueriesPerMonth)} / month`);
  if (a.limits.positions !== b.limits.positions) out.push(`Positions: ${formatLimit(a.limits.positions)} → ${formatLimit(b.limits.positions)}`);
  if (a.features.sharing !== b.features.sharing) out.push(b.features.sharing ? 'Sharing unlocked' : 'Sharing disabled (existing shares stay visible)');
  if (a.features.customBasketSharing !== b.features.customBasketSharing) out.push(b.features.customBasketSharing ? 'Basket sharing unlocked' : 'Basket sharing disabled');
  if (a.features.team !== b.features.team) out.push(b.features.team ? `Team seats: ${b.limits.seats}` : 'Team management disabled');
  return out;
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
