import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { GateResult } from '@/lib/plans';
import { UpgradeHint } from '@/components/shell/UpgradeHint';
import { Card } from '@/components/ui/card';

/** Inline (non-blocking) card shown instead of the page body when a FREE user is over the daily deep-dive limit. */
export function DeepDiveLimitCard({ gate, ticker }: { gate: GateResult; ticker: string }) {
  return (
    <Card className="p-6">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 text-center">
        <div className="rounded-full bg-accent/10 p-3 text-accent"><Lock className="h-5 w-5" aria-hidden /></div>
        <h2 className="text-base font-semibold">Daily deep-dive limit reached</h2>
        <p className="text-sm text-muted">
          The Free plan includes 3 company deep dives per day. Companies you already opened today stay available, and the
          limit resets at midnight UTC. Upgrade to unlock unlimited deep dives on {ticker} and every other company.
        </p>
        <UpgradeHint gate={gate} className="w-full" />
        <div className="flex gap-3 text-xs">
          <Link href="/dashboard" className="text-info hover:underline">Back to dashboard</Link>
          <Link href="/screener" className="text-info hover:underline">Open the screener</Link>
        </div>
      </div>
    </Card>
  );
}
