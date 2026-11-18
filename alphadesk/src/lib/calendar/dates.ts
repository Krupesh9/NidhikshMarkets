/** Pure date helpers on YYYY-MM-DD strings (calendar dates, no time zone drift). */

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
/** 0 = Sunday … 6 = Saturday */
export function weekday(s: string): number {
  return parseYmd(s).getUTCDay();
}
/** Monday of the ISO week containing `s`. */
export function startOfWeek(s: string): string {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}
export function diffDays(a: string, b: string): number {
  return Math.round((parseYmd(a).getTime() - parseYmd(b).getTime()) / 86_400_000);
}
/** Today's date in America/New_York (market calendar). */
export function todayET(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthName(m: number): string { return MONTHS[((m % 12) + 12) % 12]; }

/** "January 2026" for the month `offset` months before the month of `s`. */
export function monthLabel(s: string, offset = 0): string {
  const d = parseYmd(s);
  const idx = d.getUTCFullYear() * 12 + d.getUTCMonth() - offset;
  return `${monthName(idx % 12)} ${Math.floor(idx / 12)}`;
}

/** Agenda group for an event date relative to today: "This week", "Next week", or "December 2026". Past weeks → "Earlier". */
export function agendaGroup(date: string, today: string): { key: string; label: string } {
  const w0 = startOfWeek(today);
  const w = startOfWeek(date);
  const dw = diffDays(w, w0) / 7;
  if (dw < 0) return { key: 'earlier', label: 'Earlier' };
  if (dw === 0) return { key: 'w0', label: 'This week' };
  if (dw === 1) return { key: 'w1', label: 'Next week' };
  return { key: date.slice(0, 7), label: monthLabel(date) };
}
