/**
 * Tiny dependency-free RSS 2.0 / Atom parser (string scanning, no DOM).
 * Pure module: safe to import from tests and from server code. Never throws on malformed input;
 * items it cannot read (no title or link) are skipped.
 */

export interface RawFeedItem {
  title: string;
  link: string;
  /** ISO timestamp, or undefined when the item has no parseable date */
  publishedAt?: string;
  /** plain-text summary (tags stripped, entities decoded, truncated) */
  summary?: string;
  /** publisher named inside the item (Google News <source>, Nasdaq dc:creator, Investing.com <author>) */
  source?: string;
  /** tickers the feed itself attaches (nasdaq:tickers, Seeking Alpha symbol categories) */
  tickers?: string[];
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', pound: '£', euro: '€', yen: '¥', copy: '©', reg: '®', trade: '™',
};

/** Decode XML/HTML entities (named subset + numeric). Runs once; call twice for double-encoded HTML. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    const v = NAMED[e.toLowerCase()];
    return v ?? m;
  });
}

function unCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/** Strip HTML tags and collapse whitespace. Handles entity-encoded HTML (e.g. Benzinga, Google News). */
export function toPlainText(s: string): string {
  let t = unCdata(s);
  // Decode first so entity-escaped markup (&lt;p&gt;) becomes real tags we can strip.
  if (/&lt;|&#60;/i.test(t)) t = decodeEntities(t);
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  return t.replace(/\s+/g, ' ').trim();
}

export function truncate(s: string, max = 280): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–—-]+$/, '') + '…';
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Inner text of the first <tag ...>...</tag> (tag may contain a namespace prefix). */
function tagText(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${escapeRe(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(tag)}>`, 'i');
  const m = re.exec(block);
  return m ? unCdata(m[1]).trim() : undefined;
}

function allTagText(block: string, tag: string): { attrs: string; text: string }[] {
  const re = new RegExp(`<${escapeRe(tag)}(\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(tag)}>`, 'gi');
  const out: { attrs: string; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push({ attrs: m[1] ?? '', text: unCdata(m[2]).trim() });
  return out;
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${escapeRe(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? (m[2] ?? m[3]) : undefined;
}

/** Parse RSS/Atom date strings; returns ISO or undefined. Handles "YYYY-MM-DD HH:MM:SS" (assumed UTC). */
export function parseFeedDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  let v = s.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)) v = v.replace(' ', 'T') + 'Z';
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function atomLink(block: string): string | undefined {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const alt = links.find((a) => !/rel\s*=/.test(a) || /rel\s*=\s*["']alternate["']/i.test(a)) ?? links[0];
  return alt ? attr(alt, 'href') : undefined;
}

/** Parse an RSS 2.0 or Atom document into raw items. */
export function parseFeed(xml: string, opts: { summaryMax?: number } = {}): RawFeedItem[] {
  if (!xml || typeof xml !== 'string') return [];
  const max = opts.summaryMax ?? 280;
  const isAtom = !/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = isAtom ? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [] : xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  // Channel-level fallback date for items with none.
  const head = xml.slice(0, Math.max(0, xml.search(isAtom ? /<entry[\s>]/i : /<item[\s>]/i)));
  const channelDate = parseFeedDate(tagText(head, 'lastBuildDate') ?? tagText(head, 'pubDate') ?? tagText(head, 'updated'));

  const out: RawFeedItem[] = [];
  for (const b of blocks) {
    const titleRaw = tagText(b, 'title');
    const title = titleRaw ? toPlainText(titleRaw) : '';
    let link = isAtom ? atomLink(b) : tagText(b, 'link');
    if (!link && !isAtom) {
      const guid = allTagText(b, 'guid')[0];
      if (guid && /^https?:\/\//.test(guid.text) && !/isPermaLink\s*=\s*["']false/i.test(guid.attrs)) link = guid.text;
    }
    link = link ? decodeEntities(link.trim()) : undefined;
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;

    const dateRaw = isAtom
      ? tagText(b, 'published') ?? tagText(b, 'updated')
      : tagText(b, 'pubDate') ?? tagText(b, 'dc:date') ?? tagText(b, 'published') ?? tagText(b, 'updated');
    const publishedAt = parseFeedDate(dateRaw) ?? channelDate;

    const descRaw = isAtom ? tagText(b, 'summary') ?? tagText(b, 'content') : tagText(b, 'description') ?? tagText(b, 'content:encoded');
    const summaryText = descRaw ? toPlainText(descRaw) : '';
    const summary = summaryText ? truncate(summaryText, max) : undefined;

    const sourceRaw = tagText(b, 'source') ?? tagText(b, 'dc:creator') ?? tagText(b, 'author');
    const source = sourceRaw ? toPlainText(sourceRaw.replace(/<name>([\s\S]*?)<\/name>/i, '$1')) || undefined : undefined;

    const tickers = new Set<string>();
    const nt = tagText(b, 'nasdaq:tickers');
    if (nt) for (const t of nt.split(/[,\s]+/)) if (/^[A-Z][A-Z.]{0,5}$/.test(t)) tickers.add(t);
    for (const c of allTagText(b, 'category')) {
      const d = attr(c.attrs, 'domain');
      const m = d && /\/symbol\/([A-Z][A-Z.]{0,5})$/.exec(d);
      if (m) tickers.add(m[1]);
    }

    out.push({ title, link, publishedAt, summary, source, ...(tickers.size ? { tickers: [...tickers] } : {}) });
  }
  return out;
}
