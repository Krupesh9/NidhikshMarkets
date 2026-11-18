import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/data', () => ({ getMarketData: () => ({}) }));
vi.mock('@/lib/news', () => ({ getHeadlines: async () => [] }));
vi.mock('@/lib/calendar', () => ({ getCalendarEvents: async () => ({ events: [] }) }));
import { seriesStats } from '../detail';

describe('seriesStats', () => {
  const pts = Array.from({ length: 400 }, (_, i) => ({ date: new Date(Date.UTC(2025, 9, 1) + i * 86_400_000).toISOString().slice(0, 10), value: 100 + i * 0.1 }));
  it('computes % changes, YTD and 52-week range', () => {
    const s = seriesStats(pts, 'pct', new Date('2026-11-04T00:00:00Z'));
    expect(s.last).toBeCloseTo(139.9);
    expect(s.chg1M!).toBeCloseTo(((139.9 - 136.9) / 136.9) * 100, 4);
    expect(s.high52).toBeCloseTo(139.9);
    expect(s.low52).toBeCloseTo(103.4, 1);
    expect(s.chgYTD).not.toBeNull();
  });
  it('reports basis points for yields', () => {
    const s = seriesStats([{ date: '2026-10-01', value: 4.0 }, { date: '2026-11-01', value: 4.25 }], 'bp');
    expect(s.chg1M).toBeCloseTo(25);
    expect(s.chg1Y).toBeNull();
  });
});
