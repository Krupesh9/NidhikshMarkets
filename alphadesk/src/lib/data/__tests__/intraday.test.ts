import { describe, expect, it } from 'vitest';
import { isRegularSession, lastSessions, nyParts, sessionOpenUtc, synthIntraday } from '../intraday';
import { isIntradayRange, type Bar } from '../types';
import { mockProvider, sliceRange } from '../mock';
import { snapshotToQuote } from '../alpaca';

const bar = (date: string, close = 100): Bar => ({ date, open: close, high: close + 1, low: close - 1, close, volume: 10 });

describe('intraday range handling', () => {
  it('classifies ranges', () => {
    expect(isIntradayRange('1D')).toBe(true);
    expect(isIntradayRange('1W')).toBe(true);
    expect(isIntradayRange('1M')).toBe(false);
  });

  it('finds the 09:30 ET open in both EDT and EST', () => {
    expect(new Date(sessionOpenUtc('2026-07-15')).toISOString()).toBe('2026-07-15T13:30:00.000Z');
    expect(new Date(sessionOpenUtc('2026-11-17')).toISOString()).toBe('2026-11-17T14:30:00.000Z');
    expect(nyParts('2026-11-17T14:35:00Z')).toEqual({ date: '2026-11-17', minutes: 9 * 60 + 35 });
  });

  it('keeps regular-session bars and the last N sessions only', () => {
    const bars = [
      bar('2026-11-13T14:30:00Z'), bar('2026-11-13T20:55:00Z'),
      bar('2026-11-16T09:00:00Z'), // pre-market
      bar('2026-11-16T14:30:00Z'), bar('2026-11-16T21:00:00Z'), // 16:00 ET = after close
      bar('2026-11-17T14:30:00Z'), bar('2026-11-17T15:00:00Z'),
    ];
    expect(isRegularSession('2026-11-16T09:00:00Z')).toBe(false);
    expect(lastSessions(bars, 1).map((b) => b.date)).toEqual(['2026-11-17T14:30:00Z', '2026-11-17T15:00:00Z']);
    expect(lastSessions(bars, 2).map((b) => b.date)).toEqual(['2026-11-16T14:30:00Z', '2026-11-17T14:30:00Z', '2026-11-17T15:00:00Z']);
  });

  it('synthesises a full 5-minute session inside the daily high/low with ISO timestamps', () => {
    let s = 1;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const daily: Bar[] = [{ date: '2026-11-16', open: 100, high: 104, low: 97, close: 102, volume: 7800 }, { date: '2026-11-17', open: 102, high: 106, low: 101, close: 105, volume: 7800 }];
    const d1 = synthIntraday(daily, '1D', rand, Date.parse('2026-11-18T00:00:00Z'));
    expect(d1).toHaveLength(78);
    expect(d1[0].date).toBe('2026-11-17T14:30:00Z');
    expect(d1.at(-1)!.date).toBe('2026-11-17T20:55:00Z');
    expect(d1.at(-1)!.close).toBeCloseTo(105, 1);
    for (const b of d1) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
    }
    const w = synthIntraday(daily, '1W', rand, Date.parse('2026-11-18T00:00:00Z'));
    expect(w).toHaveLength(26); // 2 sessions × 13 half-hours
    // in-progress session: nothing after "now"
    const partial = synthIntraday(daily, '1D', rand, Date.parse('2026-11-17T15:02:00Z'));
    expect(partial.map((b) => b.date)).toEqual(['2026-11-17T14:30:00Z', '2026-11-17T14:35:00Z', '2026-11-17T14:40:00Z', '2026-11-17T14:45:00Z', '2026-11-17T14:50:00Z', '2026-11-17T14:55:00Z', '2026-11-17T15:00:00Z']);
  });

  it('daily slicing returns [] for intraday ranges (Nidhiksh cache falls through)', () => {
    expect(sliceRange([bar('2026-11-17')], '1D')).toEqual([]);
    expect(sliceRange([bar('2026-11-17')], '1M')).toHaveLength(1);
  });

  it('mock provider serves labelled intraday bars with timestamps; daily stays YYYY-MM-DD', async () => {
    const r = await mockProvider.getHistory('NVDA', '1W');
    expect(r.meta.isMock).toBe(true);
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.data.every((b) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(b.date))).toBe(true);
    const daily = await mockProvider.getHistory('NVDA', '1Y');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(daily.data[0].date)).toBe(true);
  });

  it('maps an Alpaca snapshot: last trade vs previous daily close', () => {
    const q = snapshotToQuote('ZZZZ', {
      latestTrade: { p: 158.3, t: '2026-11-17T21:59:41Z' },
      dailyBar: { t: '2026-11-17T05:00:00Z', o: 156.92, h: 157.43, l: 150.34, c: 155.49, v: 17854499 },
      prevDailyBar: { t: '2026-11-16T05:00:00Z', o: 158.98, h: 162.5, l: 155.02, c: 156.145, v: 11877170 },
    })!;
    expect(q.price).toBe(158.3);
    expect(q.prevClose).toBe(156.145);
    expect(q.change).toBeCloseTo(2.155, 3);
    expect(q.changePct).toBeCloseTo(1.3801, 3);
    expect(q.volume).toBe(17854499);
    expect(q.ts).toBe('2026-11-17T21:59:41Z');
  });
});
