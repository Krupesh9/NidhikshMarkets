import { z } from 'zod';
import { withApi } from '@/lib/http';
import { screenRepo } from '@/lib/repos';
import { sanitizeTicker } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

/** GET → { id, name, symbols } | null ; PUT { symbols: string[] } replaces the user's watchlist. */
export const GET = withApi(async ({ user }) => (await screenRepo.getWatchlist({ orgId: user.orgId, userId: user.id })) ?? { symbols: [] });

export const PUT = withApi(
  async ({ user, body }) => screenRepo.setWatchlist({ orgId: user.orgId, userId: user.id }, body.symbols.map(sanitizeTicker).filter((t): t is string => !!t)),
  { body: z.object({ symbols: z.array(z.string()).max(100) }), rateLimit: 'mutation', audit: 'watchlist.update' },
);
