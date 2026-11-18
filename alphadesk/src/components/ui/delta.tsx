import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Colored % (or absolute) change with arrow + screen-reader text.
 * `badge` renders a solid green/red pill with white text (Apple Stocks style) for list and header use.
 */
export function Delta({ value, suffix = '%', dp = 2, className, showArrow = true, invert = false, badge = false, amount, amountSuffix = '', amountDp = 2 }: { value: number | null | undefined; suffix?: string; dp?: number; className?: string; showArrow?: boolean; invert?: boolean; badge?: boolean; /** absolute change shown before the % inside the badge */ amount?: number | null; amountSuffix?: string; amountDp?: number }) {
  if (value == null || !isFinite(value)) return <span className={cn('font-mono tabular-nums text-muted', className)}>—</span>;
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 10 ** -dp / 2;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const pill = cn('inline-flex min-w-[4.75rem] items-center justify-end whitespace-nowrap rounded-md px-2 py-0.5 font-mono text-[13px] font-semibold tabular-nums text-white shadow-sm transition-colors',
    flat ? 'bg-muted/40' : good ? 'bg-up/90' : 'bg-down/90');
  const sr = <span className="sr-only">{flat ? 'unchanged' : `${value > 0 ? 'up' : 'down'} ${amount != null && isFinite(amount) ? `${Math.abs(amount).toFixed(amountDp)}${amountSuffix}, ` : ''}${Math.abs(value).toFixed(dp)}${suffix === '%' ? ' percent' : suffix}`}</span>;
  if (badge && amount != null && isFinite(amount)) {
    // Price change in the colored badge, percent beside it as colored text.
    return (
      <span className={cn('inline-flex items-center justify-end gap-2 whitespace-nowrap', className)}>
        <span aria-hidden className={cn(pill, 'min-w-[4rem]')}>{`${amount > 0 ? '+' : amount < 0 ? '−' : ''}${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: amountDp, maximumFractionDigits: amountDp })}${amountSuffix}`}</span>
        <span aria-hidden className={cn('min-w-[3.75rem] text-right font-mono font-semibold tabular-nums', flat ? 'text-muted' : good ? 'text-up' : 'text-down')}>{`${value > 0 ? '+' : ''}${value.toFixed(dp)}${suffix}`}</span>
        {sr}
      </span>
    );
  }
  if (badge) {
    return (
      <span className={cn(pill, className)}>
        <span aria-hidden>{`${value > 0 ? '+' : ''}${value.toFixed(dp)}${suffix}`}</span>
        {sr}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-mono tabular-nums', flat ? 'text-muted' : good ? 'text-up' : 'text-down', className)}>
      {showArrow && <Icon className="h-3.5 w-3.5" aria-hidden />}
      <span aria-hidden>{`${value > 0 ? '+' : ''}${value.toFixed(dp)}${suffix}`}</span>
      <span className="sr-only">{flat ? 'unchanged' : `${value > 0 ? 'up' : 'down'} ${Math.abs(value).toFixed(dp)}${suffix === '%' ? ' percent' : suffix}`}</span>
    </span>
  );
}
