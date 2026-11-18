import { describe, expect, it } from 'vitest';
import { assertFeature, checkLimit } from '@/lib/plans';
import { encrypt, decrypt } from '@/lib/crypto';
import { sanitizeMarkdown, sanitizeTicker, csvSafe } from '@/lib/sanitize';
import { mockProvider } from '@/lib/data/mock';
import { MOCK_UNIVERSE } from '@/lib/data/mock/universe';
import { GICS_SECTORS } from '@/lib/data/types';

describe('plans', () => {
  it('gates AI on FREE with upgrade target', () => {
    const r = assertFeature({ plan: 'FREE' }, 'ai');
    expect(r.allowed).toBe(false);
    expect(r.upgradeTo).toBe('PRO');
  });
  it('limits PRO to 100 AI queries/month', () => {
    expect(checkLimit({ plan: 'PRO' }, 'aiQueriesPerMonth', 99).allowed).toBe(true);
    const r = checkLimit({ plan: 'PRO' }, 'aiQueriesPerMonth', 100);
    expect(r.allowed).toBe(false);
    expect(r.upgradeTo).toBe('PRO_PLUS');
  });
  it('FREE allows 5 positions', () => {
    expect(checkLimit({ plan: 'FREE' }, 'positions', 4).allowed).toBe(true);
    expect(checkLimit({ plan: 'FREE' }, 'positions', 5).allowed).toBe(false);
  });
});

describe('crypto', () => {
  it('round-trips AES-256-GCM', () => {
    const s = encrypt('sk-test-123456');
    expect(s.last4).toBe('3456');
    expect(decrypt(s)).toBe('sk-test-123456');
  });
});

describe('sanitize', () => {
  it('strips scripts and js links', () => {
    expect(sanitizeMarkdown('<script>x</script>[a](javascript:alert(1))')).toBe('x[a](#)');
    expect(sanitizeTicker(' nvda ')).toBe('NVDA');
    expect(sanitizeTicker('DROP TABLE')).toBeNull();
    expect(csvSafe('=1+1')).toBe("'=1+1");
  });
});

describe('mock data', () => {
  it('has 50 names across all 11 sectors', () => {
    expect(MOCK_UNIVERSE).toHaveLength(50);
    expect(new Set(MOCK_UNIVERSE.map((m) => m.sector)).size).toBe(GICS_SECTORS.length);
  });
  it('is deterministic and labelled mock', async () => {
    const a = await mockProvider.getHistory('AAPL', '1Y');
    const b = await mockProvider.getHistory('AAPL', '1Y');
    expect(a.data).toEqual(b.data);
    expect(a.meta.isMock).toBe(true);
    const f = await mockProvider.getFinancials('MSFT', 'annual');
    expect(f.data!.rows.length).toBeGreaterThanOrEqual(30);
    const rows = await mockProvider.getScreenRows();
    expect(rows.data[0].whyNow.sourceIds.length).toBeGreaterThan(0);
  });
});
