'use client';
import * as React from 'react';
import { sentenceAround, splitCitations } from '@/lib/ai/citations';
import type { BqlBlock, ChartBlock, TableBlock } from '@/lib/ai/types';
import { BlockView } from './blocks';
import { CiteChip } from './citation';

/**
 * Minimal, safe markdown renderer for assistant answers (no HTML passthrough):
 * headings, paragraphs, bullet/numbered lists, GFM tables, fenced code, **bold**, *em*, `code`, links,
 * `[n]` citation chips, and fenced `bql` / `chart` / `table` blocks rendered as structured views.
 */

type Node =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'code'; lang: string; body: string; closed: boolean }
  | { t: 'hr' };

export function parseMarkdown(src: string): Node[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: Node[] = [];
  let i = 0;
  const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (/^\s*```\s*$/.test(lines[i])) { closed = true; i++; break; }
        body.push(lines[i]);
        i++;
      }
      out.push({ t: 'code', lang: fence[1].toLowerCase(), body: body.join('\n'), closed });
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push({ t: 'hr' }); i++; continue; }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
      out.push({ t: 'table', head, rows });
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*[-*•]\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*•]\s+/.test(lines[i])) { item += ' ' + lines[i].trim(); i++; }
        items.push(item);
      }
      out.push({ t: 'ul', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
      out.push({ t: 'ol', items });
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*```|\s*[-*•]\s+|\s*\d+[.)]\s+)/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      para.push(lines[i]);
      i++;
    }
    out.push({ t: 'p', text: para.join(' ') });
  }
  return out;
}

// Inline formatting: bold, emphasis, inline code, links and [n] citations.
function Inline({ text }: { text: string }) {
  const segs = splitCitations(text);
  return (
    <>
      {segs.map((s, k) =>
        s.type === 'cite' ? (
          <React.Fragment key={k}>{s.ns.map((n) => <CiteChip key={n} n={n} sentence={sentenceAround(text, s.index)} />)}</React.Fragment>
        ) : (
          <InlineText key={k} text={s.value} />
        ),
      )}
    </>
  );
}

function InlineText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)|(?<![\w*])\*[^*\s][^*]*\*(?!\w)|(?<![\w_])_[^_\s][^_]*_(?!\w))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(<strong key={k++} className="font-semibold text-text">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) parts.push(<code key={k++} className="rounded bg-panel-2 px-1 py-px font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      const external = lm[2].startsWith('http');
      parts.push(<a key={k++} href={lm[2]} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="text-info hover:underline">{lm[1]}</a>);
    } else parts.push(<em key={k++} className="text-text/80">{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function CodeNode({ node, streaming }: { node: Extract<Node, { t: 'code' }>; streaming?: boolean }) {
  if (node.lang === 'bql' && (node.closed || !streaming)) {
    const block: BqlBlock = { type: 'bql', query: node.body.trim() };
    return <BlockView block={block} />;
  }
  if ((node.lang === 'chart' || node.lang === 'table' || node.lang === 'json') && node.closed) {
    try {
      const j = JSON.parse(node.body) as ChartBlock | TableBlock;
      if (j && (j.type === 'chart' || j.type === 'table')) return <BlockView block={j} />;
    } catch { /* fall through to raw */ }
  }
  return (
    <pre className="my-2 overflow-x-auto rounded-md border border-border bg-panel-2/60 p-2.5 font-mono text-[12px] leading-relaxed scrollbar-thin">
      <code>{node.body}</code>
    </pre>
  );
}

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const nodes = React.useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-text/90">
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'h': {
            const cls = n.level <= 2 ? 'text-[15px] font-semibold text-text' : n.level === 3 ? 'text-sm font-semibold text-text' : 'text-[13px] font-semibold text-text';
            return <p key={i} role="heading" aria-level={Math.min(6, n.level + 1)} className={cls}><Inline text={n.text} /></p>;
          }
          case 'p': return <p key={i}><Inline text={n.text} /></p>;
          case 'ul': return <ul key={i} className="ml-4 list-disc space-y-1 marker:text-muted">{n.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>;
          case 'ol': return <ol key={i} className="ml-4 list-decimal space-y-1 marker:text-muted">{n.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ol>;
          case 'hr': return <hr key={i} className="border-border" />;
          case 'code': return <CodeNode key={i} node={n} streaming={streaming} />;
          case 'table':
            return (
              <div key={i} className="overflow-x-auto rounded-md border border-border scrollbar-thin">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border text-muted">{n.head.map((h, j) => <th key={j} className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium"><Inline text={h} /></th>)}</tr></thead>
                  <tbody>{n.rows.map((r, j) => <tr key={j} className="border-b border-border/60 last:border-0">{r.map((c, k) => <td key={k} className={/^[-+$]?\d/.test(c) ? 'whitespace-nowrap px-2.5 py-1.5 text-right font-mono tabular-nums' : 'px-2.5 py-1.5'}><Inline text={c} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            );
        }
      })}
      {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-info/70 align-middle" aria-hidden />}
    </div>
  );
}
