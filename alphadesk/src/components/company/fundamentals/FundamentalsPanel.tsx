'use client';
import * as React from 'react';
import { Info, Landmark, PieChart } from 'lucide-react';
import { dcf, type DcfParams, type DcfResult } from '@/lib/fundamentals/formulas';
import type { FundamentalsModel } from '@/lib/fundamentals/types';
import { EmptyState } from '@/components/ui/empty-state';
import { SourceChip } from '@/components/ui/source-chip';
import { ValuationSummary, type SummaryRow } from './ValuationSummary';
import { DcfCard } from './DcfCard';
import { GrahamCard } from './GrahamCard';
import { DeTile, PbTile, PegTile } from './RatioTiles';

/**
 * "Fundamental values" body: valuation summary, live 3-year DCF, Graham intrinsic value, PEG / P/B / D/E tiles and
 * methodology. All formulas come from '@/lib/fundamentals/formulas' (shared with the server + API).
 */
export function FundamentalsPanel({ model }: { model: FundamentalsModel }) {
  const [params, setParams] = React.useState<DcfParams>(model.dcf.params);
  const financial = model.kind === 'financial';
  const result: DcfResult | null = React.useMemo(
    () => (!financial && model.dcf.inputs ? dcf(model.dcf.inputs, params) : model.dcf.result),
    [financial, model.dcf.inputs, model.dcf.result, params],
  );

  if (model.kind === 'fund' || model.kind === 'unavailable') {
    return (
      <EmptyState
        icon={PieChart}
        title={model.kind === 'fund' ? 'Not applicable to funds' : 'Fundamental values unavailable'}
        description={<>{model.reason} {model.kind === 'fund' ? 'Look at the holdings, expense ratio and tracking instead.' : 'Try a US-listed operating company that files 10-K/10-Q reports with the SEC.'}</>}
      />
    );
  }

  const okDcf = result?.ok ? result : null;
  const rows: SummaryRow[] = [
    { key: 'graham', label: 'Intrinsic value', sub: 'Graham formula', value: model.graham.value, source: model.graham.source, tone: 'info', nmText: model.graham.reason ? 'Not meaningful' : undefined },
    {
      key: 'dcf', label: 'DCF value', sub: financial ? 'Not used for financials' : `3-yr DCF · ${params.growth.toFixed(1)}% / ${params.discount.toFixed(1)}% / ${params.terminal.toFixed(1)}%`,
      value: okDcf?.perShare ?? null, source: model.dcf.source, tone: 'accent', nmText: financial ? 'Not meaningful for financial companies' : 'Not meaningful',
    },
    { key: 'gn', label: 'Graham Number', sub: 'Conservative check', value: model.graham.grahamNumber, source: model.graham.numberSource, tone: 'muted' },
  ];

  return (
    <div className="space-y-6">
      <ValuationSummary price={model.price} priceSource={model.priceSource} rows={rows} />

      {financial ? (
        <div className="flex gap-3 rounded-xl border border-border bg-panel-2/40 p-5">
          <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium">DCF and debt-to-equity are not meaningful for {model.name ?? model.ticker}</p>
            <p className="text-xs leading-relaxed text-muted">{[model.dcf.reason, model.de.reason].map((r) => (r ?? '').replace(/^Not meaningful for financial companies:\s*/, '')).map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(' ')}</p>
          </div>
        </div>
      ) : (
        <DcfCard ticker={model.ticker} model={model.dcf} params={params} setParams={setParams} result={result} price={model.price} riskFree={model.riskFree} />
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <GrahamCard model={model.graham} growth={model.growth} aaa={model.aaa} price={model.price} />
        <PegTile model={model.peg} />
        <PbTile model={model.pb} isFinancial={financial} />
        {financial ? (
          <div className="flex flex-col rounded-xl border border-border bg-panel-2/40 p-5">
            <h3 className="eyebrow">Debt-to-equity</h3>
            <p className="mt-3 text-sm font-medium text-muted">Not meaningful for financial companies</p>
            <p className="mt-1 text-xs text-muted">{model.de.reason}</p>
          </div>
        ) : <DeTile model={model.de} />}
      </div>

      <footer className="space-y-3 border-t border-border pt-5">
        <h3 className="eyebrow">Methodology & sources</h3>
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted">
          <li><span className="text-text">Intrinsic value (Graham, 1974):</span> V = EPS(TTM, diluted) × (8.5 + 2g) × 4.4 ÷ Y, g = expected EPS growth (capped −10…+25%, floored at 0), Y = Moody’s Aaa corporate yield (FRED). Graham Number = √(22.5 × EPS × BVPS).</li>
          <li><span className="text-text">DCF:</span> TTM free cash flow (operating cash flow − capex) grown 3 years at g, terminal value = FCF₃ × (1 + gT) ÷ (r − gT), discounted at r = 10-yr Treasury + β × {model.dcf.erp}% ERP; + cash − debt, ÷ diluted shares.</li>
          <li><span className="text-text">PEG</span> = P/E(TTM) ÷ EPS growth %. <span className="text-text">P/B</span> = price ÷ (equity ÷ diluted shares). <span className="text-text">D/E</span> = (long + short-term debt) ÷ equity. Histories use each fiscal year-end’s 10-K and that day’s split-adjusted close.</li>
          {model.notes.map((n) => <li key={n} className="flex gap-1.5"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{n}</li>)}
        </ul>
        <div className="flex flex-wrap gap-1.5">
          {model.sources.map((s, i) => <SourceChip key={s.id} source={s} index={i + 1} />)}
        </div>
        <p className="text-[11px] text-muted">Research only — not investment advice. These models are simplified and highly sensitive to their assumptions; small changes in growth or discount rate move the result materially.</p>
      </footer>
    </div>
  );
}
