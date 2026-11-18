/**
 * Plan tiers, prices, limits and feature gates. Pure (no server deps) so the client can render plan info.
 *
 * Two plans only: Free ($0) and Pro ($100/month). The paid plan keeps the storage key `PRO_PLUS` so existing
 * rows keep working; any legacy `PRO` value (the retired $50 tier) is normalised to `PRO_PLUS` by `normalizePlan()`.
 */
export type Plan = 'FREE' | 'PRO_PLUS';
export type Role = 'ADMIN' | 'ANALYST' | 'VIEWER';
export const PLANS: Plan[] = ['FREE', 'PRO_PLUS'];
/** The single paid plan. */
export const PAID_PLAN: Plan = 'PRO_PLUS';

export interface PlanInfo {
  id: Plan;
  label: string;
  /** label with price, e.g. "Pro · $100/mo" */
  priceLabel: string;
  priceMonthly: number;
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

export type Feature =
  | 'ai' | 'sharing' | 'customBasketSharing' | 'priorityRefresh' | 'export' | 'savedScreens' | 'team'
  /** indicators (SMA/EMA/MACD/RSI/crossovers), candlesticks, 1D/1W intraday, 5Y/MAX */
  | 'advancedCharts'
  /** Analysis section: ratings, price targets, analyst actions, consensus estimates, Fwd EPS / Fwd P/E */
  | 'analystResearch'
  /** financial statements, EV/EBITDA */
  | 'financials'
  /** insiders (Form 4) and institutional holders (13F) */
  | 'ownership'
  /** /markets index pages: top-10 holdings, sector weights, contribution */
  | 'marketHoldings';
export type Limit = 'aiQueriesPerMonth' | 'deepDivesPerDay' | 'positions' | 'workspaces' | 'seats';

export const PREMIUM_FEATURES: Feature[] = ['ai', 'advancedCharts', 'analystResearch', 'financials', 'ownership', 'marketHoldings', 'sharing', 'export', 'customBasketSharing', 'priorityRefresh', 'team'];

const none = Object.fromEntries(PREMIUM_FEATURES.map((f) => [f, false])) as Record<Feature, boolean>;
const all = Object.fromEntries(PREMIUM_FEATURES.map((f) => [f, true])) as Record<Feature, boolean>;

export const PLAN_INFO: Record<Plan, PlanInfo> = {
  FREE: {
    id: 'FREE', label: 'Free', priceLabel: 'Free · $0', priceMonthly: 0,
    limits: { aiQueriesPerMonth: 0, deepDivesPerDay: 3, positions: 5, workspaces: 1, seats: 1 },
    features: { ...none, savedScreens: true },
  },
  PRO_PLUS: {
    id: 'PRO_PLUS', label: 'Pro', priceLabel: 'Pro · $100/mo', priceMonthly: 100,
    limits: { aiQueriesPerMonth: Infinity, deepDivesPerDay: Infinity, positions: Infinity, workspaces: Infinity, seats: 5 },
    features: { ...all, savedScreens: true },
  },
};

/** Single place that maps whatever is stored (incl. the retired `PRO` tier) to a current plan. */
export function normalizePlan(p: string | null | undefined): Plan {
  return p === 'PRO_PLUS' || p === 'PRO' ? 'PRO_PLUS' : 'FREE';
}
/** Alias of normalizePlan (kept for existing imports). */
export const asPlan = normalizePlan;

export const isPaid = (user: { plan: string } | null | undefined) => !!user && normalizePlan(user.plan) === 'PRO_PLUS';

export interface GateResult {
  allowed: boolean;
  reason?: string;
  /** cheapest plan that unlocks it */
  upgradeTo?: Plan;
  limit?: number;
  used?: number;
  remaining?: number;
}

export const FEATURE_LABEL: Record<Feature, string> = {
  ai: 'AI research assistant', sharing: 'Sharing', customBasketSharing: 'Custom basket sharing', priorityRefresh: 'Priority data refresh',
  export: 'Export', savedScreens: 'Saved screens', team: 'Team seats',
  advancedCharts: 'Advanced charting', analystResearch: 'Analyst research', financials: 'Financial statements',
  ownership: 'Ownership (insiders & 13F)', marketHoldings: 'Index holdings & contribution',
};
const LIMIT_LABEL: Record<Limit, string> = {
  aiQueriesPerMonth: 'AI queries this month', deepDivesPerDay: 'company deep dives today', positions: 'positions', workspaces: 'workspaces', seats: 'seats',
};

function cheapestWith(pred: (p: PlanInfo) => boolean): Plan | undefined {
  return PLANS.find((p) => pred(PLAN_INFO[p]));
}

/** Feature gate. `user` needs only `{ plan }`. Never throws; render <UpgradeHint gate={result}/> when !allowed. */
export function assertFeature(user: { plan: string } | null | undefined, feature: Feature): GateResult {
  const plan = normalizePlan(user?.plan);
  if (PLAN_INFO[plan].features[feature]) return { allowed: true };
  const up = cheapestWith((p) => p.features[feature]);
  return { allowed: false, reason: `${FEATURE_LABEL[feature]} is part of ${up ? PLAN_INFO[up].priceLabel : 'a paid plan'}.`, upgradeTo: up };
}

/** Boolean shorthand of assertFeature. */
export const hasFeature = (user: { plan: string } | null | undefined, feature: Feature) => assertFeature(user, feature).allowed;

/** Quantity gate. Pass the current `used` count (e.g. positions in portfolio, AI queries this month from usage.ts). */
export function checkLimit(user: { plan: string }, limit: Limit, used: number, adding = 1): GateResult {
  const plan = normalizePlan(user.plan);
  const max = PLAN_INFO[plan].limits[limit];
  if (used + adding <= max) return { allowed: true, limit: max, used, remaining: max === Infinity ? Infinity : max - used };
  const up = cheapestWith((p) => p.limits[limit] >= used + adding);
  return {
    allowed: false,
    reason: max === 0 ? `${LIMIT_LABEL[limit]} are not included on ${PLAN_INFO[plan].label}.` : `You've used ${used} of ${max} ${LIMIT_LABEL[limit]} on ${PLAN_INFO[plan].label}.`,
    upgradeTo: up === plan ? undefined : up, limit: max, used, remaining: Math.max(0, max - used),
  };
}

export function formatLimit(n: number): string {
  return n === Infinity ? 'Unlimited' : String(n);
}

/** History ranges Free users may request on company charts. */
export const BASIC_CHART_RANGES = ['1M', '3M', '6M', 'YTD', '1Y'] as const;
export function chartRangeAllowed(user: { plan: string } | null | undefined, range: string): boolean {
  return (BASIC_CHART_RANGES as readonly string[]).includes(range) || hasFeature(user, 'advancedCharts');
}

/** What each plan includes, for the comparison table and the upgrade dialog. */
export const FREE_INCLUDES = [
  'Price chart (area / line, 1M–1Y)',
  'Quote, market cap, P/E (TTM), EPS (TTM)',
  'News, SEC filings list, earnings calendar',
  'Watchlist, home page, market charts + news',
  `${PLAN_INFO.FREE.limits.deepDivesPerDay} company deep dives / day · ${PLAN_INFO.FREE.limits.positions} portfolio positions`,
];
export const PRO_INCLUDES = [
  'AI research assistant with citations (unlimited)',
  'Advanced charts: SMA, EMA, MACD, RSI, crossovers, candlesticks, 1D/1W intraday, 5Y/MAX',
  'Analyst research: ratings, price targets, analyst actions, consensus, Fwd EPS / P/E',
  'Financial statements and EV/EBITDA',
  'Ownership: insider transactions and 13F holders',
  'Index holdings, sector weights and contribution',
  'Unlimited deep dives and positions, sharing, export, team seats',
];
