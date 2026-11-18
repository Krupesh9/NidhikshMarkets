import 'server-only';
import { db } from '@/lib/db';
import { parseJson, toJson } from '@/lib/json';
import type { SavedScreenDTO, Scope } from './types';

type Row = Awaited<ReturnType<typeof db.savedScreen.findFirst>>;
const map = (r: NonNullable<Row>): SavedScreenDTO => ({
  ...r, filters: parseJson(r.filters, {}), columns: parseJson(r.columns, []), sort: parseJson(r.sort, []),
});

export interface ScreenInput { name: string; description?: string | null; filters: Record<string, unknown>; columns: string[]; sort: { id: string; desc: boolean }[] }

export const screenRepo = {
  list: async (s: Scope) => (await db.savedScreen.findMany({ where: { orgId: s.orgId }, orderBy: { updatedAt: 'desc' } })).map(map),
  get: async (s: Scope, id: string) => {
    const r = await db.savedScreen.findFirst({ where: { id, orgId: s.orgId } });
    return r ? map(r) : null;
  },
  create: async (s: Scope, d: ScreenInput) =>
    map(await db.savedScreen.create({ data: { orgId: s.orgId, userId: s.userId, name: d.name, description: d.description, filters: toJson(d.filters), columns: toJson(d.columns), sort: toJson(d.sort) } })),
  update: async (s: Scope, id: string, d: Partial<ScreenInput>) => {
    const data: Record<string, unknown> = {};
    if (d.name !== undefined) data.name = d.name;
    if (d.description !== undefined) data.description = d.description;
    if (d.filters !== undefined) data.filters = toJson(d.filters);
    if (d.columns !== undefined) data.columns = toJson(d.columns);
    if (d.sort !== undefined) data.sort = toJson(d.sort);
    return (await db.savedScreen.updateMany({ where: { id, orgId: s.orgId }, data })).count > 0;
  },
  remove: async (s: Scope, id: string) => (await db.savedScreen.deleteMany({ where: { id, orgId: s.orgId } })).count > 0,

  // watchlists (per user)
  getWatchlist: async (s: Scope) => {
    const w = await db.watchlist.findFirst({ where: { orgId: s.orgId, userId: s.userId }, orderBy: { createdAt: 'asc' } });
    return w ? { id: w.id, name: w.name, symbols: parseJson<string[]>(w.symbols, []) } : null;
  },
  setWatchlist: async (s: Scope, symbols: string[], name = 'My Watchlist') => {
    const w = await db.watchlist.findFirst({ where: { orgId: s.orgId, userId: s.userId }, orderBy: { createdAt: 'asc' } });
    const clean = Array.from(new Set(symbols.map((x) => x.toUpperCase()))).slice(0, 100);
    const r = w
      ? await db.watchlist.update({ where: { id: w.id }, data: { symbols: toJson(clean) } })
      : await db.watchlist.create({ data: { orgId: s.orgId, userId: s.userId, name, symbols: toJson(clean) } });
    return { id: r.id, name: r.name, symbols: clean };
  },
};
