import 'server-only';
import { z } from 'zod';
import { getMarketData } from '@/lib/data';
import { cache } from '@/lib/cache';
import { sanitizeText } from '@/lib/sanitize';
import { positionsGate } from '@/lib/analytics/limits';
import { upgradeRequired } from '@/lib/http';
import type { SessionUser } from '@/lib/auth';

export const TICKER = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.\-]{0,9}$/, 'Invalid ticker');
export const positionBody = z.object({
  ticker: TICKER,
  quantity: z.number().finite().refine((n) => n !== 0, 'Quantity cannot be zero'),
  costBasis: z.number().finite().min(0),
  targetWeight: z.number().min(-1).max(1).nullable().optional(),
});
export const positionPatch = z.object({
  quantity: z.number().finite().refine((n) => n !== 0, 'Quantity cannot be zero').optional(),
  costBasis: z.number().finite().min(0).optional(),
  targetWeight: z.number().min(-1).max(1).nullable().optional(),
});
export const BENCH = z.enum(['SPY', 'QQQ', 'IWM']);

export const clean = (s: string | null | undefined, n = 500) => (s == null ? s : sanitizeText(s, n));

/** sector/country classification for new positions from the universe (cached 1h). */
export async function classify(ticker: string): Promise<{ sector: string | null; country: string | null }> {
  const u = await cache.wrap('an:universe', async () => (await getMarketData().getUniverse()).data, 60 * 60_000);
  const x = u.find((i) => i.ticker.toUpperCase() === ticker.toUpperCase());
  return { sector: x?.sector ?? null, country: x?.country ?? null };
}

/** Throw 402 with structured gate if adding would exceed the plan's position limit. */
export function enforcePositions(user: SessionUser, existing: number, adding: number) {
  const g = positionsGate(user, existing, adding);
  if (!g.allowed) throw upgradeRequired(g.reason ?? 'Position limit reached', g.upgradeTo);
  return g;
}
