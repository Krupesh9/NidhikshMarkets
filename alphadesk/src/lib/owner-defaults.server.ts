import 'server-only';
import { db } from './db';
import { screenRepo } from './repos';
import { toSavedScreen, DEFAULT_SORT, type ScreenDefinition } from './screener/engine';
import { DEFAULT_COLUMNS } from './screener/columns';
import { OWNER_GROUPS, OWNER_WATCHLIST } from '@/config/owner-defaults';
import { log } from './log';

/**
 * First sign-in of the owner: give them their watchlist and a "My stocks" screen.
 * Only fills what is missing — never overwrites a watchlist or screen the owner already has.
 */
export async function ensureOwnerDefaults(user: { id: string; orgId: string }) {
  try {
    const scope = { orgId: user.orgId, userId: user.id };
    const wl = await screenRepo.getWatchlist(scope);
    if (!wl || !wl.symbols?.length) await screenRepo.setWatchlist(scope, OWNER_WATCHLIST);
    const hasScreen = await db.savedScreen.findFirst({ where: { userId: user.id, name: 'My stocks' }, select: { id: true } });
    if (!hasScreen) {
      const def: ScreenDefinition = {
        filters: {} as ScreenDefinition['filters'], columns: DEFAULT_COLUMNS, sort: [{ id: 'group', desc: false }, ...DEFAULT_SORT],
        tickers: OWNER_WATCHLIST, groups: OWNER_GROUPS,
      };
      await screenRepo.create(scope, toSavedScreen('My stocks', def, 'Owner watchlist grouped by sector'));
    }
  } catch (e) {
    log.error('owner.defaults_failed', { err: (e as Error).message });
  }
}
