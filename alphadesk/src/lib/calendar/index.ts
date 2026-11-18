import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cache } from '@/lib/cache';
import { cacheDir } from '@/lib/cache-dir';
import { log } from '@/lib/log';
import { getMarketData } from '@/lib/data';
import type { CalendarCategory, CalendarEvent, CalendarResult, CalendarSourceStatus } from './types';
import { addDays, todayET, weekday } from './dates';
import { fomcEvents } from './fomc';
import { MARKET_HOLIDAYS, marketEvents } from './holidays';
import { MACRO_RELEASES, macroEvent, parseFredReleaseDates } from './macro';
import { earningsEvent, parseEarningsCsv, type EarningsRow } from './earnings-csv';

export * from './types';

const HOLIDAY_SET = new Set(MARKET_HOLIDAYS.map((h) => h.date));

const FRED_TTL_MS = 12 * 60 * 60_000;
const AV_TTL_MS = 24 * 60 * 60_000;
const AV_DISK = cacheDir('av-earnings-calendar.json');
const TIMEOUT_MS = 8_000;

export interface CalendarQuery {
  from?: string;
  to?: string;
  categories?: CalendarCategory[];
  /** watchlist tickers (earnings are flagged `inWatchlist`) */
  watchlist?: string[];
  /** 'watchlist' (default) = only watchlist earnings; 'all' = watchlist + covered universe names */
  earningsScope?: 'watchlist' | 'all';
}

/* ---------------------------------- FRED ---------------------------------- */

async function fredDates(releaseId: number, start: string): Promise<{ ok: boolean; dates: string[] }> {
  const key = process.env.FRED_API_KEY;
  if (!key) return { ok: false, dates: [] };
  return cache.wrap(`cal:fred:${releaseId}:${start}`, async () => {
    try {
      const url = `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&api_key=${key}&file_type=json&include_release_dates_with_no_data=true&realtime_start=${start}&sort_order=asc&limit=200`;
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { ok: true, dates: parseFredReleaseDates(await r.json()) };
    } catch (e) {
      log.debug('calendar.fred_failed', { releaseId, err: (e as Error).message });
      return { ok: false, dates: [] };
    }
  }, FRED_TTL_MS);
}

/* ------------------------------ Alpha Vantage ------------------------------ */

interface DiskEntry { fetchedAt: string; csv: string }

async function readDisk(): Promise<DiskEntry | null> {
  try {
    const j = JSON.parse(await fs.readFile(AV_DISK, 'utf8')) as DiskEntry;
    return typeof j?.csv === 'string' && typeof j?.fetchedAt === 'string' ? j : null;
  } catch {
    return null;
  }
}

