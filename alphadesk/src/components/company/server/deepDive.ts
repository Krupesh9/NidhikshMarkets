import 'server-only';
import { db } from '@/lib/db';
import { auditAsync } from '@/lib/audit';
import { canDeepDive, incrementDeepDive } from '@/lib/usage';
import type { GateResult } from '@/lib/plans';
import type { SessionUser } from '@/lib/auth';
import { log } from '@/lib/log';

export const DEEP_DIVE_ACTION = 'company.deep_dive';

const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Count a deep dive at most once per user + ticker + UTC day.
 * Re-visits of a ticker already opened today are always allowed (and not re-counted).
 * Persistence: the audit log row `company.deep_dive` (target = ticker) marks "seen today".
 */
export async function registerDeepDive(user: SessionUser, ticker: string): Promise<{ gate: GateResult; counted: boolean; alreadyToday: boolean }> {
  try {
    const seen = await db.auditLog.findFirst({
      where: { userId: user.id, action: DEEP_DIVE_ACTION, target: ticker, createdAt: { gte: startOfUtcDay() } },
      select: { id: true },
    });
    if (seen) return { gate: { allowed: true }, counted: false, alreadyToday: true };
    const gate = await canDeepDive(user);
    if (!gate.allowed) return { gate, counted: false, alreadyToday: false };
    await incrementDeepDive(user);
    await auditAsync({ orgId: user.orgId, userId: user.id, action: DEEP_DIVE_ACTION, target: ticker });
    return { gate, counted: true, alreadyToday: false };
  } catch (e) {
    // Never block research on a usage-store hiccup.
    log.warn('company.deep_dive_count_failed', { ticker, err: (e as Error).message });
    return { gate: { allowed: true }, counted: false, alreadyToday: false };
  }
}
