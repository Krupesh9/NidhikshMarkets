import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Colored % (or absolute) change with arrow + screen-reader text. */
export function Delta({ value, suffix = '%', dp = 2, className, showArrow = true, invert = false }: { value: number | null | undefined; suffix?: string; dp?: number; className?: string; showArrow?: boolean; invert?: boolean }) {
  if (value == null || !isFinite(value)) return <span className={cn('font-mono tabular-nums text-muted', className)}>—</span>;
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 10 ** -dp / 2;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-mono tabular-nums', flat ? 'text-muted' : good ? 'text-up' : 'text-down', className)}>
      {showArrow && <Icon className="h-3.5 w-3.5" aria-hidden />}
      <span aria-hidden>{`${value > 0 ? '+' : ''}${value.toFixed(dp)}${suffix}`}</span>
      <span className="sr-only">{flat ? 'unchanged' : `${value > 0 ? 'up' : 'down'} ${Math.abs(value).toFixed(dp)}${suffix === '%' ? ' percent' : suffix}`}</span>
    </span>
  );
}
