'use client';
import * as React from 'react';
import { FileSpreadsheet } from 'lucide-react';
import type { FinancialPeriod, Financials, FinancialStatementRow, SourceRef } from '@/lib/data/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Sparkline } from '@/components/ui/sparkline';
import { SourceChip } from '@/components/ui/source-chip';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { periodLabel, ppChange, yoyGrowth, yoyLag, compactUsd } from './lib/helpers';
import { useOpenSource } from './MetricButton';

type Statement = 'income' | 'balance' | 'cashflow';
type Unit = 'usd' | 'eps' | 'pct' | 'shares';
interface LineDef { key: string; label: string; unit: Unit; get: (r: FinancialStatementRow) => number | null; bold?: boolean; indent?: boolean }

const nz = (v: number) => (v === 0 || !isFinite(v) ? null : v);

const LINES: Record<Statement, LineDef[]> = {
  income: [
    { key: 'revenue', label: 'Revenue', unit: 'usd', get: (r) => nz(r.revenue), bold: true },
    { key: 'grossProfit', label: 'Gross profit', unit: 'usd', get: (r) => nz(r.grossProfit) },
    { key: 'grossMargin', label: 'Gross margin', unit: 'pct', get: (r) => (r.grossProfit ? r.grossMargin : null), indent: true },
    { key: 'operatingIncome', label: 'Operating income', unit: 'usd', get: (r) => nz(r.operatingIncome) },
    { key: 'operatingMargin', label: 'Operating margin', unit: 'pct', get: (r) => (r.operatingIncome ? r.operatingMargin : null), indent: true },
    { key: 'ebitda', label: 'EBITDA', unit: 'usd', get: (r) => nz(r.ebitda) },
    { key: 'netIncome', label: 'Net income', unit: 'usd', get: (r) => nz(r.netIncome), bold: true },
    { key: 'netMargin', label: 'Net margin', unit: 'pct', get: (r) => (r.netIncome ? r.netMargin : null), indent: true },
    { key: 'eps', label: 'Diluted EPS', unit: 'eps', get: (r) => nz(r.eps), bold: true },
    { key: 'shares', label: 'Diluted shares', unit: 'shares', get: (r) => nz(r.sharesOutstanding) },
  ],
  balance: [
    { key: 'totalAssets', label: 'Total assets', unit: 'usd', get: (r) => nz(r.totalAssets), bold: true },
    { key: 'cash', label: 'Cash & equivalents', unit: 'usd', get: (r) => nz(r.cash), indent: true },
    { key: 'totalLiabilities', label: 'Total liabilities', unit: 'usd', get: (r) => nz(r.totalLiabilities), bold: true },
    { key: 'totalDebt', label: 'Total debt', unit: 'usd', get: (r) => nz(r.totalDebt), indent: true },
    { key: 'netDebt', label: 'Net debt (cash)', unit: 'usd', get: (r) => (r.totalDebt || r.cash ? (r.totalDebt || 0) - (r.cash || 0) : null) },
    { key: 'totalEquity', label: "Shareholders' equity", unit: 'usd', get: (r) => nz(r.totalEquity), bold: true },
    { key: 'roe', label: 'Return on equity', unit: 'pct', get: (r) => (r.totalEquity > 0 && r.netIncome ? (r.netIncome / r.totalEquity) * 100 : null), indent: true },
  ],
  cashflow: [
    { key: 'operatingCashFlow', label: 'Operating cash flow', unit: 'usd', get: (r) => nz(r.operatingCashFlow), bold: true },
    { key: 'capex', label: 'Capital expenditure', unit: 'usd', get: (r) => (r.capex ? -Math.abs(r.capex) : null) },
    { key: 'freeCashFlow', label: 'Free cash flow', unit: 'usd', get: (r) => (r.capex ? nz(r.freeCashFlow) : null), bold: true },
    { key: 'fcfMargin', label: 'FCF margin', unit: 'pct', get: (r) => (r.capex && r.revenue ? (r.freeCashFlow / r.revenue) * 100 : null), indent: true },
    { key: 'fcfConversion', label: 'FCF / net income', unit: 'pct', get: (r) => (r.capex && r.netIncome > 0 ? (r.freeCashFlow / r.netIncome) * 100 : null), indent: true },
  ],
};

