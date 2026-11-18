'use client';
import * as React from 'react';
import type { SourceRef } from '@/lib/data/types';
import { SourceChip } from '@/components/ui/source-chip';

/**
 * Small, safe markdown renderer (no HTML injection — builds React nodes only).
 * Supports headings, paragraphs, bullet/numbered lists, blockquotes, **bold**, _italic_/*italic*, `code`,
 * http(s) links, simple pipe tables, and citation markers [1] → clickable <SourceChip> (opens right rail).
 */
export function Markdown({ text, sources = [], className }: { text: string; sources?: SourceRef[]; className?: string }) {
  const blocks = React.useMemo(() => parseBlocks(text ?? ''), [text]);
  return (
    <div className={className ?? 'space-y-3 text-sm leading-relaxed'}>
      {blocks.map((b, i) => <Block key={i} b={b} sources={sources} />)}
    </div>
  );
}

type B =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'quote'; text: string }
  | { t: 'code'; text: string }
  | { t: 'table'; head: string[]; rows: string[][] };

function parseBlocks(src: string): B[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: B[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.trim().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push({ t: 'code', text: buf.join('\n') });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { out.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (s: string) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(l);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push({ t: 'table', head, rows });
      continue;
    }
    if (/^\s*[-*•]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ''));
      out.push({ t: 'ul', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      out.push({ t: 'ol', items });
      continue;
    }
    if (/^\s*>/.test(l)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', text: buf.join(' ') });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*•]\s+|\s*\d+[.)]\s+|\s*>|```)/.test(lines[i])) buf.push(lines[i++]);
    out.push({ t: 'p', text: buf.join(' ') });
  }
  return out;
}

function Block({ b, sources }: { b: B; sources: SourceRef[] }) {
  const I = (s: string) => <Inline text={s} sources={sources} />;
  switch (b.t) {
    case 'h': {
      const cls = b.level <= 2 ? 'text-base font-semibold' : 'text-sm font-semibold';
      return b.level <= 2 ? <h3 className={cls}>{I(b.text)}</h3> : <h4 className={cls}>{I(b.text)}</h4>;
    }
    case 'p': return <p>{I(b.text)}</p>;
    case 'ul': return <ul className="list-disc space-y-1 pl-5">{b.items.map((x, i) => <li key={i}>{I(x)}</li>)}</ul>;
    case 'ol': return <ol className="list-decimal space-y-1 pl-5">{b.items.map((x, i) => <li key={i}>{I(x)}</li>)}</ol>;
    case 'quote': return <blockquote className="border-l-2 border-border pl-3 text-muted">{I(b.text)}</blockquote>;
    case 'code': return <pre className="overflow-x-auto rounded-md border border-border bg-panel-2 p-3 font-mono text-xs">{b.text}</pre>;
    case 'table':
      return (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-panel-2 text-muted"><tr>{b.head.map((h, i) => <th key={i} className="px-2 py-1.5 text-left font-medium">{I(h)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className="px-2 py-1.5 font-mono tabular-nums">{I(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
  }
}

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\)|\[\d+(?:\s*,\s*\d+)*\]|(?<![\w*])\*[^*\n]+\*(?!\w)|(?<![\w])_[^_\n]+_(?!\w))/g;

export function Inline({ text, sources = [] }: { text: string; sources?: SourceRef[] }) {
  const parts = text.split(TOKEN).filter((p) => p !== '');
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={i} className="font-semibold text-text">{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="rounded bg-panel-2 px-1 font-mono text-[12px]">{p.slice(1, -1)}</code>;
        const link = /^\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)$/.exec(p);
        if (link) {
          const external = link[2].startsWith('http');
          return <a key={i} href={link[2]} className="text-info hover:underline" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{link[1]}</a>;
        }
        const cite = /^\[(\d+(?:\s*,\s*\d+)*)\]$/.exec(p);
        if (cite) {
          const nums = cite[1].split(',').map((n) => Number(n.trim()));
          const known = nums.filter((n) => sources[n - 1]);
          if (!known.length) return <span key={i}>{p}</span>;
          return <span key={i} className="mx-0.5 inline-flex gap-0.5">{known.map((n) => <SourceChip key={n} source={sources[n - 1]} index={n} label={shortName(sources[n - 1].name)} />)}</span>;
        }
        if ((p.startsWith('*') && p.endsWith('*')) || (p.startsWith('_') && p.endsWith('_'))) return <em key={i}>{p.slice(1, -1)}</em>;
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

const shortName = (n: string) => (n.length > 18 ? n.slice(0, 17) + '…' : n);
