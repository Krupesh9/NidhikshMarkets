import { CheckCircle2, CircleDashed, Database, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProviderStatus } from '@/lib/data/providers-status';
import { ApiUsage } from './ApiUsage';

const KIND: Record<ProviderStatus['kind'], string> = { market: 'Market data', fundamentals: 'Fundamentals & estimates', macro: 'Macro', ai: 'AI', auth: 'Sign-in' };

/**
 * Configured providers — booleans only; key values never leave the server — plus "API usage & limits" (calls per
 * provider vs. its limit, polled from the owner-only /api/admin/usage). `fmp` is accepted for compatibility; FMP usage
 * now shows in the usage table.
 */
export function DataSources({ providers, mockAllowed, dataLabel }: { providers: ProviderStatus[]; mockAllowed: boolean; dataLabel: string; fmp?: { calls: number; limit: number } }) {
  return (
    <Card id="data-sources" className="scroll-mt-28">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4 text-muted" aria-hidden /> Data sources</CardTitle>
        <CardDescription>
          Mode: <strong className="text-text">{dataLabel}</strong>. Simulated demo data is <strong className="text-text">{mockAllowed ? 'allowed' : 'off'}</strong>
          {mockAllowed ? ' (development).' : ' — sections without a real source show an empty state.'} Keys are set as deployment environment variables and are never shown here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ApiUsage />
        <div className="space-y-3">
        <h3 className="text-sm font-semibold">Connections</h3>
        <ul className="divide-y divide-border rounded-md border border-border">
          {providers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              {p.configured
                ? <CheckCircle2 className="h-4 w-4 shrink-0 text-up" aria-label="Configured" />
                : <CircleDashed className="h-4 w-4 shrink-0 text-muted" aria-label="Not configured" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[11px] text-muted">{KIND[p.kind]}</span>
                </div>
                <div className="text-xs text-muted">{p.purpose}</div>
              </div>
              <div className="text-right text-xs">
                <div className={p.configured ? 'text-up' : 'text-muted'}>{p.configured ? 'Configured' : 'Not configured'}</div>
                <div className="text-[11px] text-muted">{p.lastSuccess ? `Last success ${new Date(p.lastSuccess).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : p.configured ? 'No calls yet this session' : ''}</div>
              </div>
              {p.url && (
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="rounded p-1 text-muted hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info" aria-label={`${p.name} website`}>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </li>
          ))}
        </ul>
        </div>
      </CardContent>
    </Card>
  );
}
