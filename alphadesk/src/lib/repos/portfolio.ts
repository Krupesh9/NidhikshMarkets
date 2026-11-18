import 'server-only';
import { db } from '@/lib/db';
import type { BasketDTO, PortfolioDTO, Scope } from './types';

export interface PositionInput { ticker: string; quantity: number; costBasis: number; targetWeight?: number | null; sector?: string | null; country?: string | null }

export const portfolioRepo = {
  list: (s: Scope): Promise<PortfolioDTO[]> =>
    db.portfolio.findMany({ where: { orgId: s.orgId }, include: { positions: { orderBy: { ticker: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
  get: (s: Scope, id: string): Promise<PortfolioDTO | null> =>
    db.portfolio.findFirst({ where: { id, orgId: s.orgId }, include: { positions: { orderBy: { ticker: 'asc' } } } }),
  create: (s: Scope, d: { name: string; description?: string; benchmark?: string; baseCurrency?: string; positions?: PositionInput[] }): Promise<PortfolioDTO> =>
    db.portfolio.create({
      data: { orgId: s.orgId, userId: s.userId, name: d.name, description: d.description, benchmark: d.benchmark ?? 'SPY', baseCurrency: d.baseCurrency ?? 'USD',
        positions: { create: (d.positions ?? []).map((p) => ({ ...p, ticker: p.ticker.toUpperCase(), orgId: s.orgId })) } },
      include: { positions: true },
    }),
  update: async (s: Scope, id: string, d: { name?: string; description?: string | null; benchmark?: string }) => {
    const r = await db.portfolio.updateMany({ where: { id, orgId: s.orgId }, data: d });
    return r.count > 0;
  },
  remove: async (s: Scope, id: string) => (await db.portfolio.deleteMany({ where: { id, orgId: s.orgId } })).count > 0,
  /** Replace all positions (CSV import / editor save). */
  replacePositions: async (s: Scope, id: string, positions: PositionInput[]) => {
    const p = await db.portfolio.findFirst({ where: { id, orgId: s.orgId } });
    if (!p) return null;
    await db.$transaction([
      db.position.deleteMany({ where: { portfolioId: id } }),
      db.position.createMany({ data: positions.map((x) => ({ ...x, ticker: x.ticker.toUpperCase(), portfolioId: id, orgId: s.orgId })) }),
    ]);
    return portfolioRepo.get(s, id);
  },
  upsertPosition: async (s: Scope, portfolioId: string, x: PositionInput & { id?: string }) => {
    const p = await db.portfolio.findFirst({ where: { id: portfolioId, orgId: s.orgId } });
    if (!p) return null;
    const data = { ...x, ticker: x.ticker.toUpperCase() };
    delete (data as { id?: string }).id;
    return x.id
      ? db.position.update({ where: { id: x.id }, data })
      : db.position.create({ data: { ...data, portfolioId, orgId: s.orgId } });
  },
  removePosition: async (s: Scope, positionId: string) => (await db.position.deleteMany({ where: { id: positionId, orgId: s.orgId } })).count > 0,
  countPositions: (s: Scope, portfolioId?: string) => db.position.count({ where: { orgId: s.orgId, ...(portfolioId ? { portfolioId } : {}) } }),

  // baskets
  listBaskets: (s: Scope): Promise<BasketDTO[]> =>
    db.basket.findMany({ where: { orgId: s.orgId }, include: { holdings: { orderBy: { targetWeight: 'desc' } } }, orderBy: { createdAt: 'asc' } }),
  getBasket: (s: Scope, id: string): Promise<BasketDTO | null> =>
    db.basket.findFirst({ where: { id, orgId: s.orgId }, include: { holdings: { orderBy: { targetWeight: 'desc' } } } }),
  createBasket: (s: Scope, d: { name: string; description?: string; thesis?: string; holdings: { ticker: string; targetWeight: number; rationale?: string; sector?: string }[] }): Promise<BasketDTO> =>
    db.basket.create({
      data: { orgId: s.orgId, userId: s.userId, name: d.name, description: d.description, thesis: d.thesis,
        holdings: { create: d.holdings.map((h) => ({ ...h, ticker: h.ticker.toUpperCase(), orgId: s.orgId })) } },
      include: { holdings: true },
    }),
  replaceBasketHoldings: async (s: Scope, id: string, holdings: { ticker: string; targetWeight: number; rationale?: string; sector?: string }[]) => {
    const b = await db.basket.findFirst({ where: { id, orgId: s.orgId } });
    if (!b) return null;
    await db.$transaction([
      db.basketHolding.deleteMany({ where: { basketId: id } }),
      db.basketHolding.createMany({ data: holdings.map((h) => ({ ...h, ticker: h.ticker.toUpperCase(), basketId: id, orgId: s.orgId })) }),
    ]);
    return portfolioRepo.getBasket(s, id);
  },
  updateBasket: async (s: Scope, id: string, d: { name?: string; description?: string | null; thesis?: string | null }) =>
    (await db.basket.updateMany({ where: { id, orgId: s.orgId }, data: d })).count > 0,
  removeBasket: async (s: Scope, id: string) => (await db.basket.deleteMany({ where: { id, orgId: s.orgId } })).count > 0,
};
