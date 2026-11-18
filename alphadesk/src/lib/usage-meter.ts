import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { cacheDir } from './cache-dir';
import { log } from './log';
import { getProviderStatus } from './data/providers-status';

/**
 * Outbound API usage meter — one place that counts every call this app makes to an external data/AI provider,
 * compares it against that provider's published limit and remembers limit errors (HTTP 429, FMP "Limit Reach",
 * Alpha Vantage "rate limit" notes …).
 *
 *  - Daily totals (per provider, in the provider's reset time zone) are persisted to `.cache/usage-meter.json`
 *    so a restart keeps today's counts. Per-second / per-minute windows are sliding and in memory only.
 *  - Only the endpoint PATH is stored (host + pathname) — never query strings, headers or keys.
 *  - Counters are per process. On Vercel each serverless instance has its own counter (and its own /tmp file),
 *    so the numbers shown are a lower bound of real usage; the provider's own 429 is the authoritative signal.
 */

export type MeterProviderId =
  | 'fmp' | 'alphavantage' | 'massive' | 'alpaca' | 'sec' | 'fred' | 'holdings' | 'news' | 'logos' | 'anthropic' | 'gemini';

export type LimitWindow = 'second' | 'minute' | 'day';
export interface LimitDef { per: LimitWindow; max: number }

export interface ProviderLimitDef {
  id: MeterProviderId;
  name: string;
  /** plan the limits describe, e.g. "Free (Basic)" */
  plan: string;
  /** published limits; empty = count only (no published limit) */
  limits: LimitDef[];
  /** app-side guard below the published limit (FMP stops itself here) */
  budget?: { per: LimitWindow; max: number };
  /** time zone in which the daily counter resets */
  resetTz: string;
  docsUrl: string;
  /** where to buy more quota (paid tiers) */
  upgradeUrl?: string;
  /** where the stated limit comes from */
  source: string;
  /** how long a provider limit error keeps the status at "blocked" (cleared early by a later success) */
  blockMs: number;
}

