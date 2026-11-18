import { describe, expect, it } from 'vitest';
import { adaptRow, isDemoEmail, mergeSymbols, normalizePlan, parseAddUser, planImport, EXPORT_MODELS } from '../../../scripts/lib/portability.mjs';

const exported = {
  version: 1,
  users: [
    { id: 'u1', email: 'pm@nidhikshdesk.dev', role: 'ADMIN', plan: 'PRO_PLUS' },
    { id: 'u2', email: 'analyst@nidhikshdesk.dev', role: 'ANALYST', plan: 'PRO' },
    { id: 'u3', email: 'real@fund.com', role: 'ANALYST', plan: 'PRO' },
  ],
  watchlists: [
    { id: 'w1', orgId: 'o', userId: 'u1', name: 'Default', symbols: '["nvda","AAPL"]' },
    { id: 'w2', orgId: 'o', userId: 'u2', name: 'Default', symbols: '["AAPL","MSFT"]' },
    { id: 'w3', orgId: 'o', userId: 'u3', name: 'Default', symbols: '["TSLA"]' },
  ],
  portfolios: [{ id: 'p1', orgId: 'o', userId: 'u2', name: 'Core' }],
  researchNotes: [{ id: 'n1', orgId: 'o', authorId: 'u3', title: 't' }],
};

describe('data portability', () => {
  it('maps the retired PRO tier to PRO_PLUS', () => {
    expect(normalizePlan('PRO')).toBe('PRO_PLUS');
    expect(normalizePlan('PRO_PLUS')).toBe('PRO_PLUS');
    expect(normalizePlan('weird')).toBe('FREE');
  });

  it('never exports secrets tables', () => {
    const keys = EXPORT_MODELS.map(([, m]) => m);
    for (const m of ['account', 'session', 'verificationToken', 'apiCredential', 'auditLog', 'usageCounter']) expect(keys).not.toContain(m);
  });

  it('re-homes demo content to the owner, keeps real users, dedupes watchlists', () => {
    const p = planImport(exported, { targetOrgId: 'T', ownerId: 'OWNER', ownerEmail: 'owner@x.com' });
    expect(p.users).toEqual([expect.objectContaining({ id: 'u3', email: 'real@fund.com', plan: 'PRO_PLUS', orgId: 'T' })]);
    const own = p.rows.watchlists.find((w) => w.userId === 'OWNER');
    expect(own?.symbols).toEqual(['NVDA', 'AAPL', 'MSFT']);
    expect(p.rows.watchlists).toHaveLength(2);
    expect(p.rows.portfolios[0]).toMatchObject({ userId: 'OWNER', orgId: 'T' });
    expect(p.rows.researchNotes[0]).toMatchObject({ authorId: 'u3', orgId: 'T' });
  });

  it('is deterministic (same input → same plan) so re-imports are idempotent', () => {
    const a = planImport(exported, { targetOrgId: 'T', ownerId: 'O', ownerEmail: 'o@x.com' });
    const b = planImport(exported, { targetOrgId: 'T', ownerId: 'O', ownerEmail: 'o@x.com' });
    expect(a).toEqual(b);
  });

  it('adapts JSON columns to the target field type', () => {
    expect(adaptRow({ symbols: '["A"]', extra: 1 }, { symbols: 'Json' })).toEqual({ symbols: ['A'] });
    expect(adaptRow({ symbols: ['A'] }, { symbols: 'String' })).toEqual({ symbols: '["A"]' });
  });

  it('parses --add-user specs', () => {
    expect(parseAddUser('Free@X.com:free:viewer')).toEqual({ email: 'free@x.com', plan: 'FREE', role: 'VIEWER' });
    expect(parseAddUser('a@b.co:PRO')).toEqual({ email: 'a@b.co', plan: 'PRO_PLUS', role: 'VIEWER' });
    expect(() => parseAddUser('nope')).toThrow();
    expect(mergeSymbols('["a"]', ['A', 'b'])).toEqual(['A', 'B']);
    expect(isDemoEmail('intern@nidhikshdesk.dev')).toBe(true);
  });
});
