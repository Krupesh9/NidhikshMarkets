'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, ChevronDown, ChevronRight, FileUp, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Delta } from '@/components/ui/delta';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { MockBanner } from '@/components/shell/MockBanner';
import { PageHeader } from '@/components/shell/PageHeader';
import { useRightRail } from '@/components/shell/RightRail';
import { ShareButton } from '@/components/sharing/ShareButton';
import type { PortfolioAnalyticsResponse } from '@/lib/analytics/server';
import { RATE_SENSITIVITY_PER_100BP, type StressResult } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { AttributionChart, ExposureBars, PerformanceChart, VarHistogram } from './charts';
import { CsvImportDialog } from './CsvImportDialog';
import { Methodology } from './Methodology';
import { PositionsTable } from './PositionsTable';
import { api, BENCHMARK_OPTIONS, num, pct, PERIOD_OPTIONS, signedUsd, tone, usd, usdCompact } from './format';

type Resp = PortfolioAnalyticsResponse;

export function PortfolioDashboard({ portfolio }: { portfolio: { id: string; name: string; description: string | null; benchmark: string; tickers: string[] } }) {
  const router = useRouter();
  const rail = useRightRail();
  const [benchmark, setBenchmark] = React.useState(['SPY', 'QQQ', 'IWM'].includes(portfolio.benchmark) ? portfolio.benchmark : 'SPY');
  const [period, setPeriod] = React.useState<string>('1Y');
  const [data, setData] = React.useState<Resp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [pendingMsg, setPendingMsg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const reqId = React.useRef(0);

  const load = React.useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true); setError(null);
    try {
      for (let i = 0; i < 120; i++) {
        const r = await fetch(`/api/portfolios/${portfolio.id}/analytics?benchmark=${benchmark}&period=${period}`, { cache: 'no-store' });
        const j = await r.json();
        if (id !== reqId.current) return;
        if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
        if (r.status === 202) { setPendingMsg(j.message); await new Promise((res) => setTimeout(res, 1500)); continue; }
        setData(j as Resp); setPendingMsg(null);
        break;
      }
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [portfolio.id, benchmark, period]);
  React.useEffect(() => { void load(); }, [load]);

  async function changeBenchmark(b: string) {
    setBenchmark(b);
    api(`/api/portfolios/${portfolio.id}`, { method: 'PATCH', json: { benchmark: b } }).catch(() => undefined);
  }
  async function del() {
    if (!confirm(`Delete portfolio “${portfolio.name}”? This cannot be undone.`)) return;
    try { await api(`/api/portfolios/${portfolio.id}`, { method: 'DELETE' }); toast({ title: 'Portfolio deleted' }); router.push('/portfolios'); }
    catch (e) { toast({ title: 'Delete failed', description: (e as Error).message, variant: 'error' }); }
  }

  const a = data?.analytics;
  const openMethodology = () => a && rail.open({ key: `pf-method-${portfolio.id}`, title: 'Methodology & sources', content: <Methodology assumptions={a.assumptions} sources={data?.meta.sources} extra={<RateTable />} /> });

  const snapshot = () => (a ? {
    name: portfolio.name, description: portfolio.description, benchmark, isMock: data?.meta.isMock, sources: data?.meta.sources,
    positions: a.positions.map((p) => ({ ticker: p.ticker, quantity: p.quantity, costBasis: p.costBasis, price: p.price, marketValue: p.marketValue, weight: p.weight, changePct: p.dayPct * 100, pnl: p.unrealizedPnl, sector: p.sector })),
    metrics: {
      'Total value': a.valuation.nav, 'Day P&L': a.valuation.dayPnl, 'Gross exposure': pct(a.valuation.grossPct), 'Net exposure': pct(a.valuation.netPct),
      Beta: num(a.risk.beta), '1-day VaR 95%': a.risk.var95_1d, 'Annualised vol': pct(a.risk.annualVol), [`${period} return`]: pct(a.performance.portfolioReturn, 2, true), [`${period} active vs ${benchmark}`]: pct(a.performance.active, 2, true),
    },
  } : {});

  return (
    <div className="space-y-4">
      <PageHeader
        title={portfolio.name}
        description={portfolio.description ?? undefined}
        actions={<>
          <Select value={benchmark} onValueChange={changeBenchmark}>
            <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Benchmark"><SelectValue /></SelectTrigger>
            <SelectContent>{BENCHMARK_OPTIONS.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent>
          </Select>
          <div role="group" aria-label="Period" className="flex rounded-md border border-border p-0.5">
            {PERIOD_OPTIONS.map((p) => (
              <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p} className={cn('rounded px-2 py-1 text-xs font-medium', period === p ? 'bg-panel-2 text-text' : 'text-muted hover:text-text')}>{p}</button>
            ))}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => void load()} aria-label="Recompute analytics"><RefreshCw className={cn(loading && 'animate-spin')} /></Button>
          <Button variant="ghost" size="sm" onClick={openMethodology} disabled={!a}><BookOpen /> Methodology</Button>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}><FileUp /> Import</Button>
          <ShareButton itemType="portfolio" itemId={portfolio.id} title={portfolio.name} snapshot={snapshot} />
          <Button variant="ghost" size="icon-sm" onClick={del} aria-label="Delete portfolio"><Trash2 /></Button>
        </>}
      />
      {data && <MockBanner isMock={data.meta.isMock} provider={data.meta.providers.filter((p) => p !== 'Mock').join(' + ') || undefined}>
        {data.meta.isMock && data.meta.mockTickers.length > 0 ? <><strong className="font-semibold">Partly simulated.</strong> Prices for {data.meta.mockTickers.join(', ')} are demo data{data.meta.providers.length > 1 ? `; others from ${data.meta.providers.filter((p) => p !== 'Mock').join(' + ')}` : ''}. Research only — not investment advice.</> : undefined}
      </MockBanner>}
      {error && <Card className="border-down/40 p-4 text-sm text-down" role="alert">Could not compute analytics: {error} <Button variant="link" size="sm" onClick={() => void load()}>Retry</Button></Card>}
      {pendingMsg && <p className="text-xs text-info" role="status">{pendingMsg}</p>}

      {!a ? <DashboardSkeleton /> : a.positions.length === 0 ? (
        <>
          <EmptyState title="No positions yet" description="Add positions below or import a CSV to see exposure, VaR, stress tests and attribution." action={<Button size="sm" onClick={() => setImportOpen(true)}><FileUp /> Import CSV</Button>} />
          <PositionsTable portfolioId={portfolio.id} positions={[]} onChanged={() => void load()} />
        </>
      ) : (
        <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
          <Hero r={data!} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Sector exposure</CardTitle><CardDescription>Long (green) / short (red) as % of NAV · HHI {num(a.exposure.sector.hhi, 3)} · effective {num(a.exposure.sector.effectiveN, 1)} sectors</CardDescription></CardHeader>
              <CardContent><ExposureBars buckets={a.exposure.sector.buckets} nav={a.valuation.nav} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Country & concentration</CardTitle><CardDescription>Country HHI {num(a.exposure.country.hhi, 3)} · position HHI {num(a.exposure.positionHhi, 3)} (≈{num(a.exposure.effectivePositions, 1)} effective names)</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <ExposureBars buckets={a.exposure.country.buckets} nav={a.valuation.nav} height={Math.max(100, a.exposure.country.buckets.length * 28 + 40)} />
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Largest weights</div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.exposure.topWeights.map((t) => <span key={t.ticker} className="rounded border border-border bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] tabular-nums">{t.ticker} <span className={tone(t.weight)}>{pct(t.weight, 1)}</span></span>)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Positions</CardTitle><CardDescription>{a.positions.length} positions · weights are % of NAV (signed)</CardDescription></CardHeader>
            <CardContent><PositionsTable portfolioId={portfolio.id} positions={a.positions} onChanged={() => void load()} /></CardContent>
          </Card>

          <RiskPanel r={data!} />
          <StressPanel stress={a.stress} />
          <AttributionPanel r={data!} />

          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Methodology & assumptions</h2>
            <Methodology assumptions={a.assumptions} sources={data!.meta.sources} />
            <p className="mt-2 text-[11px] text-muted">Computed {new Date(data!.meta.computedAt).toLocaleString()} · cached for 5 minutes.</p>
          </Card>
        </div>
      )}
      <CsvImportDialog open={importOpen} onOpenChange={setImportOpen} portfolio={{ id: portfolio.id, name: portfolio.name, tickers: a?.positions.map((p) => p.ticker) ?? portfolio.tickers }} onDone={() => void load()} />
    </div>
  );
}

