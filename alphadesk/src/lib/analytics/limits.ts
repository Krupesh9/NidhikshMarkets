/** Plan-limit helpers for positions (pure; wraps checkLimit from @/lib/plans). Never blocks rendering — UI shows <UpgradeHint/>. */
import { checkLimit, type GateResult } from '@/lib/plans';

/** Gate adding `adding` positions to a portfolio that currently holds `existing` positions. */
export function positionsGate(user: { plan: string }, existing: number, adding: number): GateResult & { maxAddable: number } {
  const g = checkLimit(user, 'positions', existing, adding);
  const limit = g.limit ?? Infinity;
  return { ...g, maxAddable: limit === Infinity ? Infinity : Math.max(0, limit - existing) };
}

/** Number of genuinely new tickers when merging `incoming` into `existing` tickers. */
export function newTickerCount(existing: string[], incoming: string[]): number {
  const have = new Set(existing.map((t) => t.toUpperCase()));
  return new Set(incoming.map((t) => t.toUpperCase()).filter((t) => !have.has(t))).size;
}
