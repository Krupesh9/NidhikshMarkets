import { describe, expect, it } from 'vitest';
import { FOMC_MEETINGS, fomcEvents, minutesDate } from '../fomc';
import { addDays, agendaGroup, monthLabel, startOfWeek, todayET, weekday } from '../dates';
import { MACRO_RELEASES, macroEvent, parseFredReleaseDates, referencePeriod } from '../macro';
import { earningsEvent, parseEarningsCsv, splitCsvLine } from '../earnings-csv';
import { MARKET_HOLIDAYS } from '../holidays';

describe('FOMC schedule + minutes', () => {
  it('meetings are two-day, chronological, decision day mid-week', () => {
    for (let i = 0; i < FOMC_MEETINGS.length; i++) {
      const m = FOMC_MEETINGS[i];
      expect(addDays(m.start, 1)).toBe(m.end);
      expect(weekday(m.end)).toBe(3); // decisions land on Wednesdays
      if (i) expect(m.start > FOMC_MEETINGS[i - 1].end).toBe(true);
    }
    expect(FOMC_MEETINGS.filter((m) => m.start.startsWith('2026'))).toHaveLength(8);
    expect(FOMC_MEETINGS.filter((m) => m.start.startsWith('2027'))).toHaveLength(8);
    expect(FOMC_MEETINGS.filter((m) => m.sep).map((m) => m.end)).toEqual(['2026-03-18', '2026-06-17', '2026-09-16', '2026-12-09']);
  });
  it('minutes come exactly three weeks after the decision unless the published date is known', () => {
    const oct = FOMC_MEETINGS.find((m) => m.end === '2026-10-28')!;
    expect(minutesDate(oct)).toBe('2026-11-18');
    expect(minutesDate({ start: '2026-12-08', end: '2026-12-09', sep: true })).toBe('2026-12-30');
    // published dates match the 3-week rule for 2026
    for (const m of FOMC_MEETINGS.filter((x) => x.minutesReleased)) expect(m.minutesReleased).toBe(addDays(m.end, 21));
    expect(weekday(minutesDate(oct))).toBe(3);
  });
  it('emits decision + minutes events with SEP flag in title', () => {
    const ev = fomcEvents([{ start: '2026-12-08', end: '2026-12-09', sep: true }]);
    expect(ev.map((e) => [e.kind, e.date])).toEqual([['fomc', '2026-12-09'], ['minutes', '2026-12-30']]);
    expect(ev[0].title).toContain('SEP');
    expect(ev[0].detail).toContain('Dec 8–9');
    expect(ev[1].estimated).toBe(true);
  });
});

describe('dates', () => {
  it('week + agenda grouping', () => {
    expect(startOfWeek('2026-11-17')).toBe('2026-11-16');
    expect(startOfWeek('2026-11-22')).toBe('2026-11-16'); // Sunday
    expect(agendaGroup('2026-11-20', '2026-11-17').label).toBe('This week');
    expect(agendaGroup('2026-11-16', '2026-11-17').label).toBe('This week');
    expect(agendaGroup('2026-11-23', '2026-11-17').label).toBe('Next week');
    expect(agendaGroup('2026-12-04', '2026-11-17').label).toBe('December 2026');
    expect(agendaGroup('2026-11-30', '2026-11-17').label).toBe('November 2026');
    expect(agendaGroup('2026-11-10', '2026-11-17').label).toBe('Earlier');
    expect(monthLabel('2026-01-15', 1)).toBe('December 2025');
    expect(todayET(new Date('2026-11-18T04:00:00Z'))).toBe('2026-11-17');
  });
  it('holidays never fall on weekends', () => {
    for (const h of MARKET_HOLIDAYS) expect([0, 6]).not.toContain(weekday(h.date));
  });
});

