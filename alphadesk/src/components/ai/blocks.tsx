'use client';
import * as React from 'react';
import { Check, Copy, FileSpreadsheet, Terminal } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCell } from '@/lib/ai/format';
import type { BqlBlock, ChartBlock, StructuredBlock, TableBlock } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import { CiteChip } from './citation';

const SERIES_COLORS = ['rgb(var(--info))', 'rgb(var(--accent))', 'rgb(var(--up))', 'rgb(var(--warn))', '#a78bfa', 'rgb(var(--down))'];

function Frame({ title, icon, cites, children, actions }: { title?: string; icon?: React.ReactNode; cites?: number[]; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <figure className="my-3 overflow-hidden rounded-lg border border-border bg-panel-2/40">
      {(title || actions || cites?.length) && (
        <figcaption className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
          {icon}
          <span className="min-w-0 flex-1 truncate font-medium text-text">{title}</span>
          {cites?.length ? <span className="flex shrink-0 gap-0.5">{cites.slice(0, 6).map((n) => <CiteChip key={n} n={n} sentence={title ?? ''} />)}</span> : null}
          {actions}
        </figcaption>
      )}
      {children}
    </figure>
  );
}

export function TableBlockView({ block }: { block: TableBlock }) {
  return (
    <Frame title={block.title} cites={block.cites}>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted">
              {block.columns.map((c) => (
                <th key={c.key} scope="col" className={cn('whitespace-nowrap px-3 py-1.5 font-medium', c.numeric ? 'text-right' : 'text-left')}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-panel-2/60">
                {block.columns.map((c, j) => {
                  const v = r[c.key];
                  const neg = typeof v === 'number' && v < 0 && (c.format === 'pct' || c.format === 'num');
                  return (
                    <td key={c.key} className={cn('whitespace-nowrap px-3 py-1.5', c.numeric ? 'text-right font-mono tabular-nums' : 'text-left', j === 0 && 'font-medium', neg && 'text-down')}>
                      {formatCell(v, c.format)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.note && <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted">{block.note}</p>}
    </Frame>
  );
}

const fmtAxis = (format?: ChartBlock['format']) => (v: number) => (format === 'pct' ? `${v}%` : format === 'usdB' ? `$${v}B` : String(v));

export function ChartBlockView({ block }: { block: ChartBlock }) {
  const common = { data: block.data, margin: { top: 8, right: 12, bottom: 0, left: -12 } };
  const axis = { stroke: 'rgb(var(--muted))', fontSize: 11, tickLine: false };
  const tooltip = (
    <Tooltip
      contentStyle={{ background: 'rgb(var(--panel))', border: '1px solid rgb(var(--border))', borderRadius: 6, fontSize: 12 }}
      labelStyle={{ color: 'rgb(var(--text))' }}
      formatter={(v) => (typeof v === 'number' ? fmtAxis(block.format)(Math.round(v * 10) / 10) : String(v ?? '—'))}
    />
  );
  return (
    <Frame title={block.title} cites={block.cites}>
      <div className="h-48 w-full px-1 py-2" role="img" aria-label={`${block.chart} chart: ${block.title ?? ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          {block.chart === 'bar' ? (
            <BarChart {...common}>
              <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey={block.xKey} {...axis} />
              <YAxis {...axis} tickFormatter={fmtAxis(block.format)} width={48} />
              {tooltip}
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {block.series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[3, 3, 0, 0]} />)}
            </BarChart>
          ) : (
            <LineChart {...common}>
              <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey={block.xKey} {...axis} />
              <YAxis {...axis} tickFormatter={fmtAxis(block.format)} width={48} />
              {tooltip}
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {block.series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />)}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </Frame>
  );
}

function useCopy() {
  const [copied, setCopied] = React.useState<string | null>(null);
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  };
  return { copied, copy };
}

/** Derive an Excel BQL formula from a query when the block didn't carry one. */
export function bqlToExcel(query: string): string | undefined {
  const m = query.match(/get\((.+?)\)\s*for\(\[(.+?)\]\)(?:\s*with\((.+?)\))?/);
  if (!m) return undefined;
  const secs = m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).join(',');
  const params = m[3] ? ', ' + m[3].split(/,\s*(?![^()]*\))/).map((p) => `"${p.trim()}"`).join(', ') : '';
  return `=BQL("${secs}", "${m[1].replace(/\s+/g, '')}"${params})`;
}

export function BqlBlockView({ block }: { block: BqlBlock }) {
  const { copied, copy } = useCopy();
  const excel = block.excel ?? bqlToExcel(block.query);
  return (
    <Frame
      title={block.title ?? 'BQL'}
      icon={<Terminal className="h-3.5 w-3.5 text-info" aria-hidden />}
      actions={
        <button type="button" onClick={() => copy('q', block.query)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-panel-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info" aria-label="Copy BQL query">
          {copied === 'q' ? <Check className="h-3 w-3 text-up" /> : <Copy className="h-3 w-3" />} {copied === 'q' ? 'Copied' : 'Copy'}
        </button>
      }
    >
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[12px] leading-relaxed text-text scrollbar-thin">{block.query}</pre>
      {excel && (
        <div className="flex items-start gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted">
          <FileSpreadsheet className="mt-0.5 h-3.5 w-3.5 shrink-0 text-up" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-text">Excel:</span> paste into a cell with the BQL add-in — <code className="break-all font-mono text-text/90">{excel}</code>
          </span>
          <button type="button" onClick={() => copy('x', excel)} className="shrink-0 rounded px-1 text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info" aria-label="Copy Excel formula">
            {copied === 'x' ? <Check className="h-3 w-3 text-up" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      )}
      <p className="border-t border-border px-3 py-1 text-[10px] text-muted">BQL-style syntax for reproducing the data pull; field mnemonics may need adjusting to your terminal entitlements.</p>
    </Frame>
  );
}

export function BlockView({ block }: { block: StructuredBlock }) {
  if (block.type === 'table') return <TableBlockView block={block} />;
  if (block.type === 'chart') return <ChartBlockView block={block} />;
  if (block.type === 'bql') return <BqlBlockView block={block} />;
  return null;
}