function Hero({ r }: { r: Resp }) {
  const v = r.analytics.valuation;
  const k = r.analytics.risk;
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-4 p-4 md:grid-cols-[1.4fr_repeat(4,1fr)] md:items-end">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Total value (NAV)</div>
          <div className="font-mono text-3xl font-semibold tabular-nums">{usd(v.nav)}</div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className={cn('font-mono tabular-nums', tone(v.dayPnl))}>{signedUsd(v.dayPnl)}</span>
            <Delta value={v.dayPct * 100} />
            <span className="text-xs text-muted">today</span>
          </div>
          <div className="mt-1 text-xs text-muted">Unrealised <span className={cn('font-mono', tone(v.unrealizedPnl))}>{signedUsd(v.unrealizedPnl)}</span></div>
        </div>
        <HeroStat label="Gross exposure" value={pct(v.grossPct, 0)} hint={`${usdCompact(v.longMarketValue)} L / ${usdCompact(v.shortMarketValue)} S`} />
        <HeroStat label="Net exposure" value={pct(v.netPct, 0)} hint={`${usdCompact(v.netExposure)} net`} />
        <HeroStat label={`Beta vs ${r.benchmark.id}`} value={num(k.beta)} hint={k.betaSource === 'regression' ? `${k.observations}d regression` : k.betaSource === 'mixed' ? 'regression + reference*' : 'reference beta*'} />
        <HeroStat label="1-day VaR 95%" value={usdCompact(k.var95_1d)} hint={`${pct(k.var95_1dPct, 2)} of NAV · MC 5,000 paths`} tone="down" />
      </div>
    </Card>
  );
}
function HeroStat({ label, value, hint, tone: t }: { label: string; value: string; hint?: string; tone?: 'down' }) {
  return (
    <div className="border-border md:border-l md:pl-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn('font-mono text-xl font-semibold tabular-nums', t === 'down' && 'text-down')}>{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

function RiskPanel({ r }: { r: Resp }) {
  const k = r.analytics.risk;
  const mc = k.monteCarlo;
  const h1 = mc.horizons[0];
  const lv = (h: typeof h1, c: number) => h.levels.find((l) => l.confidence === c)!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk</CardTitle>
        <CardDescription>Monte Carlo ({mc.paths.toLocaleString()} paths, {mc.distribution === 'student-t' ? `Student-t ν=${mc.df}` : 'normal'}) · annualised vol {pct(k.annualVol)}{k.trackingError != null ? ` · tracking error ${pct(k.trackingError)}` : ''}{k.benchmarkVol != null ? ` · ${r.benchmark.id} vol ${pct(k.benchmarkVol)}` : ''}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Simulated 1-day P&L distribution</div>
          <VarHistogram bins={mc.histogram} var95={lv(h1, 0.95).var} var99={lv(h1, 0.99).var} />
        </div>
        <div className="space-y-3">
          <Table>
            <TableHeader><TableRow><TableHead>Horizon</TableHead><TableHead numeric>VaR 95</TableHead><TableHead numeric>CVaR 95</TableHead><TableHead numeric>VaR 99</TableHead><TableHead numeric>CVaR 99</TableHead></TableRow></TableHeader>
            <TableBody>
              {mc.horizons.map((h) => (
                <TableRow key={h.days}>
                  <TableCell>{h.days}-day</TableCell>
                  <TableCell numeric>{usdCompact(lv(h, 0.95).var)}</TableCell>
                  <TableCell numeric className="text-down">{usdCompact(lv(h, 0.95).cvar)}</TableCell>
                  <TableCell numeric>{usdCompact(lv(h, 0.99).var)}</TableCell>
                  <TableCell numeric className="text-down">{usdCompact(lv(h, 0.99).cvar)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="text-muted">
                <TableCell className="text-[11px]">1d parametric</TableCell>
                <TableCell numeric>{usdCompact(h1.parametric[0]?.var)}</TableCell><TableCell numeric>{usdCompact(h1.parametric[0]?.cvar)}</TableCell>
                <TableCell numeric>{usdCompact(h1.parametric[1]?.var)}</TableCell><TableCell numeric>{usdCompact(h1.parametric[1]?.cvar)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Top contributors to 1-day CVaR 99</div>
            <ul className="space-y-1 text-xs">
              {mc.contributions.slice(0, 6).map((c) => (
                <li key={c.label} className="grid grid-cols-[52px_1fr_64px] items-center gap-2">
                  <span className="font-mono font-semibold">{c.label}</span>
                  <span className="h-1.5 rounded bg-panel-2" aria-hidden><span className={cn('block h-full rounded', c.share >= 0 ? 'bg-down/70' : 'bg-up/70')} style={{ width: `${Math.min(100, Math.abs(c.share) * 100)}%` }} /></span>
                  <span className="text-right font-mono tabular-nums">{pct(c.share, 0)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted">Negative share = position hedges tail losses.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StressPanel({ stress }: { stress: StressResult[] }) {
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <Card>
      <CardHeader><CardTitle>Stress tests</CardTitle><CardDescription>Instantaneous shocks applied to current positions; P&L per position = market value × shock.</CardDescription></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Scenario</TableHead><TableHead numeric>P&L</TableHead><TableHead numeric>% NAV</TableHead><TableHead>Worst</TableHead><TableHead>Best</TableHead></TableRow></TableHeader>
          <TableBody>
            {stress.map((s) => (
              <React.Fragment key={s.id}>
                <TableRow className="cursor-pointer" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  <TableCell>
                    <button className="inline-flex items-center gap-1 text-left font-medium" aria-expanded={open === s.id} onClick={(e) => { e.stopPropagation(); setOpen(open === s.id ? null : s.id); }}>
                      {open === s.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{s.name}
                    </button>
                    <div className="max-w-md whitespace-normal text-[11px] text-muted">{s.description}</div>
                  </TableCell>
                  <TableCell numeric className={tone(s.pnl)}>{signedUsd(s.pnl)}</TableCell>
                  <TableCell numeric className={tone(s.pnl)}>{pct(s.pnlPct, 2, true)}</TableCell>
                  <TableCell className="font-mono text-xs">{s.worst ? <>{s.worst.ticker} <span className={tone(s.worst.pnl)}>{signedUsd(s.worst.pnl)}</span></> : '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{s.best ? <>{s.best.ticker} <span className={tone(s.best.pnl)}>{signedUsd(s.best.pnl)}</span></> : '—'}</TableCell>
                </TableRow>
                {open === s.id && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="bg-panel-2/50 p-3">
                      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
                        <Table>
                          <TableHeader><TableRow><TableHead>Ticker</TableHead><TableHead>Sector</TableHead><TableHead numeric>Mkt value</TableHead><TableHead numeric>Beta</TableHead><TableHead numeric>Shock</TableHead><TableHead numeric>P&L</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {s.positions.map((p) => (
                              <TableRow key={p.ticker}>
                                <TableCell className="font-mono font-semibold">{p.ticker}</TableCell><TableCell className="text-xs text-muted">{p.sector}</TableCell>
                                <TableCell numeric>{usdCompact(p.marketValue)}</TableCell><TableCell numeric>{num(p.beta)}</TableCell>
                                <TableCell numeric className={tone(p.shock)}>{pct(p.shock, 1, true)}</TableCell><TableCell numeric className={tone(p.pnl)}>{signedUsd(p.pnl)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {s.sectorTable && (
                          <div>
                            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Sector shock table</div>
                            <ul className="space-y-0.5 text-xs">
                              {Object.entries(s.sectorTable).sort((x, y) => x[1] - y[1]).map(([k, v]) => <li key={k} className="flex justify-between gap-2"><span className="text-muted">{k}</span><span className={cn('font-mono tabular-nums', tone(v))}>{pct(v, 1, true)}</span></li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
        <p className="mt-2 text-[11px] text-muted">Sector sensitivities are illustrative house assumptions (equity-duration proxies for rates; supply-shock pass-through for oil), not forecasts. Unclassified names use beta-scaled market moves.</p>
      </CardContent>
    </Card>
  );
}

function AttributionPanel({ r }: { r: Resp }) {
  const at = r.analytics.attribution;
  const pf = r.analytics.performance;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance & attribution vs {r.benchmark.label}</CardTitle>
        <CardDescription>{pf.start ? `${pf.start} → ${pf.end}` : 'Insufficient history'} · Brinson-style (BHB) by sector, buy-and-hold of current holdings</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Portfolio', pf.portfolioReturn], [r.benchmark.id, pf.benchmarkReturn], ['Active', pf.active], ['Allocation', at.allocation], ['Selection + interaction', at.selection + at.interaction],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-md border border-border bg-panel-2/50 p-2">
              <div className="text-[11px] uppercase tracking-wide text-muted">{l as string}</div>
              <div className={cn('font-mono text-base font-semibold tabular-nums', tone(v as number))}>{pct(v as number, 2, true)}</div>
            </div>
          ))}
        </div>
        <Tabs defaultValue="chart">
          <TabsList><TabsTrigger value="chart">Cumulative</TabsTrigger><TabsTrigger value="attr">By sector</TabsTrigger><TabsTrigger value="table">Table</TabsTrigger></TabsList>
          <TabsContent value="chart"><PerformanceChart series={pf.series} benchmarkLabel={r.benchmark.label} /></TabsContent>
          <TabsContent value="attr"><AttributionChart segments={at.segments} /></TabsContent>
          <TabsContent value="table">
            <Table>
              <TableHeader><TableRow><TableHead>Sector</TableHead><TableHead numeric>Port wt</TableHead><TableHead numeric>Bench wt</TableHead><TableHead numeric>Port ret</TableHead><TableHead numeric>Bench ret</TableHead><TableHead numeric>Alloc.</TableHead><TableHead numeric>Select.</TableHead><TableHead numeric>Interact.</TableHead><TableHead numeric>Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {at.segments.map((s) => (
                  <TableRow key={s.sector}>
                    <TableCell className="text-xs">{s.sector}</TableCell>
                    <TableCell numeric>{pct(s.wp)}</TableCell><TableCell numeric>{pct(s.wb)}</TableCell>
                    <TableCell numeric className={tone(s.rp)}>{pct(s.rp, 1, true)}</TableCell><TableCell numeric className={tone(s.rb)}>{pct(s.rb, 1, true)}</TableCell>
                    <TableCell numeric className={tone(s.allocation)}>{pct(s.allocation, 2, true)}</TableCell>
                    <TableCell numeric className={tone(s.selection)}>{pct(s.selection, 2, true)}</TableCell>
                    <TableCell numeric className={tone(s.interaction)}>{pct(s.interaction, 2, true)}</TableCell>
                    <TableCell numeric className={cn('font-semibold', tone(s.total))}>{pct(s.total, 2, true)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
        {r.meta.attributionProxyIsMock && (
          <MockBanner>Benchmark sector returns use a simulated {at.proxyNames}-name constituent proxy{at.calibrated ? `, calibrated so the total matches ${r.benchmark.proxy}'s actual ${pf.period} return` : ''}; sector weights are static reference weights. Research only — not investment advice.</MockBanner>
        )}
      </CardContent>
    </Card>
  );
}

function RateTable() {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide">Rate sensitivity per +100bp (equity duration proxy)</div>
      <ul className="space-y-0.5">
        {Object.entries(RATE_SENSITIVITY_PER_100BP).sort((a, b) => a[1] - b[1]).map(([k, v]) => <li key={k} className="flex justify-between"><span>{k}</span><span className={cn('font-mono', tone(v))}>{pct(v, 1, true)}</span></li>)}
      </ul>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Computing analytics">
      <Skeleton className="h-28" />
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      <Skeleton className="h-72" />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
      <p className="text-xs text-muted">Running 5,000-path Monte Carlo, stress tests and attribution…</p>
    </div>
  );
}
