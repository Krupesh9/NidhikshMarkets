import 'server-only';
import { db } from './db';
import { parseJson, toJson } from './json';
import { checkLimit, type GateResult } from './plans';
import type { SessionUser } from './auth';

export const currentPeriod = (d = new Date()) => d.toISOString().slice(0, 7);
const today = (d = new Date()) => d.toISOString().slice(0, 10);

export interface UsageSnapshot { period: string; aiQueries: number; deepDivesToday: number; deepDives: Record<string, number> }

type U = Pick<SessionUser, 'id' | 'orgId' | 'plan'>;

async function row(user: U) {
  const period = currentPeriod();
  return db.usageCounter.upsert({
    where: { userId_period: { userId: user.id, period } },
    create: { userId: user.id, orgId: user.orgId, period },
    update: {},
  });
}

export async function getUsage(user: U): Promise<UsageSnapshot> {
  const r = await row(user);
  const dd = parseJson<Record<string, number>>(r.deepDives, {});
  return { period: r.period, aiQueries: r.aiQueries, deepDivesToday: dd[today()] ?? 0, deepDives: dd };
}

/** Check (without consuming) whether the user may run another AI query. */
export async function canUseAi(user: U): Promise<GateResult> {
  const u = await getUsage(user);
  return checkLimit(user, 'aiQueriesPerMonth', u.aiQueries);
}

export async function incrementAiQueries(user: U, n = 1): Promise<number> {
  await row(user);
  const r = await db.usageCounter.update({ where: { userId_period: { userId: user.id, period: currentPeriod() } }, data: { aiQueries: { increment: n } } });
  return r.aiQueries;
}

export async function canDeepDive(user: U): Promise<GateResult> {
  const u = await getUsage(user);
  return checkLimit(user, 'deepDivesPerDay', u.deepDivesToday);
}

export async function incrementDeepDive(user: U): Promise<number> {
  const r = await row(user);
  const dd = parseJson<Record<string, number>>(r.deepDives, {});
  dd[today()] = (dd[today()] ?? 0) + 1;
  await db.usageCounter.update({ where: { id: r.id }, data: { deepDives: toJson(dd) } });
  return dd[today()];
}
