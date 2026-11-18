import 'server-only';
import { db } from '@/lib/db';
import { parseJson } from '@/lib/json';

export const auditRepo = {
  list: async (orgId: string, opts: { userId?: string; action?: string; take?: number } = {}) =>
    (await db.auditLog.findMany({
      where: { orgId, ...(opts.userId ? { userId: opts.userId } : {}), ...(opts.action ? { action: { startsWith: opts.action } } : {}) },
      orderBy: { createdAt: 'desc' }, take: opts.take ?? 100,
    })).map((r) => ({ ...r, meta: parseJson<Record<string, unknown>>(r.meta, {}) })),
};
