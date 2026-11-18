import 'server-only';
import fs from 'node:fs';
import { mockAllowed } from './mock-policy';

/**
 * Which data/AI/auth providers are configured — BOOLEANS ONLY, never key values — plus the last time each
 * provider served data in this process (in-memory; resets on restart / per serverless instance).
 * Used by Settings → Data sources and GET /api/health.
 */
export interface ProviderStatus {
  id: string;
  name: string;
  kind: 'market' | 'fundamentals' | 'macro' | 'ai' | 'auth';
  configured: boolean;
  url: string;
  purpose: string;
  lastSuccess: string | null;
}

const g = globalThis as unknown as { __ndProviderSuccess?: Map<string, string> };
const lastOk = g.__ndProviderSuccess ?? (g.__ndProviderSuccess = new Map());

/** Map a provider display name (as in DataMeta.provider) to its status id. */
const NAME_TO_ID: Record<string, string> = {
  Alpaca: 'alpaca', 'Massive (Polygon)': 'massive', 'Nidhiksh local cache': 'nidhiksh', 'SEC EDGAR': 'sec',
  'Alpha Vantage': 'alphavantage', FMP: 'fmp', 'Financial Modeling Prep': 'fmp', FRED: 'fred', Anthropic: 'anthropic', Gemini: 'gemini',
};

/** Record that `provider` (id or display name) just returned data. Cheap; safe to call on every success. */
export function recordProviderSuccess(provider: string | undefined | null, at = new Date()): void {
  if (!provider) return;
  const id = NAME_TO_ID[provider] ?? provider.toLowerCase();
  lastOk.set(id, at.toISOString());
}

const has = (env: Record<string, string | undefined>, ...names: string[]) => names.every((n) => !!env[n]?.trim());

export function getProviderStatus(env: Record<string, string | undefined> = process.env): ProviderStatus[] {
  const forceMock = env.ALPHADESK_FORCE_MOCK === '1';
  const live = (b: boolean) => b && !forceMock;
  const nidPath = env.NIDHIKSH_DB_PATH || '/Users/krupeshpatel/Documents/ChatGPT/Nidhiksh Markets/runtime/market.sqlite';
  let nidOk = false;
  try { nidOk = fs.existsSync(nidPath); } catch { nidOk = false; }
  const rows: Omit<ProviderStatus, 'lastSuccess'>[] = [
    { id: 'alpaca', name: 'Alpaca market data', kind: 'market', configured: live(has(env, 'ALPACA_API_KEY', 'ALPACA_SECRET_KEY')), url: 'https://alpaca.markets/data', purpose: 'Quotes, daily and intraday bars' },
    { id: 'massive', name: 'Massive (Polygon)', kind: 'market', configured: live(has(env, 'MASSIVE_API_KEY') || has(env, 'POLYGON_API_KEY')), url: 'https://massive.com', purpose: 'Quotes, bars, reference data, news' },
    { id: 'nidhiksh', name: 'Nidhiksh local cache', kind: 'market', configured: live(nidOk), url: '', purpose: 'Read-only local price/fundamentals cache (local only)' },
    { id: 'sec', name: 'SEC EDGAR', kind: 'fundamentals', configured: live(has(env, 'SEC_USER_AGENT')), url: 'https://www.sec.gov/edgar', purpose: 'Filings, XBRL financial statements, Form 4' },
    { id: 'alphavantage', name: 'Alpha Vantage', kind: 'fundamentals', configured: live(has(env, 'ALPHA_VANTAGE_API_KEY')), url: 'https://www.alphavantage.co', purpose: 'Consensus estimates, earnings calendar' },
    { id: 'fmp', name: 'Financial Modeling Prep', kind: 'fundamentals', configured: live(has(env, 'FMP_API_KEY')), url: 'https://site.financialmodelingprep.com', purpose: 'Analyst ratings, price targets, grade changes' },
    { id: 'fred', name: 'FRED (St. Louis Fed)', kind: 'macro', configured: has(env, 'FRED_API_KEY'), url: 'https://fred.stlouisfed.org', purpose: 'Macro release dates, Treasury yields' },
    { id: 'anthropic', name: 'Anthropic Claude', kind: 'ai', configured: has(env, 'ANTHROPIC_API_KEY'), url: 'https://www.anthropic.com', purpose: 'AI research assistant (users can also add their own key)' },
    { id: 'gemini', name: 'Google Gemini', kind: 'ai', configured: has(env, 'GEMINI_API_KEY'), url: 'https://ai.google.dev', purpose: 'AI research assistant (alternative provider)' },
    { id: 'google', name: 'Google sign-in', kind: 'auth', configured: has(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'), url: 'https://console.cloud.google.com/apis/credentials', purpose: 'OAuth sign-in for team members' },
  ];
  return rows.map((r) => ({ ...r, lastSuccess: lastOk.get(r.id) ?? null }));
}

/** Compact summary for /api/health: { alpaca: true, … , mockData: false }. */
export function providerFlags(env: Record<string, string | undefined> = process.env): Record<string, boolean> {
  return { ...Object.fromEntries(getProviderStatus(env).map((p) => [p.id, p.configured])), mockData: mockAllowed(env) };
}