const ET = 'America/New_York';
const envNum = (env: Record<string, string | undefined>, name: string, dflt: number) => {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

/**
 * Limits registry. Free-tier numbers were checked against each provider's docs on 2026-11-18 (curl):
 *  - FMP: site.financialmodelingprep.com/developer/docs/pricing → "Basic $0 … 250 Calls / Day".
 *  - Alpha Vantage: alphavantage.co/support → "25 API requests per day"; the 1 request/second burst cap is the
 *    message AV returns when calls are too close together (and the adapter already spaces calls ≥1.2s).
 *  - Massive (Polygon): massive.com/pricing → Stocks Basic "5 API Calls / Minute".
 *  - Alpaca: docs.alpaca.markets/docs/about-market-data-api → Basic "Historical API calls 200 / min";
 *    alpaca.markets/support/usage-limit-api-calls → "200 requests per minute, per account".
 *  - SEC EDGAR: sec.gov/os/accessing-edgar-data → "Current max request rate: 10 requests/second".
 *  - FRED: fred.stlouisfed.org/docs/api (API key / rate limits): 120 requests per minute. The FRED docs host
 *    did not answer from this machine during verification, so this one is from the published docs, not re-checked.
 *  - Nasdaq.com / State Street holdings, news RSS feeds, logo sources, Anthropic, Gemini: count only (no published
 *    free limit, or the limit depends on the account's own tier).
 * Each limit can be overridden with an env var (see `envOverrides` below), e.g. FMP_PLAN_DAILY_LIMIT=300.
 */
export function providerLimits(env: Record<string, string | undefined> = process.env): ProviderLimitDef[] {
  return [
    {
      id: 'fmp', name: 'Financial Modeling Prep', plan: 'Basic (free)',
      limits: [{ per: 'day', max: envNum(env, 'FMP_PLAN_DAILY_LIMIT', 250) }],
      // FMP_DAILY_LIMIT keeps its documented meaning: the app's own daily stop (default 240, i.e. 10 calls of headroom).
      budget: { per: 'day', max: envNum(env, 'FMP_DAILY_LIMIT', 240) },
      resetTz: ET, docsUrl: 'https://site.financialmodelingprep.com/developer/docs', upgradeUrl: 'https://site.financialmodelingprep.com/developer/docs/pricing',
      source: 'FMP pricing page: Basic 250 calls/day', blockMs: 30 * 60_000,
    },
    {
      id: 'alphavantage', name: 'Alpha Vantage', plan: 'Free',
      limits: [{ per: 'day', max: envNum(env, 'ALPHAVANTAGE_DAILY_LIMIT', 25) }, { per: 'second', max: envNum(env, 'ALPHAVANTAGE_SECOND_LIMIT', 1) }],
      resetTz: ET, docsUrl: 'https://www.alphavantage.co/documentation/', upgradeUrl: 'https://www.alphavantage.co/premium/',
      source: 'alphavantage.co/support: 25 requests/day', blockMs: 60 * 60_000,
    },
    {
      id: 'massive', name: 'Massive (Polygon)', plan: 'Stocks Basic (free)',
      limits: [{ per: 'minute', max: envNum(env, 'MASSIVE_MINUTE_LIMIT', 5) }],
      resetTz: ET, docsUrl: 'https://massive.com/docs', upgradeUrl: 'https://massive.com/pricing',
      source: 'massive.com/pricing: 5 API calls/minute', blockMs: 65_000,
    },
    {
      id: 'alpaca', name: 'Alpaca market data', plan: 'Basic (free)',
      limits: [{ per: 'minute', max: envNum(env, 'ALPACA_MINUTE_LIMIT', 200) }],
      resetTz: ET, docsUrl: 'https://docs.alpaca.markets/docs/about-market-data-api', upgradeUrl: 'https://alpaca.markets/data',
      source: 'Alpaca market data docs: 200 calls/min', blockMs: 65_000,
    },
    {
      id: 'sec', name: 'SEC EDGAR', plan: 'Fair access',
      limits: [{ per: 'second', max: envNum(env, 'SEC_SECOND_LIMIT', 10) }],
      resetTz: ET, docsUrl: 'https://www.sec.gov/os/accessing-edgar-data',
      source: 'sec.gov fair access: 10 requests/second', blockMs: 10 * 60_000,
    },
    {
      id: 'fred', name: 'FRED (St. Louis Fed)', plan: 'Free API key',
      limits: [{ per: 'minute', max: envNum(env, 'FRED_MINUTE_LIMIT', 120) }],
      resetTz: ET, docsUrl: 'https://fred.stlouisfed.org/docs/api/fred/',
      source: 'FRED API docs: 120 requests/minute', blockMs: 65_000,
    },
    { id: 'holdings', name: 'Nasdaq / State Street holdings', plan: 'Public files', limits: [], resetTz: ET, docsUrl: 'https://www.ssga.com/us/en/intermediary/etfs/fund-finder', source: 'No published limit (count only)', blockMs: 10 * 60_000 },
    { id: 'news', name: 'News feeds (RSS / Google News)', plan: 'Public feeds', limits: [], resetTz: ET, docsUrl: 'https://news.google.com', source: 'No published limit (count only)', blockMs: 10 * 60_000 },
    { id: 'logos', name: 'Logo sources', plan: 'Public', limits: [], resetTz: ET, docsUrl: 'https://logoapi.sh', source: 'No published limit (count only)', blockMs: 10 * 60_000 },
    { id: 'anthropic', name: 'Anthropic Claude', plan: 'Per account tier', limits: [], resetTz: ET, docsUrl: 'https://docs.claude.com/en/api/rate-limits', upgradeUrl: 'https://console.anthropic.com/settings/limits', source: 'Depends on the key\'s usage tier (count only)', blockMs: 2 * 60_000 },
    { id: 'gemini', name: 'Google Gemini', plan: 'Per account tier', limits: [], resetTz: ET, docsUrl: 'https://ai.google.dev/gemini-api/docs/rate-limits', upgradeUrl: 'https://aistudio.google.com', source: 'Depends on the key\'s tier (count only)', blockMs: 2 * 60_000 },
  ];
}

/* --------------------------------- state --------------------------------- */

export interface LastError { status: number; at: string; endpoint: string; limit: boolean; message?: string }
interface DayCounter { day: string; calls: number; errors: number; limitErrors: number }
interface ProviderState {
  day: DayCounter;
  /** timestamps (ms) of calls in the last 60s */
  recent: number[];
  lastError: LastError | null;
  lastSuccessAt: string | null;
  /** epoch ms until which the provider counts as blocked (after a limit error) */
  blockedUntil: number;
}
interface PersistShape { v: 1; providers: Partial<Record<MeterProviderId, { day: DayCounter; lastError: LastError | null; lastSuccessAt: string | null; blockedUntil: number }>> }

interface MeterGlobal { state: Map<MeterProviderId, ProviderState>; loaded: boolean; file: string; saveTimer: ReturnType<typeof setTimeout> | null; now: () => number }
const g = globalThis as unknown as { __ndUsageMeter?: MeterGlobal };
const M: MeterGlobal = g.__ndUsageMeter ?? (g.__ndUsageMeter = { state: new Map(), loaded: false, file: cacheDir('usage-meter.json'), saveTimer: null, now: () => Date.now() });

const defOf = (id: MeterProviderId) => providerLimits().find((d) => d.id === id)!;

/** Calendar day (YYYY-MM-DD) of `ms` in time zone `tz`. */
export function dayIn(tz: string, ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
}

/** Epoch ms of the next local midnight in `tz` after `ms` (DST-safe). */
export function nextMidnight(tz: string, ms: number): number {
  const [y, m, d] = dayIn(tz, ms).split('-').map(Number);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
  };
  const guess = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // second pass corrects a DST switch between guess and t
  return t;
}