const STATEMENT_LABEL: Record<Statement, string> = { income: 'Income statement', balance: 'Balance sheet', cashflow: 'Cash flow' };

function fmtVal(v: number | null, unit: Unit): string {
  if (v == null || !isFinite(v)) return '—';
  switch (unit) {
    case 'usd': return v < 0 ? `(${compactUsd(Math.abs(v))})` : compactUsd(v);
    case 'eps': return v < 0 ? `(${Math.abs(v).toFixed(2)})` : v.toFixed(2);
    case 'pct': return `${v.toFixed(1)}%`;
    case 'shares': return `${(v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}M`;
  }
}
const fmtGrowth = (v: number | null, unit: Unit) => (v == null || !isFinite(v) ? '—' : unit === 'pct' ? `${v > 0 ? '+' : ''}${v.toFixed(1)}pp` : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

export function FinancialStatements({ ticker, annual, quarterly, annualSources, quarterlySources, providers }: {
  ticker: string; annual: Financials | null; quarterly: Financials | null;
  annualSources: Record<string, SourceRef>; quarterlySources: Record<string, SourceRef>; providers: { annual?: string; quarterly?: string };
}) {
  const [statement, setStatement] = React.useState<Statement>('income');
  const [period, setPeriod] = React.useState<FinancialPeriod>(annual?.rows.length ? 'annual' : 'quarterly');
  const [growth, setGrowth] = React.useState(false);
  const openSource = useOpenSource();
  const scroller = React.useRef<HTMLDivElement>(null);

  const fin = period === 'annual' ? annual : quarterly;
  const sources = period === 'annual' ? annualSources : quarterlySources;
  const rows = React.useMemo(() => fin?.rows ?? [], [fin]);
  const lag = yoyLag(period);

  // Start scrolled to the most recent period (right edge).
  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [period, statement, rows.length]);

  const lines = LINES[statement];
  const matrix = React.useMemo(() => lines.map((l) => {
    const vals = rows.map(l.get);
    const g = l.unit === 'pct' ? ppChange(vals, lag) : yoyGrowth(l.key === 'capex' ? vals.map((v) => (v == null ? v : Math.abs(v))) : vals, lag);
    return { line: l, vals, growth: g };
  }), [lines, rows, lag]);

  const provider = period === 'annual' ? providers.annual : providers.quarterly;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Tabs value={statement} onValueChange={(v) => setStatement(v as Statement)}>
          <TabsList aria-label="Statement">
            <TabsTrigger value="income">Income</TabsTrigger>
            <TabsTrigger value="balance">Balance</TabsTrigger>
            <TabsTrigger value="cashflow">Cash flow</TabsTrigger>
          </TabsList>
        </Tabs>
        <div role="group" aria-label="Period" className="inline-flex rounded-md border border-border bg-panel-2 p-0.5">
          {(['annual', 'quarterly'] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPeriod(p)} aria-pressed={period === p}
              disabled={p === 'annual' ? !annual?.rows.length : !quarterly?.rows.length}
              className={cn('rounded px-2.5 py-1 text-xs capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:opacity-40', period === p ? 'bg-accent text-accent-foreground' : 'text-muted hover:text-text')}>
              {p}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-muted">
          <Switch checked={growth} onCheckedChange={setGrowth} aria-label="Show YoY growth" />
          YoY growth
        </label>
        <span className="ml-auto text-[11px] text-muted">
          {rows.length} {period === 'annual' ? 'years' : 'quarters'} · {fin?.currency ?? 'USD'}{provider ? ` · ${provider}` : ''} · click any figure for its source
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title={`No ${period} statements available`} description={`The data providers returned no ${period} financials for ${ticker}. Try the ${period === 'annual' ? 'quarterly' : 'annual'} view or check the filings list below.`} />
      ) : (
        <div ref={scroller} className="overflow-x-auto rounded-md border border-border scrollbar-thin" tabIndex={0} aria-label={`${STATEMENT_LABEL[statement]} table, scroll horizontally for older periods`}>
          <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
            <caption className="sr-only">{ticker} {STATEMENT_LABEL[statement]} ({period}){growth ? ', year-over-year growth' : ''}</caption>
            <thead>
              <tr className="bg-panel-2">
                <th scope="col" className="sticky left-0 z-20 min-w-[200px] border-b border-r border-border bg-panel-2 px-3 py-2 text-left font-medium text-muted">
                  {STATEMENT_LABEL[statement]}
                </th>
                <th scope="col" className="sticky left-[200px] z-20 hidden w-[88px] border-b border-r border-border bg-panel-2 px-2 py-2 text-left font-medium text-muted md:table-cell">Trend</th>
                {rows.map((r) => {
                  const key = `${r.fiscalYear}-${r.fiscalPeriod}`;
                  const s = sources[key];
                  return (
                    <th key={key} scope="col" className="min-w-[92px] border-b border-border px-2 py-1.5 text-right align-bottom font-medium">
                      <div className="font-mono text-text">{periodLabel(r)}</div>
                      <div className="text-[10px] font-normal text-muted">{r.periodEnd}</div>
                      {s && <SourceChip source={s} label={s.name.includes('10-K') ? '10-K' : s.name.includes('10-Q') ? '10-Q' : 'Source'} className="mt-1 px-1 py-0 text-[10px]" />}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {matrix.map(({ line, vals, growth: g }) => {
                const spark = vals.slice(-12).filter((v): v is number => v != null);
                return (
                  <tr key={line.key} className="group">
                    <th scope="row" className={cn('sticky left-0 z-10 border-b border-r border-border bg-panel px-3 py-1.5 text-left font-normal group-hover:bg-panel-2', line.bold && 'font-semibold', line.indent && 'pl-6 text-muted')}>
                      {line.label}{growth && <span className="ml-1 text-[10px] text-muted">{line.unit === 'pct' ? 'Δpp' : 'YoY'}</span>}
                    </th>
                    <td className="sticky left-[200px] z-10 hidden border-b border-r border-border bg-panel px-2 py-1 group-hover:bg-panel-2 md:table-cell">
                      <Sparkline data={spark} width={72} height={18} color={line.unit === 'pct' ? 'info' : undefined} label={`${line.label} trend`} />
                    </td>
                    {rows.map((r, i) => {
                      const key = `${r.fiscalYear}-${r.fiscalPeriod}`;
                      const v = vals[i];
                      const gv = g[i];
                      const text = growth ? fmtGrowth(gv, line.unit) : fmtVal(v, line.unit);
                      const s = sources[key];
                      const neg = growth ? (gv ?? 0) < 0 && line.key !== 'capex' : (v ?? 0) < 0;
                      return (
                        <td key={key} className={cn('border-b border-border px-2 py-1 text-right font-mono tabular-nums group-hover:bg-panel-2/60', line.bold && 'font-semibold', neg && 'text-down', growth && (gv ?? 0) > 0 && 'text-up')}>
                          {v == null || !s ? (
                            <span className={cn(v == null && 'text-muted')}>{text}</span>
                          ) : (
                            <button type="button" className="rounded-sm hover:text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
                              onClick={() => openSource({ ...s, excerpt: `${line.label} for ${periodLabel(r)} (period ended ${r.periodEnd}): ${fmtVal(v, line.unit)}${gv != null ? ` (${fmtGrowth(gv, line.unit)} YoY)` : ''}. ${s.excerpt ?? ''}`.trim() }, {
                                highlight: fmtVal(v, line.unit), title: `${ticker} · ${line.label} · ${periodLabel(r)}`,
                              })}
                              aria-label={`${line.label} ${periodLabel(r)} ${text} — show source`}>
                              {text}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">
        Figures in USD; negatives in parentheses. {period === 'quarterly' ? 'YoY compares to the same quarter a year earlier.' : 'YoY compares to the prior fiscal year.'} Blank (—) means the provider did not report the line item.
      </p>
    </div>
  );
}
