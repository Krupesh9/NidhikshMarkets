/**
 * FOMC schedule, transcribed from https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 * (page "Last Update: November 12, 2026", fetched 2026-11-17). `sep` = meeting with a Summary of Economic Projections
 * (asterisked on the Fed page; the Fed has not yet marked 2027 SEP meetings). Each meeting is tentative until
 * confirmed at the preceding meeting. Minutes are released three weeks after the policy decision (2:00 PM ET).
 */
import type { CalendarEvent } from './types';
import { addDays } from './dates';

export interface FomcMeeting { start: string; end: string; sep: boolean; note?: string; minutesReleased?: string }

export const FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';

export const FOMC_MEETINGS: FomcMeeting[] = [
  // 2026
  { start: '2026-01-27', end: '2026-01-28', sep: false, minutesReleased: '2026-02-18' },
  { start: '2026-03-17', end: '2026-03-18', sep: true, minutesReleased: '2026-04-08' },
  { start: '2026-04-28', end: '2026-04-29', sep: false, minutesReleased: '2026-05-20' },
  { start: '2026-06-16', end: '2026-06-17', sep: true, minutesReleased: '2026-07-08' },
  { start: '2026-07-28', end: '2026-07-29', sep: false, minutesReleased: '2026-08-19' },
  { start: '2026-09-15', end: '2026-09-16', sep: true, minutesReleased: '2026-10-07' },
  { start: '2026-10-27', end: '2026-10-28', sep: false },
  { start: '2026-12-08', end: '2026-12-09', sep: true },
  // 2027 (SEP meetings not yet designated on the Fed page)
  { start: '2027-01-26', end: '2027-01-27', sep: false },
  { start: '2027-03-16', end: '2027-03-17', sep: false },
  { start: '2027-04-27', end: '2027-04-28', sep: false },
  { start: '2027-06-08', end: '2027-06-09', sep: false },
  { start: '2027-07-27', end: '2027-07-28', sep: false },
  { start: '2027-09-14', end: '2027-09-15', sep: false },
  { start: '2027-10-26', end: '2027-10-27', sep: false, note: 'Monetary Policy Strategy Meeting' },
  { start: '2027-11-16', end: '2027-11-17', sep: false },
];

/** Minutes release date: the published date when known, else three weeks after the decision day. */
export function minutesDate(m: FomcMeeting): string {
  return m.minutesReleased ?? addDays(m.end, 21);
}

function fmtRange(m: FomcMeeting): string {
  const s = new Date(m.start + 'T00:00:00Z');
  const e = new Date(m.end + 'T00:00:00Z');
  const mo = (d: Date) => d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return s.getUTCMonth() === e.getUTCMonth() ? `${mo(s)} ${s.getUTCDate()}–${e.getUTCDate()}` : `${mo(s)} ${s.getUTCDate()} – ${mo(e)} ${e.getUTCDate()}`;
}

/** Decision-day and minutes events for every meeting (filter by date range afterwards). */
export function fomcEvents(meetings: FomcMeeting[] = FOMC_MEETINGS): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const m of meetings) {
    const range = fmtRange(m);
    out.push({
      id: `fomc:${m.end}`,
      date: m.end,
      time: '2:00 PM ET',
      category: 'fed',
      kind: 'fomc',
      title: `FOMC rate decision${m.sep ? ' + projections (SEP)' : ''}`,
      detail: `Meeting ${range}${m.note ? ` · ${m.note}` : ''} · statement 2:00 PM, press conference 2:30 PM`,
      importance: 'high',
      source: { name: 'Federal Reserve', url: FOMC_URL },
    });
    out.push({
      id: `fomc-minutes:${m.end}`,
      date: minutesDate(m),
      time: '2:00 PM ET',
      category: 'fed',
      kind: 'minutes',
      title: `FOMC minutes — ${range} meeting`,
      importance: 'medium',
      estimated: !m.minutesReleased,
      source: { name: 'Federal Reserve', url: FOMC_URL },
    });
  }
  return out;
}
