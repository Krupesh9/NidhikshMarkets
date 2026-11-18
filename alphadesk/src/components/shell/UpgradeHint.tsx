import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { PLAN_INFO, type GateResult, type Plan } from '@/lib/plans';
import { cn } from '@/lib/utils';

/**
 * Inline, non-blocking upgrade prompt. Pass a GateResult from assertFeature/checkLimit (or reason+upgradeTo).
 *   {!gate.allowed && <UpgradeHint gate={gate} />}
 */
export function UpgradeHint({ gate, reason, upgradeTo, className, compact }: { gate?: GateResult; reason?: string; upgradeTo?: Plan; className?: string; compact?: boolean }) {
  if (gate?.allowed) return null;
  const to = gate?.upgradeTo ?? upgradeTo;
  const msg = gate?.reason ?? reason ?? 'This is available on a higher plan.';
  const info = to ? PLAN_INFO[to] : undefined;
  return (
    <div role="note" className={cn('flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs', compact && 'py-1', className)}>
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
      <span className="text-text">{msg}</span>
      {info && (
        <Link href="/settings#plan" className="ml-auto font-medium text-accent hover:underline">
          Upgrade to {info.label} (${info.priceMonthly}/mo) →
        </Link>
      )}
    </div>
  );
}
