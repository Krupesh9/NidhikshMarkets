/**
 * Plan-aware redaction of share snapshots (pure; server + tests). A Free or signed-out viewer must not be able to
 * read premium content through a share link: AI notes/threads are withheld entirely, company snapshots lose
 * financial statements, consensus/analyst data and EV multiples. Applied on every read path (page, API, feed).
 */
import { hasFeature, type Feature } from '@/lib/plans';
import type { ShareItemType } from './snapshot';

export interface RedactedMarker { __locked?: Feature[] }

export function redactSnapshot(itemType: ShareItemType | string, snapshot: Record<string, unknown>, viewer: { plan: string } | null | undefined): Record<string, unknown> & RedactedMarker {
  const locked: Feature[] = [];
  if (itemType === 'note' || itemType === 'thread') {
    if (hasFeature(viewer, 'ai')) return snapshot;
    // Keep only non-AI metadata.
    return { capturedAt: snapshot.capturedAt, tickers: snapshot.tickers, title: snapshot.title, isMock: snapshot.isMock, messages: [], sources: [], question: '', answerMarkdown: '', __locked: ['ai'] };
  }
  if (itemType === 'company') {
    const out: Record<string, unknown> = { ...snapshot };
    if (!hasFeature(viewer, 'financials')) {
      out.financials = [];
      if (out.metrics && typeof out.metrics === 'object') {
        const m = { ...(out.metrics as Record<string, unknown>) };
        delete m['EV/EBITDA']; delete m.EV;
        out.metrics = m;
      }
      locked.push('financials');
    }
    if (!hasFeature(viewer, 'analystResearch')) { out.estimates = null; locked.push('analystResearch'); }
    if (locked.length) out.__locked = locked;
    return out;
  }
  return snapshot;
}
