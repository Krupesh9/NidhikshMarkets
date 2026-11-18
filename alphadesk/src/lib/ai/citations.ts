// Citation contract helpers. Pure + client-safe.
// The model cites claims with `[n]` (or `[n, m]`) markers; n maps to a Citation (SourceRef + n) registered
// when a tool returned that source. Markers that don't map to a registered source are stripped.
import type { SourceRef } from '@/lib/data/types';
import type { Citation } from './types';

export const CITE_RE = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\](?!\()/g;

export class CitationRegistry {
  private list: Citation[] = [];
  private byId = new Map<string, Citation>();

  constructor(initial: Citation[] = []) {
    for (const c of initial) {
      this.list.push(c);
      this.byId.set(c.id, c);
    }
  }

  /** Register a source; returns its citation number (deduped by id). */
  add(src: SourceRef): number {
    const existing = this.byId.get(src.id);
    if (existing) {
      // enrich missing fields
      if (!existing.excerpt && src.excerpt) existing.excerpt = src.excerpt;
      if (!existing.url && src.url) existing.url = src.url;
      if (!existing.locator && src.locator) existing.locator = src.locator;
      return existing.n;
    }
    const c: Citation = { ...src, n: this.list.length + 1 };
    this.list.push(c);
    this.byId.set(c.id, c);
    return c.n;
  }

  get(n: number): Citation | undefined {
    return this.list[n - 1];
  }
  numberOf(id: string): number | undefined {
    return this.byId.get(id)?.n;
  }
  get all(): Citation[] {
    return [...this.list];
  }
  get size(): number {
    return this.list.length;
  }
}

/** All citation numbers referenced in text, in order of first appearance (deduped). */
export function extractCitationNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    for (const p of m[1].split(/[,;]/)) {
      const n = Number(p.trim());
      if (Number.isFinite(n) && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

/** Drop markers (or numbers inside a marker) that don't map to a known citation. */
export function stripInvalidMarkers(text: string, valid: Set<number> | number[]): string {
  const ok = valid instanceof Set ? valid : new Set(valid);
  return text.replace(CITE_RE, (_m, inner: string) => {
    const keep = inner.split(/[,;]/).map((s) => Number(s.trim())).filter((n) => ok.has(n));
    return keep.length ? `[${keep.join(', ')}]` : '';
  });
}

export type CiteSegment = { type: 'text'; value: string } | { type: 'cite'; ns: number[]; raw: string; index: number };

/** Split a line of text into plain-text and citation segments (for rendering superscript chips). */
export function splitCitations(text: string): CiteSegment[] {
  const out: CiteSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ type: 'text', value: text.slice(last, i) });
    out.push({ type: 'cite', ns: m[1].split(/[,;]/).map((s) => Number(s.trim())), raw: m[0], index: i });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** The sentence around a character index (used to show what a citation supports). */
export function sentenceAround(text: string, index: number): string {
  // markers often follow the sentence's period ("… 6.4%. [1]") — that sentence is the one being cited
  const before = text.slice(0, index).replace(/(\s*\[\d[\d,;\s]*\])*[\s.]*$/, '');
  index = before.length;
  const startCandidates = [before.lastIndexOf('. '), before.lastIndexOf('\n'), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('|')];
  const start = Math.max(...startCandidates) + 1;
  const rest = text.slice(index);
  const ends = [rest.search(/\.\s|\n|\|/), rest.length].filter((x) => x >= 0);
  const end = index + Math.min(...ends);
  return text.slice(start, end).replace(CITE_RE, '').replace(/[*_`#>]/g, '').trim();
}

/** Pick a substring of the excerpt to highlight: the longest numeric/percent token from the citing sentence present in the excerpt. */
export function pickHighlight(sentence: string, excerpt?: string): string | undefined {
  if (!excerpt) return undefined;
  const tokens = sentence.match(/\$?-?\d[\d,.]*\s?(?:%|B|bn|M|x|bps)?/g) ?? [];
  const sorted = [...new Set(tokens.map((t) => t.trim()))].sort((a, b) => b.length - a.length);
  for (const t of sorted) {
    if (t.replace(/[^\d]/g, '').length < 2) continue;
    if (excerpt.includes(t)) return t;
    const bare = t.replace(/^\$/, '').replace(/\s?(%|B|bn|M|x|bps)$/, '');
    if (bare.length >= 2 && excerpt.includes(bare)) return bare;
  }
  // fall back to a fiscal year mention
  const fy = sentence.match(/FY\s?\d{4}|\b20\d{2}\b/);
  if (fy && excerpt.includes(fy[0])) return fy[0];
  return undefined;
}

/** Keep only citations referenced in text (ordered by n). */
export function referencedCitations(text: string, all: Citation[]): Citation[] {
  const used = new Set(extractCitationNumbers(text));
  return all.filter((c) => used.has(c.n));
}