function load() {
  if (M.loaded) return;
  M.loaded = true;
  try {
    const j = JSON.parse(fs.readFileSync(M.file, 'utf8')) as PersistShape;
    for (const [id, p] of Object.entries(j.providers ?? {}) as [MeterProviderId, NonNullable<PersistShape['providers'][MeterProviderId]>][]) {
      if (!p?.day) continue;
      M.state.set(id, { day: p.day, recent: [], lastError: p.lastError ?? null, lastSuccessAt: p.lastSuccessAt ?? null, blockedUntil: p.blockedUntil ?? 0 });
    }
  } catch { /* first run / unreadable → start empty */ }
  // one-time carry-over from the old FMP-only counter so today's FMP count isn't lost on upgrade
  try {
    const old = JSON.parse(fs.readFileSync(path.join(path.dirname(M.file), 'fmp-usage.json'), 'utf8')) as { day: string; calls: number };
    const s = stateOf('fmp');
    if (old.day === s.day.day && old.calls > s.day.calls) s.day.calls = old.calls;
  } catch { /* none */ }
}

function stateOf(id: MeterProviderId): ProviderState {
  load();
  const today = dayIn(defOf(id).resetTz, M.now());
  let s = M.state.get(id);
  if (!s) { s = { day: { day: today, calls: 0, errors: 0, limitErrors: 0 }, recent: [], lastError: null, lastSuccessAt: null, blockedUntil: 0 }; M.state.set(id, s); }
  if (s.day.day !== today) s.day = { day: today, calls: 0, errors: 0, limitErrors: 0 }; // day rollover
  const cutoff = M.now() - 60_000;
  if (s.recent.length && s.recent[0] <= cutoff) s.recent = s.recent.filter((t) => t > cutoff);
  return s;
}

function persistSoon() {
  if (M.saveTimer) return;
  M.saveTimer = setTimeout(() => { M.saveTimer = null; flushUsageMeter(); }, 1_000);
  (M.saveTimer as { unref?: () => void }).unref?.();
}

/** Write daily totals to disk now (also used by tests). Best effort. */
export function flushUsageMeter(): void {
  if (M.saveTimer) { clearTimeout(M.saveTimer); M.saveTimer = null; }
  const out: PersistShape = { v: 1, providers: {} };
  for (const [id, s] of M.state) out.providers[id] = { day: s.day, lastError: s.lastError, lastSuccessAt: s.lastSuccessAt, blockedUntil: s.blockedUntil };
  try {
    fs.mkdirSync(path.dirname(M.file), { recursive: true });
    fs.writeFileSync(M.file, JSON.stringify(out));
  } catch (e) { log.debug('usage_meter.save_failed', { err: (e as Error).message }); }
}

