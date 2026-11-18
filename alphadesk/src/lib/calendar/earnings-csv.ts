/** Alpha Vantage EARNINGS_CALENDAR CSV parsing (pure). */
import type { CalendarEvent } from './types';

export interface EarningsRow {
  symbol: string;
  name: string;
  reportDate: string;
  fiscalDateEnding?: string;
  estimate?: number;
  currency?: string;
  timeOfTheDay?: 'pre-market' | 'post-market' | string;
}

/** Split one CSV line honouring double-quoted fields ("A, Inc."). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Parse the CSV body. Returns [] when the body is not the expected CSV (Alpha Vantage answers rate-limit / bad-key
 * conditions with a JSON "Note"/"Information" message and HTTP 200).
 */
export function parseEarningsCsv(csv: string): EarningsRow[] {
  if (!csv || typeof csv !== 'string') return [];
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 1) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const ix = (k: string) => header.indexOf(k);
  const iSym = ix('symbol'), iName = ix('name'), iDate = ix('reportDate');
  if (iSym < 0 || iDate < 0) return [];
  const iFis = ix('fiscalDateEnding'), iEst = ix('estimate'), iCur = ix('currency'), iTime = ix('timeOfTheDay');
  const rows: EarningsRow[] = [];
  for (const l of lines.slice(1)) {
    const f = splitCsvLine(l);
    const symbol = f[iSym]?.trim().toUpperCase();
    const reportDate = f[iDate]?.trim();
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate ?? '')) continue;
    const est = iEst >= 0 && f[iEst]?.trim() ? Number(f[iEst]) : undefined;
    rows.push({
      symbol,
      name: iName >= 0 ? f[iName]?.trim() ?? symbol : symbol,
      reportDate,
      ...(iFis >= 0 && f[iFis]?.trim() ? { fiscalDateEnding: f[iFis].trim() } : {}),
      ...(est !== undefined && Number.isFinite(est) ? { estimate: est } : {}),
      ...(iCur >= 0 && f[iCur]?.trim() ? { currency: f[iCur].trim() } : {}),
      ...(iTime >= 0 && f[iTime]?.trim() ? { timeOfTheDay: f[iTime].trim() } : {}),
    });
  }
  return rows;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bIncorporated\b/, 'Inc.').replace(/\bCorporation\b/, 'Corp.');
}

export function timingLabel(t?: string): string | undefined {
  if (t === 'pre-market') return 'Before open';
  if (t === 'post-market') return 'After close';
  return undefined;
}

export function earningsEvent(r: EarningsRow, inWatchlist: boolean): CalendarEvent {
  const timing = timingLabel(r.timeOfTheDay);
  const parts = [timing, r.estimate !== undefined ? `EPS est ${r.currency && r.currency !== 'USD' ? r.currency + ' ' : ''}${r.estimate.toFixed(2)}` : undefined].filter(Boolean);
  return {
    id: `earn:${r.symbol}:${r.reportDate}`,
    date: r.reportDate,
    ...(timing ? { time: timing } : {}),
    category: 'earnings',
    kind: 'earnings',
    title: `${r.symbol} earnings${parts.length ? ' · ' + parts.join(' · ') : ''}`,
    detail: `${titleCase(r.name)}${r.fiscalDateEnding ? ` · quarter ending ${r.fiscalDateEnding}` : ''}`,
    importance: inWatchlist ? 'high' : 'medium',
    ticker: r.symbol,
    inWatchlist,
    source: { name: 'Alpha Vantage', url: `https://www.alphavantage.co/documentation/#earnings-calendar` },
  };
}
