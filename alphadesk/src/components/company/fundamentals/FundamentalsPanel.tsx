'use client';
import * as React from 'react';
import { Info, Landmark, PieChart } from 'lucide-react';
import { dcf, type DcfParams, type DcfResult } from '@/lib/fundamentals/formulas';
import type { FundamentalsModel } from '@/lib/fundamentals/types';
import type { SavedPreset } from '@/lib/fundamentals/defaults';
import { toast } from '@/components/ui/toast';
import { EmptyState } from '@/components/ui/empty-state';
import { SourceChip } from '@/components/ui/source-chip';
import { ValuationSummary, type SummaryRow } from './ValuationSummary';
import { DcfCard } from './DcfCard';
import { GrahamCard } from './GrahamCard';
import { DeTile, PbTile, PegTile } from './RatioTiles';
import { SaveAssumptionsButton, SavedAssumptionsChip } from './SavedAssumptions';

/** Device cache of the user's global required margin of safety (the server copy is authoritative). */
const MOS_KEY = 'nd-required-mos-v2';
/** Pre-2026-11 key; its old default was 25%, which now means "never edited". */
const LEGACY_MOS_KEY = 'nd-required-mos';
const LEGACY_MOS_DEFAULT = 25;

async function call(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.details?.[0]?.message ?? j?.error?.message ?? `HTTP ${r.status}`);
  return j;
}
const validMos = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 90;

/**
 * "Fundamental values" body: valuation summary, live 3-year DCF, Graham intrinsic value, PEG / P/B / D/E tiles and
 * methodology. All formulas come from '@/lib/fundamentals/formulas' (shared with the server + API).
 */
