/** Plan tiers, prices, limits and feature gates. Pure (no server deps) so client can render plan info. */
export type Plan = 'FREE' | 'PRO' | 'PRO_PLUS';
export type Role = 'ADMIN' | 'ANALYST' | 'VIEWER';
export const PLANS: Plan[] = ['FREE', 'PRO', 'PRO_PLUS'];

export interface PlanInfo {
  id: Plan;
  label: string;
  priceMonthly: number;
  priceYearly: number;
  limits: {
    /** AI queries per calendar month; Infinity = unlimited; 0 = no AI */
    aiQueriesPerMonth: number;
    /** company deep dives per day */
    deepDivesPerDay: number;
    positions: number;
    workspaces: number;
    seats: number;
  };
  features: Record<Feature, boolean>;
}

export type Feature = 'ai' | 'sharing' | 'customBasketSharing' | 'priorityRefresh' | 'export' | 'savedScreens' | 'team';
export type Limit = 'aiQueriesPerMonth' | 'deepDivesPerDay' | 'positions' | 'workspaces' | 'seats';

export const PLAN_INFO: Record<Plan, PlanInfo> = {
  FREE: {
    id: 'FREE', label: 'Free', priceMonthly: 0, priceYearly: 0,
    limits: { aiQueriesPerMonth: 0, deepDivesPerDay: 3, positions: 5, workspaces: 1, seats: 1 },
    features: { ai: false, sharing: false, customBasketSharing: false, priorityRefresh: false, export: false, savedScreens: true, team: false },
  },
  PRO: {
    id: 'PRO', label: 'Pro', priceMonthly: 50, priceYearly: 500,
    limits: { aiQueriesPerMonth: 100, deepDivesPerDay: Infinity, positions: 50, workspaces: 1, seats: 1 },
    features: { ai: true, sharing: true, customBasketSharing: false, priorityRefresh: false, export: true, savedScreens: true, team: false },
  },
  PRO_PLUS: {
    id: 'PRO_PLUS', label: 'Pro Plus', priceMonthly: 100, priceYearly: 1000,
    limits: { aiQueriesPerMonth: Infinity, deepDivesPerDay: Infinity, positions: Infinity, workspaces: Infinity, seats: 5 },
    features: { ai: true, sharing: true, customBasketSharing: true, priorityRefresh: true, export: true, savedScreens: true, team: true },
  },
};

export function asPlan(p: string | null | undefined): Plan {
  return p === 'PRO' || p === 'PRO_PLUS' ? p : 'FREE';
}

export interface GateResult {
  allowed: boolean;
  reason?: string;
  /** cheapest plan that unlocks it */
  upgradeTo?: Plan;
  limit?: number;
  used?: number;
  remaining?: number;
}

const FEATURE_LABEL: Record<Feature, string> = {
  ai: 'AI research', sharing: 'Sharing', customBasketSharing: 'Custom basket sharing', priorityRefresh: 'Priority data refresh',
  export: 'Export', savedScreens: 'Saved screens', team: 'Team seats',
};
const LIMIT_LABEL: Record<Limit, string> = {
  aiQueriesPerMonth: 'AI queries this month', deepDivesPerDay: 'company deep dives today', positions: 'positions', workspaces: 'workspaces', seats: 'seats',
};

function cheapestWith(pred: (p: PlanInfo) => boolean): Plan | undefined {
  return PLANS.find((p) => pred(PLAN_INFO[p]));
}

/** Feature gate. `user` needs only `{ plan }`. Never throws; render <UpgradeHint gate={result}/> when !allowed. */
export function assertFeature(user: { plan: string }, feature: Feature): GateResult {
  const plan = asPlan(user.plan);
  if (PLAN_INFO[plan].features[feature]) return { allowed: true };
  const up = cheapestWith((p) => p.features[feature]);
  return { allowed: false, reason: `${FEATURE_LABEL[feature]} is available on ${up ? PLAN_INFO[up].label : 'a higher plan'}.`, upgradeTo: up };
}

/** Quantity gate. Pass the current `used` count (e.g. positions in portfolio, AI queries this month from usage.ts). */
export function checkLimit(user: { plan: string }, limit: Limit, used: number, adding = 1): GateResult {
  const plan = asPlan(user.plan);
  const max = PLAN_INFO[plan].limits[limit];
  if (used + adding <= max) return { allowed: true, limit: max, used, remaining: max === Infinity ? Infinity : max - used };
  const up = cheapestWith((p) => p.limits[limit] >= used + adding);
  return {
    allowed: false,
    reason: max === 0 ? `${LIMIT_LABEL[limit]} are not included on ${PLAN_INFO[plan].label}.` : `You've used ${used} of ${max} ${LIMIT_LABEL[limit]} on ${PLAN_INFO[plan].label}.`,
    upgradeTo: up, limit: max, used, remaining: Math.max(0, max - used),
  };
}

export function formatLimit(n: number): string {
  return n === Infinity ? 'Unlimited' : String(n);
}
