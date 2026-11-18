import 'server-only';
import { db } from '@/lib/db';
import { isNum } from './formulas';
import type { SavedPreset } from './defaults';

/** Row ticker that holds a user's global preferences (required margin of safety). */
export const GLOBAL_PRESET_TICKER = '*';

type Row = { ticker: string; growth: number | null; discount: number | null; terminal: number | null; requiredMos: number | null; note: string | null; updatedAt: Date };

function toPreset(r: Row): SavedPreset | null {
  if (!isNum(r.growth) || !isNum(r.discount) || !isNum(r.terminal) || !isNum(r.requiredMos)) return null;
  return { ticker: r.ticker, growth: r.growth, discount: r.discount, terminal: r.terminal, requiredMos: r.requiredMos, note: r.note, updatedAt: r.updatedAt.toISOString() };
}

// Every query is keyed by the session user's id, so a user can never read or change another user's rows.

export async function getPreset(userId: string, ticker: string): Promise<SavedPreset | null> {
  const r = await db.valuationPreset.findUnique({ where: { userId_ticker: { userId, ticker } } });
  return r ? toPreset(r) : null;
}

export async function listPresets(userId: string): Promise<SavedPreset[]> {
  const rows = await db.valuationPreset.findMany({ where: { userId, NOT: { ticker: GLOBAL_PRESET_TICKER } }, orderBy: { updatedAt: 'desc' }, take: 200 });
  return rows.map(toPreset).filter((p): p is SavedPreset => !!p);
}

export async function savePreset(user: { id: string; orgId: string }, ticker: string, v: { growth: number; discount: number; terminal: number; requiredMos: number; note?: string | null }): Promise<SavedPreset> {
  const data = { growth: v.growth, discount: v.discount, terminal: v.terminal, requiredMos: v.requiredMos, note: v.note ?? null };
  const r = await db.valuationPreset.upsert({
    where: { userId_ticker: { userId: user.id, ticker } },
    create: { orgId: user.orgId, userId: user.id, ticker, ...data },
    update: data,
  });
  return toPreset(r)!;
}

/** Deletes the user's own preset; returns false when they had none. */
export async function deletePreset(userId: string, ticker: string): Promise<boolean> {
  const r = await db.valuationPreset.deleteMany({ where: { userId, ticker } });
  return r.count > 0;
}

/** The user's global required margin of safety (null = none saved → org default). */
export async function getUserRequiredMos(userId: string): Promise<{ requiredMos: number | null; updatedAt: string | null }> {
  const r = await db.valuationPreset.findUnique({ where: { userId_ticker: { userId, ticker: GLOBAL_PRESET_TICKER } } });
  return { requiredMos: r && isNum(r.requiredMos) ? r.requiredMos : null, updatedAt: r ? r.updatedAt.toISOString() : null };
}

export async function setUserRequiredMos(user: { id: string; orgId: string }, requiredMos: number): Promise<{ requiredMos: number; updatedAt: string }> {
  const r = await db.valuationPreset.upsert({
    where: { userId_ticker: { userId: user.id, ticker: GLOBAL_PRESET_TICKER } },
    create: { orgId: user.orgId, userId: user.id, ticker: GLOBAL_PRESET_TICKER, requiredMos },
    update: { requiredMos },
  });
  return { requiredMos: r.requiredMos ?? requiredMos, updatedAt: r.updatedAt.toISOString() };
}
