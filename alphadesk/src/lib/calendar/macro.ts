/**
 * Macro release registry (FRED release ids verified via /fred/release?release_id=… on 2026-11-17) and pure helpers
 * that turn FRED release dates into calendar events.
 */
import type { CalendarCategory, CalendarEvent, Importance } from './types';
import { monthLabel, parseYmd } from './dates';

export interface MacroRelease {
  releaseId: number;
  kind: string;
  name: string;
  category: CalendarCategory;
  importance: Importance;
  time: string;
  agency: string;
  url: string;
  /** reference period shown in the title */
  period: 'prev-month' | 'two-months-prior' | 'quarter' | 'current-month-survey' | 'week' | 'none';
  recurring?: boolean;
}

export const MACRO_RELEASES: MacroRelease[] = [
  { releaseId: 10, kind: 'cpi', name: 'CPI', category: 'inflation', importance: 'high', time: '8:30 AM ET', agency: 'BLS', url: 'https://www.bls.gov/cpi/', period: 'prev-month' },
  { releaseId: 46, kind: 'ppi', name: 'PPI', category: 'inflation', importance: 'medium', time: '8:30 AM ET', agency: 'BLS', url: 'https://www.bls.gov/ppi/', period: 'prev-month' },
  { releaseId: 54, kind: 'pce', name: 'PCE & personal income', category: 'inflation', importance: 'high', time: '8:30 AM ET', agency: 'BEA', url: 'https://www.bea.gov/data/income-saving/personal-income', period: 'prev-month' },
  { releaseId: 50, kind: 'jobs', name: 'Jobs report (Employment Situation)', category: 'jobs', importance: 'high', time: '8:30 AM ET', agency: 'BLS', url: 'https://www.bls.gov/ces/', period: 'prev-month' },
  { releaseId: 192, kind: 'jolts', name: 'JOLTS job openings', category: 'jobs', importance: 'medium', time: '10:00 AM ET', agency: 'BLS', url: 'https://www.bls.gov/jlt/', period: 'two-months-prior' },
  { releaseId: 180, kind: 'claims', name: 'Initial jobless claims', category: 'jobs', importance: 'low', time: '8:30 AM ET', agency: 'DOL', url: 'https://www.dol.gov/ui/data.pdf', period: 'none', recurring: true },
  { releaseId: 53, kind: 'gdp', name: 'GDP', category: 'growth', importance: 'high', time: '8:30 AM ET', agency: 'BEA', url: 'https://www.bea.gov/data/gdp/gross-domestic-product', period: 'quarter' },
  { releaseId: 9, kind: 'retail', name: 'Retail sales', category: 'growth', importance: 'medium', time: '8:30 AM ET', agency: 'Census', url: 'https://www.census.gov/retail/', period: 'prev-month' },
  { releaseId: 13, kind: 'ip', name: 'Industrial production', category: 'growth', importance: 'low', time: '9:15 AM ET', agency: 'Federal Reserve', url: 'https://www.federalreserve.gov/releases/g17/', period: 'prev-month' },
  { releaseId: 91, kind: 'sentiment', name: 'Consumer sentiment (UMich)', category: 'growth', importance: 'medium', time: '10:00 AM ET', agency: 'University of Michigan', url: 'http://www.sca.isr.umich.edu/', period: 'current-month-survey' },
];

/** Reference period label for a release published on `date`. */
export function referencePeriod(r: MacroRelease, date: string): string | undefined {
  switch (r.period) {
    case 'prev-month': return monthLabel(date, 1);
    case 'two-months-prior': return monthLabel(date, 2);
    case 'quarter': {
      // Advance (month 1), second (month 2) and third (month 3) estimates all describe the quarter ending ~3 months earlier.
      const d = parseYmd(date);
      const idx = d.getUTCFullYear() * 12 + d.getUTCMonth() - 3;
      const y = Math.floor(idx / 12);
      const q = Math.floor((idx % 12) / 3) + 1;
      return `Q${q} ${y}`;
    }
    case 'current-month-survey': return monthLabel(date);
    default: return undefined;
  }
}

export function macroEvent(r: MacroRelease, date: string): CalendarEvent {
  const period = referencePeriod(r, date);
  return {
    id: `macro:${r.kind}:${date}`,
    date,
    time: r.time,
    category: r.category,
    kind: r.kind,
    title: period ? `${r.name} — ${period}` : r.name,
    importance: r.importance,
    ...(r.recurring ? { recurring: true } : {}),
    source: { name: `${r.agency} via FRED`, url: r.url },
  };
}

/** Parse a FRED /release/dates JSON body into YYYY-MM-DD strings (empty on error). */
export function parseFredReleaseDates(json: unknown): string[] {
  const rows = (json as { release_dates?: { date?: unknown }[] } | null)?.release_dates;
  if (!Array.isArray(rows)) return [];
  return [...new Set(rows.map((r) => r?.date).filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
}
