import 'server-only';
import { db } from '@/lib/db';
import { cache } from '@/lib/cache';
import { log } from '@/lib/log';
import { VALUATION_SETTING_KEY, factoryDefaults, parseValuationDefaults, sameDefaults, type ValuationDefaults } from './defaults';

/** Settings reads are cached briefly; a save/reset busts the org's entry. */
export const VALUATION_CACHE_TTL_MS = 60_000;
const cacheKey = (orgId: string) => `settings:${VALUATION_SETTING_KEY}:${orgId}`;

export interface ValuationSettingState {
  defaults: ValuationDefaults;
  updatedAt: string | null;
  updatedById: string | null;
  /** current values equal the factory defaults */
  isFactory: boolean;
}

async function readRow(orgId: string): Promise<ValuationSettingState> {
  let row = await db.appSetting.findUnique({ where: { orgId_key: { orgId, key: VALUATION_SETTING_KEY } } });
  if (!row) {
    // First read: persist the factory defaults so the org has an explicit saved row out of the box.
    row = await db.appSetting.upsert({
      where: { orgId_key: { orgId, key: VALUATION_SETTING_KEY } },
      create: { orgId, key: VALUATION_SETTING_KEY, value: JSON.stringify(factoryDefaults()) },
      update: {},
    });
  }
  const { defaults, valid } = parseValuationDefaults(row.value);
  if (!valid) log.warn('settings.valuation.invalid_stored', { orgId });
  return { defaults, updatedAt: row.updatedAt.toISOString(), updatedById: row.updatedById ?? null, isFactory: sameDefaults(defaults, factoryDefaults()) };
}

/** Org's valuation settings (with metadata) — cached 60s. Falls back to factory defaults if the DB is unavailable. */
export async function readValuationSetting(orgId: string): Promise<ValuationSettingState> {
  try {
    return await cache.wrap(cacheKey(orgId), () => readRow(orgId), VALUATION_CACHE_TTL_MS);
  } catch (err) {
    log.warn('settings.valuation.read_failed', { orgId, err: (err as Error).message });
    return { defaults: factoryDefaults(), updatedAt: null, updatedById: null, isFactory: true };
  }
}

/** The valuation defaults every user in `orgId` sees in the Fundamental values section. */
export async function getValuationDefaults(orgId: string): Promise<ValuationDefaults> {
  return (await readValuationSetting(orgId)).defaults;
}

export async function saveValuationDefaults(user: { id: string; orgId: string }, defaults: ValuationDefaults): Promise<ValuationSettingState> {
  const value = JSON.stringify(defaults);
  await db.appSetting.upsert({
    where: { orgId_key: { orgId: user.orgId, key: VALUATION_SETTING_KEY } },
    create: { orgId: user.orgId, key: VALUATION_SETTING_KEY, value, updatedById: user.id },
    update: { value, updatedById: user.id },
  });
  cache.delete(cacheKey(user.orgId));
  return readValuationSetting(user.orgId);
}

/** Reset to factory defaults (stored explicitly, so the row records who reset it and when). */
export async function resetValuationDefaults(user: { id: string; orgId: string }): Promise<ValuationSettingState> {
  return saveValuationDefaults(user, factoryDefaults());
}

export function bustValuationCache(orgId: string): void {
  cache.delete(cacheKey(orgId));
}