/** Host + path of a URL — never the query string (FRED/FMP/AV keys travel there) or fragment. */
export function endpointOf(url: string | URL): string {
  try {
    const u = typeof url === 'string' ? new URL(url) : url;
    return `${u.host}${u.pathname}`.slice(0, 160);
  } catch {
    return String(url).split(/[?#]/)[0].slice(0, 160);
  }
}

/* -------------------------- limit-error detection -------------------------- */

/**
 * Does this response mean "you hit the provider's limit"? HTTP 429 always does; some providers signal it in the
 * body instead (FMP "Limit Reach", Alpha Vantage "Information"/"Note" rate-limit notes with HTTP 200,
 * SEC "Request Rate Threshold Exceeded" with HTTP 403, Gemini RESOURCE_EXHAUSTED).
 */
export function isLimitError(provider: MeterProviderId, status: number, body?: string | null): boolean {
  if (status === 429) return true;
  const b = (body ?? '').slice(0, 4000);
  if (!b) return false;
  switch (provider) {
    case 'fmp': return /limit reach/i.test(b);
    case 'alphavantage': return /rate limit|requests per day|call frequency|spreading out your free api requests/i.test(b) && !/premium endpoint/i.test(b);
    case 'sec': return /request rate threshold exceeded/i.test(b);
    case 'gemini': return /RESOURCE_EXHAUSTED|quota/i.test(b);
    case 'anthropic': return /rate_limit_error/i.test(b);
    default: return false;
  }
}

/* --------------------------------- record --------------------------------- */

export interface CallInfo {
  ok: boolean;
  /** HTTP status (0 = network error / timeout) */
  status?: number;
  /** full URL or path; only host + path are kept */
  endpoint?: string;
  /** set when the call was rejected because of a provider limit (429 is detected automatically) */
  limitError?: boolean;
  /** short human note, e.g. "Limit Reach" — never include keys */
  message?: string;
}

/** Count one outbound call to `provider`. Cheap and synchronous; never throws. */
export function recordCall(provider: MeterProviderId, info: CallInfo): void {
  try {
    const s = stateOf(provider);
    const now = M.now();
    s.day.calls += 1;
    s.recent.push(now);
    const status = info.status ?? (info.ok ? 200 : 0);
    const endpoint = !info.endpoint ? '' : info.endpoint.includes('://') ? endpointOf(info.endpoint) : info.endpoint.split(/[?#]/)[0].slice(0, 160);
    if (info.ok && !info.limitError) {
      s.lastSuccessAt = new Date(now).toISOString();
      s.blockedUntil = 0; // the provider answered normally again
    } else {
      const limit = !!info.limitError || status === 429;
      s.day.errors += 1;
      if (limit) { s.day.limitErrors += 1; s.blockedUntil = now + defOf(provider).blockMs; }
      s.lastError = { status, at: new Date(now).toISOString(), endpoint, limit, ...(info.message ? { message: info.message.slice(0, 120) } : {}) };
    }
    persistSoon();
  } catch (e) {
    log.debug('usage_meter.record_failed', { provider, err: (e as Error).message });
  }
}

/**
 * Mark the latest (already counted) call as a provider limit error — for providers that answer HTTP 200 with a
 * limit note in the body (Alpha Vantage). Does not add to the call count.
 */
export function recordLimitError(provider: MeterProviderId, info: { status?: number; endpoint?: string; message?: string }): void {
  const s = stateOf(provider);
  s.day.calls = Math.max(0, s.day.calls - 1);
  s.recent.pop();
  recordCall(provider, { ok: false, limitError: true, status: info.status ?? 200, endpoint: info.endpoint, message: info.message });
}

/**
 * `fetch` that counts the call against `provider`. Behaviour is unchanged: same Response (or thrown error) as fetch.
 * Error responses (≥400) are inspected for provider-specific limit messages via a clone.
 */
export async function meteredFetch(provider: MeterProviderId, input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const endpoint = endpointOf(typeof input === 'string' || input instanceof URL ? input : input.url);
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (e) {
    recordCall(provider, { ok: false, status: 0, endpoint, message: (e as Error).name === 'TimeoutError' ? 'timeout' : 'network error' });
    throw e;
  }
  if (res.ok) {
    recordCall(provider, { ok: true, status: res.status, endpoint });
  } else {
    let body = '';
    try { body = (await res.clone().text()).slice(0, 4000); } catch { body = ''; }
    const limit = isLimitError(provider, res.status, body);
    const note = provider === 'fmp' && /limit reach/i.test(body) ? 'Limit Reach' : limit ? 'rate limited' : undefined;
    recordCall(provider, { ok: false, status: res.status, endpoint, limitError: limit, message: note });
  }
  return res;
}

/** True while the provider recently rejected us for a limit (FMP's guard uses this to stop calling). */
export function isProviderBlocked(provider: MeterProviderId): boolean {
  return stateOf(provider).blockedUntil > M.now();
}

/**
 * Whether one more call fits the provider's per-minute limit right now (and the provider isn't blocking us).
 * Callers skip the provider (and fall back to the next source) instead of earning a 429.
 */
export function hasMinuteBudget(provider: MeterProviderId): boolean {
  if (isProviderBlocked(provider)) return false;
  const def = providerLimits().find((d) => d.id === provider);
  const max = def?.limits.find((l) => l.per === 'minute')?.max;
  if (!max) return true;
  const now = M.now();
  return stateOf(provider).recent.filter((t) => t > now - 60_000).length < max;
}

/** Calls counted today (provider's reset day). */
export function callsToday(provider: MeterProviderId): number {
  return stateOf(provider).day.calls;
}

/* -------------------------------- snapshot -------------------------------- */

export type UsageStatus = 'ok' | 'near' | 'limit_reached' | 'blocked';

export interface LimitUsage { per: LimitWindow; max: number; used: number; remaining: number; pct: number; resetsAt: string; label: string }

export interface ProviderUsage {
  id: MeterProviderId;
  name: string;
  plan: string;
  configured: boolean;
  countOnly: boolean;
  limits: LimitUsage[];
  /** primary limit label, e.g. "250 / day" ("—" when count only) */
  limitLabel: string;
  budget: { per: LimitWindow; max: number } | null;
  usedToday: number;
  usedThisMinute: number;
  errorsToday: number;
  /** remaining against the binding (most used) limit; null when count only */
  remaining: number | null;
  /** % used of the binding limit (0-100+) */
  pctUsed: number;
  status: UsageStatus;
  /** when the binding limit (or block) resets */
  resetsAt: string | null;
  /** short human status, e.g. "Limit reached — resets 12:00 AM ET" */
  statusLabel: string;
  lastError: LastError | null;
  lastSuccessAt: string | null;
  docsUrl: string;
  upgradeUrl: string | null;
  source: string;
}

export interface UsageSnapshot {
  asOf: string;
  providers: ProviderUsage[];
  alerts: { id: MeterProviderId; status: UsageStatus; message: string }[];
  note: string;
}

const PER_LABEL: Record<LimitWindow, string> = { second: 'sec', minute: 'min', day: 'day' };
const NEAR = 0.8;
const fmtTime = (ms: number, tz: string) => new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
const tzAbbr = (tz: string) => (tz === ET ? 'ET' : tz);

/** Status for a set of limit usages + block flag (pure; exported for tests). */
export function statusFor(limits: Pick<LimitUsage, 'used' | 'max' | 'per'>[], blocked: boolean): UsageStatus {
  if (blocked) return 'blocked';
  // per-second caps are pacing rules handled by the adapters; they would only flicker, so they don't drive status
  const l = limits.filter((x) => x.per !== 'second');
  if (l.some((x) => x.used >= x.max)) return 'limit_reached';
  if (l.some((x) => x.used >= x.max * NEAR)) return 'near';
  return 'ok';
}

export function getUsageSnapshot(env: Record<string, string | undefined> = process.env): UsageSnapshot {
  const now = M.now();
  let configured: Record<string, boolean> = {};
  try { configured = Object.fromEntries(getProviderStatus(env).map((p) => [p.id, p.configured])); } catch { configured = {}; }
  const forceMock = env.ALPHADESK_FORCE_MOCK === '1';
  const providers: ProviderUsage[] = providerLimits(env).map((d) => {
    const s = stateOf(d.id);
    const inLast = (ms: number) => s.recent.filter((t) => t > now - ms).length;
    const limits: LimitUsage[] = d.limits.map((l) => {
      const used = l.per === 'day' ? s.day.calls : l.per === 'minute' ? inLast(60_000) : inLast(1_000);
      const resetsAt = l.per === 'day' ? nextMidnight(d.resetTz, now) : l.per === 'minute' ? (s.recent.find((t) => t > now - 60_000) ?? now) + 60_000 : now + 1_000;
      return { per: l.per, max: l.max, used, remaining: Math.max(0, l.max - used), pct: Math.round((used / l.max) * 1000) / 10, resetsAt: new Date(resetsAt).toISOString(), label: `${l.max.toLocaleString('en-US')} / ${PER_LABEL[l.per]}` };
    });
    const blocked = s.blockedUntil > now;
    const status = statusFor(limits, blocked);
    const statusDriving = limits.filter((l) => l.per !== 'second');
    const binding = [...statusDriving].sort((a, b) => b.pct - a.pct)[0] ?? limits[0];
    const resetsAt = binding?.resetsAt ?? (blocked ? new Date(s.blockedUntil).toISOString() : null);
    let statusLabel = 'OK';
    if (status === 'blocked') {
      const e = s.lastError;
      statusLabel = `Blocked by provider — ${e?.status && e.status !== 200 ? e.status : 'limit notice'}${e?.message && e.message !== 'rate limited' ? ` "${e.message}"` : ''} at ${fmtTime(Date.parse(e?.at ?? new Date(now).toISOString()), d.resetTz)} ${tzAbbr(d.resetTz)}`;
    } else if (status === 'limit_reached' && binding) {
      statusLabel = binding.per === 'day' ? `Limit reached — resets ${fmtTime(Date.parse(binding.resetsAt), d.resetTz)} ${tzAbbr(d.resetTz)}` : `Limit reached — resets in ${Math.max(1, Math.ceil((Date.parse(binding.resetsAt) - now) / 1000))}s`;
    } else if (status === 'near') statusLabel = 'Near limit';
    const daily = d.budget && d.budget.per === 'day' ? d.budget : null;
    return {
      id: d.id, name: d.name, plan: d.plan,
      configured: d.id === 'holdings' || d.id === 'news' || d.id === 'logos' ? !forceMock : !!configured[d.id],
      countOnly: d.limits.length === 0,
      limits,
      limitLabel: limits.filter((l) => l.per !== 'second').map((l) => l.label)[0] ?? limits[0]?.label ?? '—',
      budget: daily,
      usedToday: s.day.calls,
      usedThisMinute: inLast(60_000),
      errorsToday: s.day.errors,
      remaining: binding ? binding.remaining : null,
      pctUsed: binding ? binding.pct : 0,
      status,
      resetsAt,
      statusLabel,
      lastError: s.lastError,
      lastSuccessAt: s.lastSuccessAt,
      docsUrl: d.docsUrl,
      upgradeUrl: d.upgradeUrl ?? null,
      source: d.source,
    };
  });
  const alerts = providers.filter((p) => p.status === 'limit_reached' || p.status === 'blocked').map((p) => {
    const day = p.limits.find((l) => l.per === 'day');
    const msg = p.status === 'blocked'
      ? `${p.name}: ${p.statusLabel.replace(/^Blocked by provider — /, 'provider returned ')}${day ? ' — daily limit, resets at midnight ET' : ''}`
      : `${p.name} ${day && day.used >= day.max ? 'daily' : 'per-minute'} limit reached${day && day.used >= day.max ? ' — resets at midnight ET' : ''}`;
    return { id: p.id, status: p.status, message: msg };
  });
  return {
    asOf: new Date(now).toISOString(),
    providers,
    alerts,
    note: env.VERCEL
      ? 'Counts are per server instance (serverless) and reset when an instance is recycled; the provider’s own limit error is the authoritative signal.'
      : 'Counts are kept by this server process and saved to disk daily; another app using the same key is not counted here.',
  };
}

/** Compact snapshot for GET /api/health — numbers and status only. */
export function usageHealth(): Record<string, { usedToday: number; usedThisMinute: number; limit: string; status: UsageStatus }> {
  return Object.fromEntries(getUsageSnapshot().providers.map((p) => [p.id, { usedToday: p.usedToday, usedThisMinute: p.usedThisMinute, limit: p.limitLabel, status: p.status }]));
}

/* ------------------------------- test hooks ------------------------------- */

/** Reset all state; optionally point persistence at `file` and inject a clock. Tests only. */
export function __resetUsageMeterForTests(opts: { file?: string; now?: () => number } = {}): void {
  if (M.saveTimer) { clearTimeout(M.saveTimer); M.saveTimer = null; }
  M.state.clear();
  M.loaded = false;
  M.file = opts.file ?? cacheDir('usage-meter.json');
  M.now = opts.now ?? (() => Date.now());
}