/** One call returns every US company for the next 3 months. Free tier = 25 calls/day → 24h memory + disk cache. */
async function avEarnings(): Promise<{ ok: boolean; rows: EarningsRow[]; note?: string; fetchedAt?: string }> {
  return cache.wrap('cal:av:earnings', async () => {
    const disk = await readDisk();
    const fresh = disk && Date.now() - Date.parse(disk.fetchedAt) < AV_TTL_MS;
    if (disk && fresh) return { ok: true, rows: parseEarningsCsv(disk.csv), fetchedAt: disk.fetchedAt };
    const key = process.env.ALPHA_VANTAGE_API_KEY;
    if (key) {
      try {
        const r = await fetch(`https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${key}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const csv = await r.text();
        const rows = parseEarningsCsv(csv);
        if (!rows.length) throw new Error('not CSV (rate limited or invalid key)');
        const entry: DiskEntry = { fetchedAt: new Date().toISOString(), csv };
        await fs.mkdir(path.dirname(AV_DISK), { recursive: true }).catch(() => undefined);
        await fs.writeFile(AV_DISK, JSON.stringify(entry)).catch(() => undefined);
        return { ok: true, rows, fetchedAt: entry.fetchedAt };
      } catch (e) {
        log.debug('calendar.av_failed', { err: (e as Error).message });
        if (disk) return { ok: true, rows: parseEarningsCsv(disk.csv), fetchedAt: disk.fetchedAt, note: 'stale cache (refresh failed)' };
        return { ok: false, rows: [], note: (e as Error).message };
      }
    }
    if (disk) return { ok: true, rows: parseEarningsCsv(disk.csv), fetchedAt: disk.fetchedAt, note: 'stale cache (no API key)' };
    return { ok: false, rows: [], note: 'ALPHA_VANTAGE_API_KEY not set' };
  }, AV_TTL_MS);
}

async function universeTickers(): Promise<string[]> {
  try {
    return (await getMarketData().getUniverse()).data.map((u) => u.ticker);
  } catch {
    return [];
  }
}

/** Provider catalysts for watchlist names AV didn't cover — labelled estimated. */
async function catalystEarnings(tickers: string[]): Promise<CalendarEvent[]> {
  const md = getMarketData();
  const lists = await Promise.all(tickers.slice(0, 25).map((t) => md.getCatalysts(t).catch(() => null)));
  const out: CalendarEvent[] = [];
  lists.forEach((r, i) => {
    if (!r) return;
    for (const c of r.data) {
      if (c.type !== 'earnings') continue;
      const date = c.date.slice(0, 10);
      // Companies don't report on weekends/market holidays; such dates are model artefacts.
      if ([0, 6].includes(weekday(date)) || HOLIDAY_SET.has(date)) continue;
      out.push({
        id: `cat:${tickers[i]}:${date}`, date, category: 'earnings', kind: 'earnings', ticker: tickers[i], inWatchlist: true,
        title: `${tickers[i]} earnings (estimated date)`, detail: 'Not in the Alpha Vantage calendar \u00B7 date not confirmed by the company', importance: 'high', estimated: true,
        source: { name: r.meta.isMock ? 'Estimated (demo data)' : 'Market data provider' },
      });
    }
  });
  return out;
}

/* --------------------------------- Public --------------------------------- */

/** All calendar events in [from, to] (ET dates, inclusive), sorted by date then importance. Never throws. */
export async function getCalendarEvents(q: CalendarQuery = {}): Promise<CalendarResult> {
  const today = todayET();
  const from = q.from ?? addDays(today, -7);
  const to = q.to ?? addDays(today, 90);
  const cats = new Set<CalendarCategory>(q.categories?.length ? q.categories : ['earnings', 'inflation', 'jobs', 'fed', 'growth', 'market']);
  const watch = new Set((q.watchlist ?? []).map((t) => t.toUpperCase()));
  const sources: CalendarSourceStatus[] = [];
  const events: CalendarEvent[] = [];

  try {
    const wantMacro = MACRO_RELEASES.filter((r) => cats.has(r.category));
    const [fred, av] = await Promise.all([
      Promise.all(wantMacro.map(async (r) => ({ r, res: await fredDates(r.releaseId, from) }))),
      cats.has('earnings') ? avEarnings() : Promise.resolve(null),
    ]);

    if (wantMacro.length) {
      let n = 0;
      for (const { r, res } of fred) for (const d of res.dates) { events.push(macroEvent(r, d)); n++; }
      const ok = fred.some((f) => f.res.ok);
      sources.push({ id: 'fred', name: 'FRED release calendar', ok, count: n, ...(ok ? {} : { note: process.env.FRED_API_KEY ? 'FRED unavailable' : 'FRED_API_KEY not set' }) });
    }
    if (cats.has('fed')) {
      const f = fomcEvents();
      events.push(...f);
      sources.push({ id: 'fomc', name: 'Federal Reserve FOMC schedule', ok: true, count: f.length });
    }
    if (cats.has('market')) events.push(...marketEvents());

    if (av) {
      const scope = q.earningsScope ?? 'watchlist';
      const allowed = new Set(watch);
      if (scope === 'all') for (const t of await universeTickers()) allowed.add(t.toUpperCase());
      const rows = av.rows.filter((r) => allowed.has(r.symbol));
      events.push(...rows.map((r) => earningsEvent(r, watch.has(r.symbol))));
      sources.push({ id: 'alphavantage', name: 'Alpha Vantage earnings calendar', ok: av.ok, count: rows.length, ...(av.note ? { note: av.note } : {}) });
      const covered = new Set(av.rows.map((r) => r.symbol));
      const missing = [...watch].filter((t) => !covered.has(t));
      if (missing.length) {
        const est = await catalystEarnings(missing);
        events.push(...est);
        if (est.length) sources.push({ id: 'catalysts', name: 'Provider catalysts (estimated)', ok: true, count: est.length });
      }
    }
  } catch (e) {
    log.warn('calendar.failed', { err: (e as Error).message });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  const seen = new Set<string>();
  const out = events
    .filter((e) => e.date >= from && e.date <= to && cats.has(e.category))
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => a.date.localeCompare(b.date) || rank[a.importance] - rank[b.importance] || a.title.localeCompare(b.title));
  return { events: out, meta: { from, to, today, asOf: new Date().toISOString(), sources } };
}
