/** Critical path: plan gating (plans.ts) and the monthly AI usage reset boundary (usage.ts). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAN_INFO, PLANS, asPlan, assertFeature, chartRangeAllowed, checkLimit, formatLimit, hasFeature, normalizePlan, type Feature } from '@/lib/plans';

const store = vi.hoisted(() => new Map<string, { id: string; userId: string; orgId: string; period: string; aiQueries: number; deepDives: string }>());

vi.mock('@/lib/db', () => {
  const k = (userId: string, period: string) => `${userId}:${period}`;
  const find = (where: { id?: string; userId_period?: { userId: string; period: string } }) =>
    where.id ? [...store.values()].find((r) => r.id === where.id) : store.get(k(where.userId_period!.userId, where.userId_period!.period));
  const usageCounter = {
    upsert: async ({ where, create }: { where: { userId_period: { userId: string; period: string } }; create: { userId: string; orgId: string; period: string } }) => {
      const hit = find(where);
      if (hit) return { ...hit };
      const r = { id: `uc_${store.size + 1}`, aiQueries: 0, deepDives: '{}', ...create };
      store.set(k(create.userId, create.period), r);
      return { ...r };
    },
    update: async ({ where, data }: { where: { id?: string; userId_period?: { userId: string; period: string } }; data: { aiQueries?: { increment: number }; deepDives?: string } }) => {
      const r = find(where);
      if (!r) throw new Error('not found');
      if (data.aiQueries) r.aiQueries += data.aiQueries.increment;
      if (data.deepDives !== undefined) r.deepDives = data.deepDives;
      return { ...r };
    },
  };
  const db = { usageCounter };
  return { db, default: db };
});

import { canDeepDive, canUseAi, currentPeriod, getUsage, incrementAiQueries, incrementDeepDive } from '@/lib/usage';

describe('plan catalogue (two plans: Free $0, Pro $100/mo)', () => {
  it('only FREE and PRO_PLUS exist; the paid plan is labelled Pro at $100/month', () => {
    expect(PLANS).toEqual(['FREE', 'PRO_PLUS']);
    expect(PLAN_INFO.FREE.priceMonthly).toBe(0);
    expect(PLAN_INFO.PRO_PLUS.priceMonthly).toBe(100);
    expect(PLAN_INFO.PRO_PLUS.label).toBe('Pro');
    expect(PLAN_INFO.PRO_PLUS.priceLabel).toBe('Pro · $100/mo');
  });
  it('limits', () => {
    expect(PLAN_INFO.FREE.limits).toMatchObject({ aiQueriesPerMonth: 0, deepDivesPerDay: 3, positions: 5 });
    expect(PLAN_INFO.PRO_PLUS.limits).toMatchObject({ aiQueriesPerMonth: Infinity, positions: Infinity, seats: 5 });
  });
  it('normalizePlan maps the retired PRO tier to PRO_PLUS and anything unknown to FREE', () => {
    expect(normalizePlan('PRO')).toBe('PRO_PLUS');
    expect(asPlan('PRO')).toBe('PRO_PLUS');
    expect(normalizePlan('PRO_PLUS')).toBe('PRO_PLUS');
    for (const v of ['pro', 'ENTERPRISE', '', null, undefined]) expect(normalizePlan(v)).toBe('FREE');
  });
  it('formatLimit renders Infinity as Unlimited', () => {
    expect(formatLimit(Infinity)).toBe('Unlimited');
    expect(formatLimit(100)).toBe('100');
  });
});

describe('feature matrix', () => {
  const PREMIUM: Feature[] = ['ai', 'advancedCharts', 'analystResearch', 'financials', 'ownership', 'marketHoldings', 'sharing', 'export', 'customBasketSharing', 'priorityRefresh', 'team'];
  it.each(PREMIUM)('%s: Free locked → upgrade to PRO_PLUS; Pro (and legacy PRO) unlocked', (f) => {
    const r = assertFeature({ plan: 'FREE' }, f);
    expect(r).toMatchObject({ allowed: false, upgradeTo: 'PRO_PLUS' });
    expect(r.reason).toMatch(/Pro · \$100\/mo/);
    expect(assertFeature({ plan: 'PRO_PLUS' }, f).allowed).toBe(true);
    expect(assertFeature({ plan: 'PRO' }, f).allowed).toBe(true);
    expect(hasFeature(null, f)).toBe(false);
  });
  it('saved screens are available to everyone', () => {
    for (const p of PLANS) expect(assertFeature({ plan: p }, 'savedScreens').allowed).toBe(true);
  });
  it('chart ranges: Free gets 1M–1Y only; Pro gets 1D/1W/5Y/MAX', () => {
    for (const r of ['1M', '3M', '6M', 'YTD', '1Y']) expect(chartRangeAllowed({ plan: 'FREE' }, r)).toBe(true);
    for (const r of ['1D', '1W', '5Y', 'MAX']) {
      expect(chartRangeAllowed({ plan: 'FREE' }, r)).toBe(false);
      expect(chartRangeAllowed({ plan: 'PRO_PLUS' }, r)).toBe(true);
    }
  });
});

describe('checkLimit', () => {
  it('FREE has no AI at all and points to PRO_PLUS', () => {
    const r = checkLimit({ plan: 'FREE' }, 'aiQueriesPerMonth', 0);
    expect(r).toMatchObject({ allowed: false, upgradeTo: 'PRO_PLUS', limit: 0, remaining: 0 });
    expect(r.reason).toMatch(/not included/);
  });
  it('FREE: 3 deep dives/day, 5 positions', () => {
    expect(checkLimit({ plan: 'FREE' }, 'deepDivesPerDay', 2).allowed).toBe(true);
    expect(checkLimit({ plan: 'FREE' }, 'deepDivesPerDay', 3)).toMatchObject({ allowed: false, upgradeTo: 'PRO_PLUS' });
    expect(checkLimit({ plan: 'FREE' }, 'positions', 4)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkLimit({ plan: 'FREE' }, 'positions', 5)).toMatchObject({ allowed: false, upgradeTo: 'PRO_PLUS', used: 5, limit: 5 });
  });
  it('bulk adds are checked as a whole (FREE adding 3 positions to 3)', () => {
    expect(checkLimit({ plan: 'FREE' }, 'positions', 3, 2).allowed).toBe(true);
    expect(checkLimit({ plan: 'FREE' }, 'positions', 3, 3)).toMatchObject({ allowed: false, upgradeTo: 'PRO_PLUS' });
  });
  it('PRO_PLUS: unlimited AI/positions; 5 seats with no further upgrade', () => {
    expect(checkLimit({ plan: 'PRO_PLUS' }, 'aiQueriesPerMonth', 1_000_000)).toMatchObject({ allowed: true, remaining: Infinity });
    expect(checkLimit({ plan: 'PRO_PLUS' }, 'positions', 10_000).allowed).toBe(true);
    const seats = checkLimit({ plan: 'PRO_PLUS' }, 'seats', 5);
    expect(seats.allowed).toBe(false);
    expect(seats.upgradeTo).toBeUndefined();
  });
});

describe('usage: monthly AI reset boundary', () => {
  const PRO = { id: 'u_an', orgId: 'org_1', plan: 'PRO_PLUS' as const };
  beforeEach(() => {
    store.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('currentPeriod is the UTC calendar month', () => {
    expect(currentPeriod(new Date('2026-01-31T23:59:59.999Z'))).toBe('2026-01');
    expect(currentPeriod(new Date('2026-02-01T00:00:00.000Z'))).toBe('2026-02');
    expect(currentPeriod(new Date('2026-12-31T23:59:59.999Z'))).toBe('2026-12');
    expect(currentPeriod(new Date('2027-01-01T00:00:00.000Z'))).toBe('2027-01');
  });

  it('counter accrues within a month and resets at the first instant of the next month', async () => {
    vi.setSystemTime(new Date('2026-01-31T23:59:59.000Z'));
    await incrementAiQueries(PRO, 99);
    expect(await incrementAiQueries(PRO)).toBe(100);
    expect((await getUsage(PRO)).aiQueries).toBe(100);
    expect(await canUseAi(PRO)).toMatchObject({ allowed: true }); // Pro is unlimited; still metered

    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
    const feb = await getUsage(PRO);
    expect(feb).toMatchObject({ period: '2026-02', aiQueries: 0 });
    expect(await incrementAiQueries(PRO)).toBe(1);

    // January's row is retained (history), not mutated by February usage.
    expect(store.get('u_an:2026-01')?.aiQueries).toBe(100);
  });

  it('counters are per user', async () => {
    vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));
    await incrementAiQueries(PRO, 5);
    expect((await getUsage({ ...PRO, id: 'u_other' })).aiQueries).toBe(0);
  });

  it('deep dives reset daily (UTC) for FREE (3/day)', async () => {
    const FREE = { id: 'u_in', orgId: 'org_1', plan: 'FREE' as const };
    vi.setSystemTime(new Date('2026-03-10T23:00:00Z'));
    for (let i = 0; i < 3; i++) await incrementDeepDive(FREE);
    expect(await canDeepDive(FREE)).toMatchObject({ allowed: false, upgradeTo: 'PRO_PLUS' });
    vi.setSystemTime(new Date('2026-03-11T00:00:01Z'));
    expect(await canDeepDive(FREE)).toMatchObject({ allowed: true, remaining: 3 });
  });
});
