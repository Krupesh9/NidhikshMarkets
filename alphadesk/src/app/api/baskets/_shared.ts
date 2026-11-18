import 'server-only';
import { z } from 'zod';
import { badRequest } from '@/lib/http';
import { validateTargetWeights } from '@/lib/analytics/rebalance';

export const holdingSchema = z.object({
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.\-]{0,9}$/, 'Invalid ticker'),
  targetWeight: z.number().min(0).max(1),
  rationale: z.string().max(500).nullable().optional(),
  sector: z.string().max(60).nullable().optional(),
});

/** Target weights must sum to 100% (±0.01%) with unique tickers. */
export function assertHoldings(h: { ticker: string; targetWeight: number }[]) {
  if (!h.length) throw badRequest('A basket needs at least one holding');
  const dup = h.map((x) => x.ticker).find((t, i, a) => a.indexOf(t) !== i);
  if (dup) throw badRequest(`Duplicate ticker ${dup}`);
  const v = validateTargetWeights(h.map((x) => x.targetWeight));
  if (!v.ok) throw badRequest(v.message ?? 'Invalid target weights', { sum: v.sum });
}
