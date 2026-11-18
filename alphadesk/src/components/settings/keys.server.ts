import 'server-only';
/**
 * Per-user provider credentials (AES-256-GCM via @/lib/crypto, stored in ApiCredential).
 * Plaintext keys never leave the server: list() returns masked last-4 only.
 * Provider ids: 'anthropic' | 'gemini' | 'polygon' (Massive, formerly Polygon.io).
 */
import { db } from '@/lib/db';
import { decrypt, encrypt, mask } from '@/lib/crypto';

export const KEY_PROVIDERS = ['anthropic', 'gemini', 'polygon'] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];

export const PROVIDER_META: Record<KeyProvider, { label: string; env: string[]; purpose: string; placeholder: string }> = {
  anthropic: { label: 'Anthropic (Claude)', env: ['ANTHROPIC_API_KEY'], purpose: 'AI research assistant', placeholder: 'sk-ant-…' },
  gemini: { label: 'Google Gemini', env: ['GEMINI_API_KEY'], purpose: 'AI research assistant (alternate)', placeholder: 'AIza…' },
  polygon: { label: 'Massive (Polygon) market data', env: ['MASSIVE_API_KEY', 'POLYGON_API_KEY'], purpose: 'Live quotes, history and reference data (optional)', placeholder: 'Massive / Polygon API key' },
};

export interface KeyStatus { provider: KeyProvider; label: string; purpose: string; configured: boolean; source: 'user' | 'env' | null; masked: string | null; updatedAt: string | null }

const envKey = (p: KeyProvider) => PROVIDER_META[p].env.map((e) => process.env[e]).find((v) => !!v && v.trim().length > 0);

export async function listKeys(userId: string): Promise<KeyStatus[]> {
  const rows = await db.apiCredential.findMany({ where: { userId } });
  return KEY_PROVIDERS.map((p) => {
    const r = rows.find((x) => x.provider === p);
    const env = envKey(p);
    return {
      provider: p, label: PROVIDER_META[p].label, purpose: PROVIDER_META[p].purpose,
      configured: !!r || !!env, source: r ? 'user' : env ? 'env' : null,
      masked: r ? mask(r.last4) : env ? mask(env.slice(-4)) : null,
      updatedAt: r ? r.updatedAt.toISOString() : null,
    };
  });
}

export async function saveKey(user: { id: string; orgId: string }, provider: KeyProvider, plaintext: string) {
  const key = plaintext.trim();
  const sealed = encrypt(key);
  await db.apiCredential.upsert({
    where: { userId_provider: { userId: user.id, provider } },
    create: { userId: user.id, orgId: user.orgId, provider, ...sealed },
    update: { ...sealed },
  });
  return { provider, masked: mask(sealed.last4) };
}

export async function deleteKey(userId: string, provider: KeyProvider) {
  return (await db.apiCredential.deleteMany({ where: { userId, provider } })).count > 0;
}

/** Resolve the effective key for a provider: user's saved key first, then env. Server only. */
export async function resolveKey(userId: string, provider: KeyProvider): Promise<{ key: string; source: 'user' | 'env' } | null> {
  const r = await db.apiCredential.findUnique({ where: { userId_provider: { userId, provider } } });
  if (r) {
    try { return { key: decrypt(r), source: 'user' }; } catch { /* corrupted / rotated ENCRYPTION_KEY */ }
  }
  const env = envKey(provider);
  return env ? { key: env, source: 'env' } : null;
}

export interface TestResult { ok: boolean; configured: boolean; source?: 'user' | 'env'; status?: number; latencyMs?: number; message: string }

/**
 * Minimal, zero-cost provider call (model / reference listing — no tokens consumed). 8s timeout.
 * `fetchImpl` injectable for tests.
 */
export async function testProviderKey(provider: KeyProvider, key: string, fetchImpl: typeof fetch = fetch): Promise<Omit<TestResult, 'configured' | 'source'>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const started = Date.now();
  try {
    let res: Response;
    if (provider === 'anthropic') {
      res = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: ctrl.signal });
    } else if (provider === 'gemini') {
      res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key }, signal: ctrl.signal });
    } else {
      res = await fetchImpl('https://api.massive.com/v3/reference/tickers?ticker=AAPL&limit=1', { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal });
    }
    const latencyMs = Date.now() - started;
    if (res.ok) return { ok: true, status: res.status, latencyMs, message: `Connected to ${PROVIDER_META[provider].label} (${latencyMs} ms).` };
    const msg = res.status === 401 || res.status === 403 ? 'Key was rejected by the provider (unauthorised).' : res.status === 429 ? 'Provider rate-limited the test; the key is likely valid.' : `Provider returned HTTP ${res.status}.`;
    return { ok: res.status === 429, status: res.status, latencyMs, message: msg };
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError';
    return { ok: false, latencyMs: Date.now() - started, message: aborted ? 'Timed out after 8s — provider unreachable from this machine.' : `Network error: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
