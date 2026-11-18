import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ wl: null as null | { symbols: string[] }, screens: [] as { name: string; filters: unknown }[], setWl: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../db', () => ({ db: { savedScreen: { findFirst: vi.fn(async ({ where }: { where: { name: string } }) => h.screens.find((s) => s.name === where.name) ?? null) } } }));
vi.mock('../repos', () => ({
  screenRepo: {
    getWatchlist: vi.fn(async () => h.wl),
    setWatchlist: vi.fn(async (_s: unknown, symbols: string[]) => { h.setWl(symbols); h.wl = { symbols }; }),
    create: vi.fn(async (_s: unknown, d: { name: string; filters: unknown }) => { h.screens.push(d); }),
  },
}));

import { ensureOwnerDefaults } from '../owner-defaults.server';
import { OWNER_WATCHLIST } from '@/config/owner-defaults';

beforeEach(() => { h.wl = null; h.screens = []; h.setWl.mockReset(); });

describe('ensureOwnerDefaults', () => {
  it('creates the 32-stock watchlist and a grouped "My stocks" screen on first sign-in', async () => {
    await ensureOwnerDefaults({ id: 'u1', orgId: 'o1' });
    expect(h.setWl).toHaveBeenCalledWith(OWNER_WATCHLIST);
    expect(OWNER_WATCHLIST).toHaveLength(32);
    const screen = h.screens.find((s) => s.name === 'My stocks')!;
    const list = (screen.filters as Record<string, { tickers: string[]; groups: Record<string, string> }>)['$list'];
    expect(list.tickers).toEqual(OWNER_WATCHLIST);
    expect(list.groups.NVDA).toBe('Technology');
    expect(list.groups.QQQ).toBe('Index Fund');
  });
  it('never overwrites an existing watchlist or screen', async () => {
    h.wl = { symbols: ['PLTR'] };
    h.screens = [{ name: 'My stocks', filters: {} }];
    await ensureOwnerDefaults({ id: 'u1', orgId: 'o1' });
    expect(h.setWl).not.toHaveBeenCalled();
    expect(h.screens).toHaveLength(1);
  });
});
