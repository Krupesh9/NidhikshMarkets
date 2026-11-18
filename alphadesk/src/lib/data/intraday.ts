// Intraday range helpers (pure; no server-only so they are unit-testable).
// 1D = latest regular session in 5-minute bars; 1W = last 5 regular sessions in 30-minute bars.
// Intraday Bar.date is a full ISO timestamp without milliseconds, e.g. 2026-11-17T14:35:00Z.
import type { Bar } from './types';

export interface IntradaySpec { minutes: 5 | 30; sessions: number; /** calendar days to look back to cover `sessions` (weekends/holidays) */ lookbackDays: number }

export function intradaySpec(range: '1D' | '1W'): IntradaySpec {
  return range === '1D' ? { minutes: 5, sessions: 1, lookbackDays: 6 } : { minutes: 30, sessions: 5, lookbackDays: 12 };
}

const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** New York calendar date (YYYY-MM-DD) and minutes since local midnight for an instant. */
export function nyParts(ts: string | number | Date): { date: string; minutes: number } {
  const parts = Object.fromEntries(NY.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const OPEN_MIN = 9 * 60 + 30;
export const CLOSE_MIN = 16 * 60;

/** True when a bar starting at `ts` lies inside the 09:30–16:00 ET regular session. */
export function isRegularSession(ts: string | number | Date): boolean {
  const { minutes } = nyParts(ts);
  return minutes >= OPEN_MIN && minutes < CLOSE_MIN;
}

/** `2026-11-17T14:35:00Z` (second precision, no millis). */
export const isoMinute = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** UTC instant of the 09:30 ET open on a New York calendar date (handles EST/EDT). */
export function sessionOpenUtc(ymd: string): number {
  for (const h of [13, 14]) {
    const t = Date.parse(`${ymd}T${String(h).padStart(2, '0')}:30:00Z`);
    if (nyParts(t).minutes === OPEN_MIN) return t;
  }
  return Date.parse(`${ymd}T14:30:00Z`);
}

/** Keep regular-session bars and only the last `sessions` trading days, oldest first. */
export function lastSessions(bars: Bar[], sessions: number): Bar[] {
  const rth = bars.filter((b) => isRegularSession(b.date)).sort((a, b) => a.date.localeCompare(b.date));
  const days = Array.from(new Set(rth.map((b) => nyParts(b.date).date)));
  const keep = new Set(days.slice(-sessions));
  return rth.filter((b) => keep.has(nyParts(b.date).date));
}

/** Calendar-days lookback start for an intraday request. */
export function intradayStart(range: '1D' | '1W', now = Date.now()): Date {
  return new Date(now - intradaySpec(range).lookbackDays * 86_400_000);
}

/**
 * Synthesise plausible intraday bars for the last N daily bars (mock/demo only): a seeded random walk from each day's
 * open to its close, scaled to stay within the day's high/low. Bars in the future (relative to `now`) are dropped.
 */
export function synthIntraday(daily: Bar[], range: '1D' | '1W', rand: () => number, now = Date.now()): Bar[] {
  const { minutes, sessions } = intradaySpec(range);
  const perSession = (CLOSE_MIN - OPEN_MIN) / minutes;
  const days = daily.slice(-(sessions + 1));
  const out: Bar[] = [];
  for (const d of days) {
    const open0 = sessionOpenUtc(d.date.slice(0, 10));
    // random walk with a bridge so the last point lands on the close
    const steps: number[] = [0];
    for (let i = 1; i <= perSession; i++) steps.push(steps[i - 1] + (rand() - 0.5));
    const end = steps[perSession];
    const path = steps.map((s, i) => s - (end * i) / perSession);
    const amp = Math.max(...path.map(Math.abs)) || 1;
    const room = Math.max(d.high - Math.max(d.open, d.close), Math.min(d.open, d.close) - d.low, Math.abs(d.close - d.open) * 0.2, d.close * 0.002);
    const px = (i: number) => d.open + ((d.close - d.open) * i) / perSession + (path[i] / amp) * room * 0.9;
    for (let i = 0; i < perSession; i++) {
      const ts = open0 + i * minutes * 60_000;
      if (ts > now) break;
      const o = px(i);
      const c = px(i + 1);
      const wig = Math.abs(c - o) * 0.5 + d.close * 0.0005 * rand();
      const r2 = (v: number) => Math.round(v * 100) / 100;
      out.push({
        date: isoMinute(ts), open: r2(o), close: r2(c),
        high: r2(Math.max(o, c, Math.min(d.high, Math.max(o, c) + wig))), low: r2(Math.min(o, c, Math.max(d.low, Math.min(o, c) - wig))),
        volume: Math.round((d.volume / perSession) * (0.5 + rand())),
      });
    }
  }
  return lastSessions(out, sessions);
}

export const isDailyDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
