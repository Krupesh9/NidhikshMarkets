import { describe, expect, it } from 'vitest';
import { getProviderStatus, providerFlags, recordProviderSuccess } from '@/lib/data/providers-status';

describe('provider status', () => {
  it('reports booleans only, never key values', () => {
    const env = { ALPACA_API_KEY: 'AKSECRET123', ALPACA_SECRET_KEY: 'sssh-very-secret', FMP_API_KEY: 'fmpkey-XYZ', NODE_ENV: 'production', NIDHIKSH_DB_PATH: '/nonexistent/x.sqlite' };
    const s = getProviderStatus(env);
    const json = JSON.stringify(s) + JSON.stringify(providerFlags(env));
    for (const v of ['AKSECRET123', 'sssh-very-secret', 'fmpkey-XYZ']) expect(json).not.toContain(v);
    expect(s.find((p) => p.id === 'alpaca')?.configured).toBe(true);
    expect(s.find((p) => p.id === 'massive')?.configured).toBe(false);
    expect(s.find((p) => p.id === 'nidhiksh')?.configured).toBe(false);
    expect(providerFlags(env).mockData).toBe(false);
  });
  it('records last success by display name', () => {
    recordProviderSuccess('Alpha Vantage', new Date('2026-11-18T10:00:00Z'));
    expect(getProviderStatus({}).find((p) => p.id === 'alphavantage')?.lastSuccess).toBe('2026-11-18T10:00:00.000Z');
  });
});