describe('macro releases', () => {
  const r = (kind: string) => MACRO_RELEASES.find((x) => x.kind === kind)!;
  it('labels reference periods', () => {
    expect(referencePeriod(r('cpi'), '2026-12-10')).toBe('November 2026');
    expect(referencePeriod(r('cpi'), '2027-01-13')).toBe('December 2026');
    expect(referencePeriod(r('jolts'), '2026-12-01')).toBe('October 2026');
    expect(referencePeriod(r('gdp'), '2026-10-29')).toBe('Q3 2026');
    expect(referencePeriod(r('gdp'), '2026-12-23')).toBe('Q3 2026');
    expect(referencePeriod(r('gdp'), '2027-01-28')).toBe('Q4 2026');
    expect(referencePeriod(r('claims'), '2026-11-19')).toBeUndefined();
  });
  it('builds events and parses FRED payloads', () => {
    const e = macroEvent(r('jobs'), '2026-12-04');
    expect(e).toMatchObject({ title: 'Jobs report (Employment Situation) — November 2026', category: 'jobs', importance: 'high', time: '8:30 AM ET' });
    expect(macroEvent(r('claims'), '2026-11-19').recurring).toBe(true);
    expect(parseFredReleaseDates({ release_dates: [{ release_id: 10, date: '2026-12-10' }, { date: '2026-11-10' }, { date: 'x' }, { date: '2026-12-10' }] })).toEqual(['2026-11-10', '2026-12-10']);
    expect(parseFredReleaseDates({ error_message: 'bad key' })).toEqual([]);
    expect(parseFredReleaseDates(null)).toEqual([]);
  });
  it('uses verified FRED release ids', () => {
    expect(Object.fromEntries(MACRO_RELEASES.map((x) => [x.kind, x.releaseId]))).toMatchObject({ cpi: 10, ppi: 46, jobs: 50, gdp: 53, pce: 54, jolts: 192, retail: 9, claims: 180, sentiment: 91 });
  });
});

describe('Alpha Vantage earnings CSV', () => {
  const CSV = 'symbol,name,reportDate,fiscalDateEnding,estimate,currency,timeOfTheDay\r\n'
    + 'NVDA,NVIDIA CORPORATION,2026-11-17,2026-10-31,2.49,USD,post-market\r\n'
    + 'BRK.B,"BERKSHIRE HATHAWAY, INC.",2027-02-20,2026-12-31,,USD,\r\n'
    + 'SHOP,SHOPIFY INC,2026-12-01,2026-09-30,0.5,CAD,pre-market\r\n'
    + 'BAD,ROW,not-a-date,,,,\r\n';
  it('parses rows incl. quoted names and empty estimates', () => {
    const rows = parseEarningsCsv(CSV);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ symbol: 'NVDA', name: 'NVIDIA CORPORATION', reportDate: '2026-11-17', fiscalDateEnding: '2026-10-31', estimate: 2.49, currency: 'USD', timeOfTheDay: 'post-market' });
    expect(rows[1].name).toBe('BERKSHIRE HATHAWAY, INC.');
    expect(rows[1].estimate).toBeUndefined();
  });
  it('returns [] for rate-limit JSON / empty bodies', () => {
    expect(parseEarningsCsv('{\n "Information": "rate limit"\n}')).toEqual([]);
    expect(parseEarningsCsv('')).toEqual([]);
  });
  it('splits quoted CSV fields', () => {
    expect(splitCsvLine('a,"b, c","d ""q"""')).toEqual(['a', 'b, c', 'd "q"']);
  });
  it('formats earnings events', () => {
    const [nvda, , shop] = parseEarningsCsv(CSV);
    const e = earningsEvent(nvda, true);
    expect(e.title).toBe('NVDA earnings · After close · EPS est 2.49');
    expect(e).toMatchObject({ date: '2026-11-17', ticker: 'NVDA', inWatchlist: true, importance: 'high', time: 'After close', category: 'earnings' });
    expect(earningsEvent(shop, false).title).toBe('SHOP earnings · Before open · EPS est CAD 0.50');
    expect(earningsEvent(shop, false).importance).toBe('medium');
  });
});
