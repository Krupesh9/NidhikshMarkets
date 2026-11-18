import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetUsageMeterForTests, callsToday, endpointOf, flushUsageMeter, getUsageSnapshot, isLimitError, isProviderBlocked,
  meteredFetch, nextMidnight, recordCall, recordLimitError, statusFor,
} from '@/lib/usage-meter';

let dir: string;
let now: number;
const file = () => path.join(dir, 'usage-meter.json');
const snap = (id: string) => getUsageSnapshot({}).providers.find((p) => p.id === id)!;
// 2026-11-18 15:00 UTC = 10:00 ET
const T0 = Date.parse('2026-11-18T15:00:00Z');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-meter-'));
  now = T0;
  __resetUsageMeterForTests({ file: file(), now: () => now });
});
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('windows', () => {
  it('per-minute window is rolling 60s', () => {
    for (let i = 0; i < 4; i++) recordCall('massive', { ok: true, endpoint: '/v2/snapshot' });
    expect(snap('massive').usedThisMinute).toBe(4);
    now += 30_000;
    recordCall('massive', { ok: true });
    expect(snap('massive').usedThisMinute).toBe(5);
    expect(snap('massive').status).toBe('limit_reached');
    now += 31_000; // first 4 calls are now > 60s old
    expect(snap('massive').usedThisMinute).toBe(1);
    expect(snap('massive').status).toBe('ok');
    expect(snap('massive').usedToday).toBe(5);
  });

  it('daily counter rolls over at midnight US Eastern, not UTC', () => {
    now = Date.parse('2026-11-19T03:00:00Z'); // 22:00 ET on the 18th
    recordCall('fmp', { ok: true });
    recordCall('fmp', { ok: true });
    expect(callsToday('fmp')).toBe(2);
    now = Date.parse('2026-11-19T04:59:00Z'); // 23:59 ET — same ET day although UTC day changed
    expect(callsToday('fmp')).toBe(2);
    now = Date.parse('2026-11-19T05:01:00Z'); // 00:01 ET on the 19th
    expect(callsToday('fmp')).toBe(0);
  });

  it('nextMidnight is local midnight in the zone (EST and EDT)', () => {
    expect(new Date(nextMidnight('America/New_York', T0)).toISOString()).toBe('2026-11-19T05:00:00.000Z');
    expect(new Date(nextMidnight('America/New_York', Date.parse('2026-07-01T15:00:00Z'))).toISOString()).toBe('2026-07-02T04:00:00.000Z');
    // DST ends 2026-11-01: from Oct 31 (EDT) the next midnight is Nov 1 00:00 EDT
    expect(new Date(nextMidnight('America/New_York', Date.parse('2026-10-31T15:00:00Z'))).toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
});

describe('status thresholds', () => {
  it('ok / near (>=80%) / limit_reached / blocked', () => {
    expect(statusFor([{ per: 'day', used: 199, max: 250 }], false)).toBe('ok');
    expect(statusFor([{ per: 'day', used: 200, max: 250 }], false)).toBe('near');
    expect(statusFor([{ per: 'day', used: 250, max: 250 }], false)).toBe('limit_reached');
    expect(statusFor([{ per: 'day', used: 1, max: 250 }], true)).toBe('blocked');
    // per-second pacing caps never drive the status
    expect(statusFor([{ per: 'second', used: 3, max: 1 }, { per: 'day', used: 1, max: 25 }], false)).toBe('ok');
  });

  it('snapshot reflects day usage, remaining and reset time', () => {
    for (let i = 0; i < 20; i++) recordCall('alphavantage', { ok: true });
    const p = snap('alphavantage');
    expect(p.usedToday).toBe(20);
    expect(p.remaining).toBe(5);
    expect(p.pctUsed).toBe(80);
    expect(p.status).toBe('near');
    expect(p.limitLabel).toBe('25 / day');
    for (let i = 0; i < 5; i++) recordCall('alphavantage', { ok: true });
    expect(snap('alphavantage').status).toBe('limit_reached');
    expect(snap('alphavantage').statusLabel).toBe('Limit reached — resets 12:00 AM ET');
    expect(getUsageSnapshot({}).alerts.map((a) => a.id)).toContain('alphavantage');
  });

  it('a 429 marks the provider blocked until a success or the block window passes', () => {
    recordCall('fmp', { ok: false, status: 429, endpoint: 'https://financialmodelingprep.com/stable/quote?symbol=X&apikey=SECRET', message: 'Limit Reach' });
    const p = snap('fmp');
    expect(p.status).toBe('blocked');
    expect(p.statusLabel).toMatch(/^Blocked by provider — 429 "Limit Reach" at 10:00 AM ET$/);
    expect(p.lastError?.endpoint).toBe('financialmodelingprep.com/stable/quote');
    expect(JSON.stringify(getUsageSnapshot({}))).not.toContain('SECRET');
    expect(isProviderBlocked('fmp')).toBe(true);
    now += 31 * 60_000;
    expect(isProviderBlocked('fmp')).toBe(false);
    recordCall('massive', { ok: false, status: 429 });
    expect(snap('massive').status).toBe('blocked');
    recordCall('massive', { ok: true });
    expect(snap('massive').status).toBe('ok');
  });

  it('count-only providers never reach a limit', () => {
    for (let i = 0; i < 500; i++) recordCall('news', { ok: true });
    const p = snap('news');
    expect(p.countOnly).toBe(true);
    expect(p.status).toBe('ok');
    expect(p.limitLabel).toBe('—');
  });
});

describe('persistence', () => {
  it('saves daily totals and reloads them after a restart (same ET day only)', () => {
    recordCall('fmp', { ok: true });
    recordCall('fmp', { ok: false, status: 402, endpoint: '/stable/price-target-news' });
    flushUsageMeter();
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    expect(saved.providers.fmp.day.calls).toBe(2);
    expect(saved.providers.fmp.lastError.status).toBe(402);

    __resetUsageMeterForTests({ file: file(), now: () => now }); // "restart"
    expect(callsToday('fmp')).toBe(2);
    expect(snap('fmp').lastError?.endpoint).toBe('/stable/price-target-news');
    expect(snap('fmp').usedThisMinute).toBe(0); // minute windows are memory only

    now += 24 * 3600_000;
    __resetUsageMeterForTests({ file: file(), now: () => now });
    expect(callsToday('fmp')).toBe(0);
  });

  it('carries over the legacy fmp-usage.json count for today', () => {
    fs.writeFileSync(path.join(dir, 'fmp-usage.json'), JSON.stringify({ day: '2026-11-18', calls: 51 }));
    __resetUsageMeterForTests({ file: file(), now: () => now });
    expect(callsToday('fmp')).toBe(51);
  });

  it('survives an unreadable file', () => {
    fs.writeFileSync(file(), '{not json');
    __resetUsageMeterForTests({ file: file(), now: () => now });
    recordCall('sec', { ok: true });
    expect(callsToday('sec')).toBe(1);
  });
});

describe('limit-error detection', () => {
  it.each([
    ['fmp', 429, ''],
    ['fmp', 403, '{"Error Message":"Limit Reach . Please upgrade your plan or visit our documentation for more details"}'],
    ['alphavantage', 200, '{"Information":"We have detected your API key as ... Our standard API rate limit is 25 requests per day."}'],
    ['alphavantage', 200, '{"Note":"Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute"}'],
    ['massive', 429, '{"status":"ERROR","error":"You\'ve exceeded the maximum requests per minute"}'],
    ['sec', 403, '<h1>Request Rate Threshold Exceeded</h1>'],
    ['gemini', 429, ''],
    ['gemini', 0, '[429 Too Many Requests] RESOURCE_EXHAUSTED'],
    ['anthropic', 429, ''],
  ] as const)('%s %i is a limit error', (p, status, body) => {
    expect(isLimitError(p, status, body)).toBe(true);
  });

  it.each([
    ['alphavantage', 200, '{"Information":"Thank you for using Alpha Vantage! This is a premium endpoint."}'],
    ['fmp', 402, '{"Error Message":"Premium Query Parameter"}'],
    ['massive', 403, '{"status":"NOT_AUTHORIZED"}'],
    ['alpaca', 500, ''],
  ] as const)('%s %i is not a limit error', (p, status, body) => {
    expect(isLimitError(p, status, body)).toBe(false);
  });

  it('meteredFetch counts calls, detects FMP "Limit Reach" in the body and keeps the response intact', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"Error Message":"Limit Reach . Please upgrade your plan"}', { status: 403 })));
    const r = await meteredFetch('fmp', 'https://financialmodelingprep.com/stable/grades?symbol=AAPL&apikey=k');
    expect(r.status).toBe(403);
    expect(await r.text()).toContain('Limit Reach'); // body still readable by the caller
    expect(callsToday('fmp')).toBe(1);
    expect(snap('fmp').status).toBe('blocked');
    expect(snap('fmp').lastError).toMatchObject({ status: 403, limit: true, endpoint: 'financialmodelingprep.com/stable/grades', message: 'Limit Reach' });
  });

  it('meteredFetch records network errors and rethrows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(meteredFetch('fred', 'https://api.stlouisfed.org/fred/series/observations?api_key=k')).rejects.toThrow('fetch failed');
    expect(callsToday('fred')).toBe(1);
    expect(snap('fred').lastError).toMatchObject({ status: 0, limit: false, endpoint: 'api.stlouisfed.org/fred/series/observations' });
  });

  it('recordLimitError re-labels the last call without double counting (Alpha Vantage 200 + note)', () => {
    recordCall('alphavantage', { ok: true, status: 200 });
    recordLimitError('alphavantage', { endpoint: 'www.alphavantage.co/query (OVERVIEW)', message: 'rate limit notice' });
    expect(callsToday('alphavantage')).toBe(1);
    expect(snap('alphavantage').status).toBe('blocked');
    expect(snap('alphavantage').statusLabel).toMatch(/^Blocked by provider — limit notice "rate limit notice"/);
  });

  it('endpointOf drops query strings and keys', () => {
    expect(endpointOf('https://www.alphavantage.co/query?function=OVERVIEW&apikey=XYZ')).toBe('www.alphavantage.co/query');
    expect(endpointOf('not a url?apikey=1')).toBe('not a url');
  });
});
