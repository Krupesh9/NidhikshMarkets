/** Critical path: plan gating (plans.ts) and the monthly AI usage reset boundary (usage.ts). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAN_INFO, PLANS, asPlan, assertFeature, checkLimit, formatLimit, type Feature } from '@/lib/plans';

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

describe('plan catalogue', () => {
  it('prices: Pro $50/$500, Pro Plus $100/$1,000, Free $0', () => {
    expect([PLAN_INFO.FREE.priceMonthly, PLAN_INFO.FREE.priceYearly]).toEqual([0, 0]);
    expect([PLAN_INFO.PRO.priceMonthly, PLAN_INFO.PRO.priceYearly]).toEqual([50, 500]);
    expect([PLAN_INFO.PRO_PLUS.priceMonthly, PLAN_INFO.PRO_PLUS.priceYearly]).toEqual([100, 1000]);
  });
  it('limits match the contract', () => {
    expect(PLAN_INFO.FREE.limits).toMatchObject({ aiQueriesPerMonth: 0, deepDivesPerDay: 3, positions: 5 });
    expect(PLAN_INFO.PRO.limits).toMatchObject({ aiQueriesPerMonth: 100, positions: 50, workspaces: 1 });
    expect(PLAN_INFO.PRO_PLUS.limits).toMatchObject({ aiQueriesPerMonth: Infinity, positions: Infinity, seats: 5 });
  });
  it('asPlan defaults anything unknown to FREE', () => {
    expect(asPlan('PRO')).toBe('PRO');
    expect(asPlan('PRO_PLUS')).toBe('PRO_PLUS');
    for (const v of ['pro', 'ENTERPRISE', '', null, undefined]) expect(asPlan(v)).toBe('FREE');
  });
  it('formatLimit renders Infinity as Unlimited', () => {
    expect(formatLimit(Infinity)).toBe('Unlimited');
    expect(formatLimit(100)).toBe('100');
  });
});

describe('assertFeature', () => {
  const expected: Record<Feature, [boolean, boolean, boolean, string | undefined]> = {
    //                    FREE   PRO    PRO_PLUS  upgradeTo (from FREE)
    ai: [false, true, true, 'PRO'],
    sharing: [false, true, true, 'PRO'],
    export: [false, true, true, 'PRO'],
    customBasketSharing: [false, false, true, 'PRO_PLUS'],
    priorityRefresh: [false, false, true, 'PRO_PLUS'],
    team: [false, false, true, 'PRO_PLUS'],
    savedScreens: [true, true, true, undefined],
  };
  it.each(Object.entries(expected))('%s gating across tiers', (feature, [free, pro, plus, up]) => {
    const f = feature as Feature;
    expect(PLANS.map((p) => assertFeature({ plan: p }, f).allowed)).toEqual([free, pro, plus]);
    const r = assertFeature({ plan: 'FREE' }, f);
    if (!free) {
      expect(r.upgradeTo).toBe(up);
      expect(r.reason).toMatch(/available on/);
    }
  });
  it('PRO is pointed at PRO_PLUS for custom basket sharing', () => {
    expect(assertFeature({ plan: 'PRO' }, 'customBasketSharing')).toMatchObject({ allowed: false, upgradeTo: 'PRO_PLUS' });
  });
});

describe('checkLimit', () => {
  it('FREE has no AI at all and points to PRO', () => {
    const r = checkLimit({ plan: 'FREE' }, 'aiQueriesPerMonth', 0);
    expect(r).toMatchObject({ allowed: false, upgradeTo: 'PRO', limit: 0, remaining: 0 });
    expect(r.reason).toMatch(/not included/);
  });
  it('FREE: 3 deep dives/day, 5 positions', () => {
    expect(checkLimit({ plan: 'FREE' }, 'deepDivesPerDay', 2).allowed).toBe(true);
    expect(checkLimit({ plan: 'FREE' }, 'deepDivesPerDay', 3)).toMatchObject({ allowed: false, upgradeTo: 'PRO' });
    expect(checkLimit({ plan: 'FREE' }, 'positions', 4)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkLimit({ plan: 'FREE' }, 'positions', 5)).toMatchObject({ allowed: false, upgradeTo: 'PRO', used: 5, limit: 5 });
  });
  it('PRO: 100 AI/month, 50 positions, then PRO_PLUS', () => {
    expect(checkLimit({ plan: 'PRO' }, 'aiQueriesPerMonth', 99)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkLimit({ plan: 'PRO' }, 'aiQueriesPerMonth', 100)).toMatchObject({ allowed: false, upgradeTo: 'PRO_PLUS' });
    expect(checkLimit({ plan: 'PRO' }, 'positions', 50)).toMatchObject({ allowed: false, upgradeTo: 'PRO_PLUS' });
  });
  it('bulk adds are checked as a whole (FREE adding 3 positions to 3)', () => {
    expect(checkLimit({ plan: 'FREE' }, 'positions', 3, 2).allowed).toBe(true);
    expect(checkLimit({ plan: 'FREE' }, 'positions', 3, 3)).toMatchObject({ allowed: false, upgradeTo: 'PRO' });
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
  const PRO = { id: 'u_an', orgId: 'org_1', plan: 'PRO' as const };
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
    expect(await canUseAi(PRO)).toMatchObject({ allowed: false, upgradeTo: 'PRO_PLUS' });

    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
    const feb = await getUsage(PRO);
    expect(feb).toMatchObject({ period: '2026-02', aiQueries: 0 });
    expect(await canUseAi(PRO)).toMatchObject({ allowed: true, remaining: 100 });
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
    expect(await canDeepDive(FREE)).toMatchObject({ allowed: false, upgradeTo: 'PRO' });
    vi.setSystemTime(new Date('2026-03-11T00:00:01Z'));
    expect(await canDeepDive(FREE)).toMatchObject({ allowed: true, remaining: 3 });
  });
});
