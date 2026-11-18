import { z } from 'zod';
import { withApi } from '@/lib/http';
import { getCalendarEvents, type CalendarCategory } from '@/lib/calendar';
import { screenRepo } from '@/lib/repos';

export const dynamic = 'force-dynamic';

const CATS: CalendarCategory[] = ['earnings', 'inflation', 'jobs', 'fed', 'growth', 'market'];
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /api/calendar?from=2026-11-16&to=2027-02-15&types=earnings,fed&scope=watchlist|all
 * → { data: CalendarEvent[], meta: { from, to, today, asOf, sources } }
 * Earnings are filtered to the signed-in user's watchlist (scope=all adds the covered universe).
 */
export const GET = withApi(
  async ({ user, query }) => {
    const types = query.types?.split(',').map((s) => s.trim()).filter((s): s is CalendarCategory => (CATS as string[]).includes(s));
    const wl = await screenRepo.getWatchlist({ orgId: user.orgId, userId: user.id });
    const r = await getCalendarEvents({ from: query.from, to: query.to, categories: types, watchlist: wl?.symbols ?? [], earningsScope: query.scope });
    return { data: r.events, meta: r.meta };
  },
  { query: z.object({ from: ymd.optional(), to: ymd.optional(), types: z.string().max(200).optional(), scope: z.enum(['watchlist', 'all']).optional() }) },
);
