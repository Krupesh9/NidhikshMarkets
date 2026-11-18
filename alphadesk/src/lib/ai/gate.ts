// AI usage gating. Pure core with injectable usage store so it is unit-testable.
import { assertFeature, checkLimit, type GateResult } from '@/lib/plans';
import type { UsageInfo } from './types';

export interface UsageStore {
  /** AI queries used this month */
  getUsed: () => Promise<number>;
  /** consume one query; returns new count */
  increment: () => Promise<number>;
}

export type AiAuthorization =
  | { allowed: true; usage: UsageInfo }
  | { allowed: false; gate: GateResult };

const toUsage = (used: number, limit: number): UsageInfo => ({
  used,
  limit: limit === Infinity ? null : limit,
  remaining: limit === Infinity ? null : Math.max(0, limit - used),
});

/**
 * FREE: AI not included -> blocked (caller renders <UpgradeHint/> inline).
 * PRO: 100/month, counted. PRO_PLUS: unlimited, still counted for the meter.
 * Consumes one query when allowed.
 */
export async function authorizeAiQuery(user: { plan: string }, store: UsageStore): Promise<AiAuthorization> {
  const feature = assertFeature(user, 'ai');
  if (!feature.allowed) return { allowed: false, gate: feature };
  const used = await store.getUsed();
  const limit = checkLimit(user, 'aiQueriesPerMonth', used);
  if (!limit.allowed) return { allowed: false, gate: limit };
  const after = await store.increment();
  return { allowed: true, usage: toUsage(after, limit.limit ?? Infinity) };
}
