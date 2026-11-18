import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the ApiCredential table.
const store = new Map<string, Record<string, unknown>>();
vi.mock('@/lib/db', () => {
  const k = (w: { userId: string; provider: string }) => `${w.userId}:${w.provider}`;
  const apiCredential = {
    findMany: async ({ where }: { where: { userId: string } }) => [...store.values()].filter((r) => r.userId === where.userId),
    findUnique: async ({ where }: { where: { userId_provider: { userId: string; provider: string } } }) => store.get(k(where.userId_provider)) ?? null,
    upsert: async ({ where, create, update }: { where: { userId_provider: { userId: string; provider: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const key = k(where.userId_provider);
      const row = store.has(key) ? { ...store.get(key), ...update, updatedAt: new Date() } : { ...create, id: key, createdAt: new Date(), updatedAt: new Date() };
      store.set(key, row);
      return row;
    },
    deleteMany: async ({ where }: { where: { userId: string; provider: string } }) => ({ count: store.delete(k(where)) ? 1 : 0 }),
  };
  return { db: { apiCredential }, default: { apiCredential } };
});

import { decrypt, encrypt, mask } from '@/lib/crypto';
import { assertFeature, checkLimit, PLAN_INFO } from '@/lib/plans';
import { deleteKey, listKeys, resolveKey, saveKey, testProviderKey } from '../keys.server';
import { nextResetDate, planChangeSummary, priceLabel, savingsLabel, usageFraction, yearlySavings } from '../billing';
import { shareGate } from '@/components/sharing/snapshot';

const user = { id: 'u1', orgId: 'o1' };

describe('API key encryption + masking', () => {
  beforeEach(() => {
    store.clear();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.MASSIVE_API_KEY;
    delete process.env.POLYGON_API_KEY;
  });

  it('round-trips through AES-256-GCM with a fresh IV each time', () => {
    const a = encrypt('sk-ant-secret-WXYZ');
    const b = encrypt('sk-ant-secret-WXYZ');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(decrypt(a)).toBe('sk-ant-secret-WXYZ');
    expect(a.last4).toBe('WXYZ');
    expect(mask(a.last4)).toBe('••••••••WXYZ');
  });

  it('detects tampering (GCM auth tag)', () => {
    const s = encrypt('sk-ant-secret-WXYZ');
    const ct = Buffer.from(s.ciphertext, 'base64');
    ct[0] ^= 0xff;
    expect(() => decrypt({ ...s, ciphertext: ct.toString('base64') })).toThrow();
  });

  it('stores only ciphertext and lists masked last-4, never plaintext', async () => {
    const r = await saveKey(user, 'anthropic', '  sk-ant-api03-supersecret-1234  ');
    expect(r.masked).toBe('••••••••1234');
    const row = store.get('u1:anthropic')!;
    expect(JSON.stringify(row)).not.toContain('supersecret');
    expect(row.last4).toBe('1234');
    const list = await listKeys('u1');
    expect(JSON.stringify(list)).not.toContain('supersecret');
    expect(list.find((k) => k.provider === 'anthropic')).toMatchObject({ configured: true, source: 'user', masked: '••••••••1234' });
    expect(list.find((k) => k.provider === 'gemini')).toMatchObject({ configured: false, source: null, masked: null });
    expect(await resolveKey('u1', 'anthropic')).toEqual({ key: 'sk-ant-api03-supersecret-1234', source: 'user' });
  });

  it('user key overrides env; delete falls back to env', async () => {
    process.env.GEMINI_API_KEY = 'AIzaEnvKey-9999';
    expect((await listKeys('u1')).find((k) => k.provider === 'gemini')).toMatchObject({ source: 'env', masked: '••••••••9999' });
    await saveKey(user, 'gemini', 'AIzaUserKey-5555');
    expect(await resolveKey('u1', 'gemini')).toEqual({ key: 'AIzaUserKey-5555', source: 'user' });
    expect(await deleteKey('u1', 'gemini')).toBe(true);
    expect(await resolveKey('u1', 'gemini')).toEqual({ key: 'AIzaEnvKey-9999', source: 'env' });
  });

  it('test connection: reports ok / rejected / network errors without leaking the key', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const ok = (async (url: string, init?: RequestInit) => { seen.push({ url, init }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const r1 = await testProviderKey('anthropic', 'sk-ant-1', ok);
    expect(r1.ok).toBe(true);
    expect(seen[0].url).toContain('api.anthropic.com/v1/models');
    expect((seen[0].init?.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-1');
    const r2 = await testProviderKey('gemini', 'bad', (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch);
    expect(r2).toMatchObject({ ok: false, status: 401 });
    expect(r2.message).toMatch(/rejected/);
    const r3 = await testProviderKey('polygon', 'k', (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    expect(r3.ok).toBe(false);
    expect(r3.message).toMatch(/ECONNREFUSED/);
  });
});

describe('plan pricing', () => {
  it('computes yearly savings from plan constants (Pro $100, Pro Plus $200)', () => {
    expect(yearlySavings('FREE')).toBe(0);
    expect(yearlySavings('PRO')).toBe(PLAN_INFO.PRO.priceMonthly * 12 - PLAN_INFO.PRO.priceYearly);
    expect(yearlySavings('PRO')).toBe(100);
    expect(yearlySavings('PRO_PLUS')).toBe(200);
    expect(savingsLabel('PRO')).toBe('save $100');
    expect(savingsLabel('FREE')).toBeNull();
    expect(priceLabel('PRO', 'monthly')).toBe('$50/mo');
    expect(priceLabel('PRO_PLUS', 'yearly')).toBe('$1,000/yr');
  });
});

describe('plan toggle effects', () => {
  it('FREE → PRO unlocks AI (100/mo) and sharing, not baskets or team', () => {
    expect(assertFeature({ plan: 'FREE' }, 'ai').allowed).toBe(false);
    expect(assertFeature({ plan: 'PRO' }, 'ai').allowed).toBe(true);
    expect(checkLimit({ plan: 'PRO' }, 'aiQueriesPerMonth', 99).allowed).toBe(true);
    expect(checkLimit({ plan: 'PRO' }, 'aiQueriesPerMonth', 100).allowed).toBe(false);
    expect(shareGate({ plan: 'PRO' }, 'note').allowed).toBe(true);
    expect(shareGate({ plan: 'PRO' }, 'basket').allowed).toBe(false);
    expect(assertFeature({ plan: 'PRO' }, 'team').allowed).toBe(false);
    expect(planChangeSummary('FREE', 'PRO')).toEqual(['AI queries: 0 → 100 / month', 'Positions: 5 → 50', 'Sharing unlocked']);
  });
  it('PRO → PRO_PLUS unlocks unlimited AI, basket sharing and 5 seats', () => {
    expect(checkLimit({ plan: 'PRO_PLUS' }, 'aiQueriesPerMonth', 10_000).allowed).toBe(true);
    expect(shareGate({ plan: 'PRO_PLUS' }, 'basket').allowed).toBe(true);
    expect(checkLimit({ plan: 'PRO_PLUS' }, 'seats', 4).allowed).toBe(true);
    expect(checkLimit({ plan: 'PRO_PLUS' }, 'seats', 5).allowed).toBe(false);
    expect(planChangeSummary('PRO', 'PRO_PLUS')).toContain('Basket sharing unlocked');
    expect(planChangeSummary('PRO', 'PRO_PLUS')).toContain('Team seats: 5');
  });
  it('downgrade to FREE re-locks sharing and lists what is lost', () => {
    expect(shareGate({ plan: 'FREE' }, 'note').allowed).toBe(false);
    expect(planChangeSummary('PRO_PLUS', 'FREE')).toEqual(expect.arrayContaining(['Sharing disabled (existing shares stay visible)', 'Team management disabled']));
    expect(planChangeSummary('PRO', 'PRO')).toEqual([]);
  });
  it('usage meter math + monthly reset', () => {
    expect(usageFraction(37, 100)).toBeCloseTo(0.37);
    expect(usageFraction(150, 100)).toBe(1);
    expect(usageFraction(5, Infinity)).toBe(0);
    expect(usageFraction(0, 0)).toBe(0);
    expect(nextResetDate(new Date('2026-12-15T10:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
