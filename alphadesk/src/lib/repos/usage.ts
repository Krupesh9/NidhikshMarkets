import 'server-only';
import { db } from '@/lib/db';
import type { Scope } from './types';

export const usageRepo = {
  forPeriod: (s: Scope, period: string) => db.usageCounter.findUnique({ where: { userId_period: { userId: s.userId, period } } }),
  orgTotals: async (orgId: string, period: string) => {
    const rows = await db.usageCounter.findMany({ where: { orgId, period } });
    return { users: rows.length, aiQueries: rows.reduce((a, r) => a + r.aiQueries, 0), rows };
  },
};