export function FundamentalsPanel({ model, preset = null, userRequiredMos = null }: { model: FundamentalsModel; preset?: SavedPreset | null; userRequiredMos?: number | null }) {
  const orgMos = model.valuation.graham.requiredMos;
  const [saved, setSaved] = React.useState<SavedPreset | null>(preset);
  // the user's global required margin (server → else org default); per-ticker saved assumptions override it
  const [globalMos, setGlobalMos] = React.useState<number>(validMos(userRequiredMos) ? userRequiredMos : orgMos);
  const [params, setParams] = React.useState<DcfParams>(preset ? { growth: preset.growth, discount: preset.discount, terminal: preset.terminal } : model.dcf.params);
  const [required, setRequiredState] = React.useState<number>(preset ? preset.requiredMos : validMos(userRequiredMos) ? userRequiredMos : orgMos);
  const [busy, setBusy] = React.useState(false);
  const financial = model.kind === 'financial';

  // localStorage = instant fallback / migration source; the server keeps the real value.
  React.useEffect(() => {
    try {
      if (validMos(userRequiredMos)) { localStorage.setItem(MOS_KEY, String(userRequiredMos)); localStorage.removeItem(LEGACY_MOS_KEY); return; }
      let local: number | null = localStorage.getItem(MOS_KEY) !== null ? Number(localStorage.getItem(MOS_KEY)) : null;
      const legacy = localStorage.getItem(LEGACY_MOS_KEY);
      if (local == null && legacy !== null && Number(legacy) !== LEGACY_MOS_DEFAULT) local = Number(legacy); // 25 = old untouched default
      localStorage.removeItem(LEGACY_MOS_KEY);
      if (!validMos(local)) return;
      setGlobalMos(local);
      if (!preset) setRequiredState(local);
      call('/api/fundamentals/preferences', { method: 'PUT', body: JSON.stringify({ requiredMos: local }) }).catch(() => undefined);
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Without per-ticker saved assumptions, the margin slider edits the user's global default (debounced to the server).
  const persistTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const setRequired = (v: number) => {
    setRequiredState(v);
    if (saved) return; // part of this ticker's assumptions until "Save"/"Update"
    setGlobalMos(v);
    try { localStorage.setItem(MOS_KEY, String(v)); } catch { /* ignore */ }
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => { call('/api/fundamentals/preferences', { method: 'PUT', body: JSON.stringify({ requiredMos: v }) }).catch(() => undefined); }, 600);
  };

  const dirty = !!saved && (saved.growth !== params.growth || saved.discount !== params.discount || saved.terminal !== params.terminal || saved.requiredMos !== required);
  const baseline: DcfParams = saved ? { growth: saved.growth, discount: saved.discount, terminal: saved.terminal } : model.dcf.defaults;

  const saveAssumptions = async () => {
    setBusy(true);
    try {
      const j = await call(`/api/fundamentals/presets/${encodeURIComponent(model.ticker)}`, { method: 'PUT', body: JSON.stringify({ ...params, requiredMos: required }) });
      setSaved(j.preset);
      toast({ title: `Assumptions saved for ${model.ticker}`, description: `Growth ${params.growth.toFixed(1)}%, discount ${params.discount.toFixed(1)}%, terminal ${params.terminal.toFixed(1)}%, required margin ${required}%.`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Assumptions not saved', description: (err as Error).message, variant: 'error' });
    } finally { setBusy(false); }
  };
  const resetToDefaults = async () => {
    setBusy(true);
    try {
      await call(`/api/fundamentals/presets/${encodeURIComponent(model.ticker)}`, { method: 'DELETE' }).catch((e: Error) => { if (!/not found|no saved/i.test(e.message)) throw e; });
      setSaved(null);
      setParams(model.dcf.defaults);
      setRequiredState(globalMos);
      toast({ title: 'Back to the default assumptions', description: `Your saved ${model.ticker} assumptions were removed.`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Reset failed', description: (err as Error).message, variant: 'error' });
    } finally { setBusy(false); }
  };
  const saveControls = <SaveAssumptionsButton saved={saved} dirty={dirty} busy={busy} onSave={saveAssumptions} />;
  const chip = saved ? <SavedAssumptionsChip busy={busy} onReset={resetToDefaults} /> : null;
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
        <>
        <div className="flex flex-wrap items-center justify-between gap-3">{chip ?? <span />}{saveControls}</div>
        <div className="flex gap-3 rounded-xl border border-border bg-panel-2/40 p-5">
          <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium">DCF and debt-to-equity are not meaningful for {model.name ?? model.ticker}</p>
            <p className="text-xs leading-relaxed text-muted">{[model.dcf.reason, model.de.reason].map((r) => (r ?? '').replace(/^Not meaningful for financial companies:\s*/, '')).map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(' ')}</p>
          </div>
        </div>
        </>
      ) : (
        <DcfCard ticker={model.ticker} model={model.dcf} params={params} setParams={setParams} result={result} price={model.price} riskFree={model.riskFree}
          ranges={model.valuation.dcf.ranges} baseline={baseline} hasSaved={!!saved} actions={saveControls} chip={chip} />
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <GrahamCard model={model.graham} growth={model.growth} aaa={model.aaa} price={model.price} required={required} setRequired={setRequired} defaultRequired={orgMos} />
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
          <li><span className="text-text">Intrinsic value (Graham, 1974):</span> V = EPS(TTM, diluted) × ({model.graham.constants.basePe} + {model.graham.constants.growthMultiplier}g) × {model.graham.constants.baseYield} ÷ Y, g = {model.graham.growthMode === 'fixed' ? `${model.valuation.graham.fixedGrowth}% (owner default)` : `expected EPS growth (capped ${model.valuation.dcf.growthCapMin}…+${model.valuation.dcf.growthCapMax}%, floored at 0)`}, Y = {model.aaa.series === 'override' ? `${model.aaa.value}% (owner default)` : 'Moody’s Aaa corporate yield (FRED)'}. Graham Number = √(22.5 × EPS × BVPS).</li>
          <li><span className="text-text">DCF:</span> TTM free cash flow (operating cash flow − capex) grown 3 years at g, terminal value = FCF₃ × (1 + gT) ÷ (r − gT), discounted at r; + cash − debt, ÷ diluted shares. Defaults: {model.dcf.growthBasis}; {model.dcf.discountBasis}; terminal growth {model.valuation.dcf.terminal}%. Defaults are set by the workspace owner; your saved assumptions override them for you only.</li>
          <li><span className="text-text">PEG</span> = P/E(TTM) ÷ EPS growth % (bands: below {model.peg.thresholds.fairFrom}, {model.peg.thresholds.fairFrom}–{model.peg.thresholds.richAbove}, above {model.peg.thresholds.richAbove}). <span className="text-text">P/B</span> = price ÷ (equity ÷ diluted shares). <span className="text-text">D/E</span> = (long + short-term debt) ÷ equity. Histories use each fiscal year-end’s 10-K and that day’s split-adjusted close.</li>
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
