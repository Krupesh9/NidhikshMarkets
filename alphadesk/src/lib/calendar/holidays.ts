/** NYSE/Nasdaq full holidays and 1:00 PM ET early closes, 2026–2027 (observed dates). Source: nyse.com/markets/hours-calendars. */
import type { CalendarEvent } from './types';

const URL = 'https://www.nyse.com/markets/hours-calendars';

export const MARKET_HOLIDAYS: { date: string; name: string }[] = [
  { date: '2026-01-01', name: 'New Year’s Day' },
  { date: '2026-01-19', name: 'Martin Luther King Jr. Day' },
  { date: '2026-02-16', name: 'Washington’s Birthday' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-05-25', name: 'Memorial Day' },
  { date: '2026-06-19', name: 'Juneteenth' },
  { date: '2026-07-03', name: 'Independence Day (observed)' },
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-11-26', name: 'Thanksgiving Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2027-01-01', name: 'New Year’s Day' },
  { date: '2027-01-18', name: 'Martin Luther King Jr. Day' },
  { date: '2027-02-15', name: 'Washington’s Birthday' },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-05-31', name: 'Memorial Day' },
  { date: '2027-06-18', name: 'Juneteenth (observed)' },
  { date: '2027-07-05', name: 'Independence Day (observed)' },
  { date: '2027-09-06', name: 'Labor Day' },
  { date: '2027-11-25', name: 'Thanksgiving Day' },
  { date: '2027-12-24', name: 'Christmas Day (observed)' },
];

export const EARLY_CLOSES: { date: string; name: string }[] = [
  { date: '2026-11-27', name: 'Day after Thanksgiving' },
  { date: '2026-12-24', name: 'Christmas Eve' },
  { date: '2027-11-26', name: 'Day after Thanksgiving' },
];

export function marketEvents(): CalendarEvent[] {
  return [
    ...MARKET_HOLIDAYS.map((h): CalendarEvent => ({
      id: `holiday:${h.date}`, date: h.date, category: 'market', kind: 'holiday', title: `US markets closed — ${h.name}`,
      importance: 'medium', source: { name: 'NYSE', url: URL },
    })),
    ...EARLY_CLOSES.map((h): CalendarEvent => ({
      id: `early:${h.date}`, date: h.date, time: '1:00 PM ET', category: 'market', kind: 'early-close', title: `Early close (1:00 PM ET) — ${h.name}`,
      importance: 'low', source: { name: 'NYSE', url: URL },
    })),
  ];
}
