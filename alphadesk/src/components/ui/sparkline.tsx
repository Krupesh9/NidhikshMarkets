import { cn } from '@/lib/utils';

/** Tiny inline SVG sparkline. Color follows first→last direction unless `color` given. */
export function Sparkline({ data, width = 80, height = 24, className, color, strokeWidth = 1.5, label }: { data: number[]; width?: number; height?: number; className?: string; color?: 'up' | 'down' | 'muted' | 'info' | 'accent'; strokeWidth?: number; label?: string }) {
  if (!data || data.length < 2) return <svg width={width} height={height} className={className} aria-hidden />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 1 - ((v - min) / span) * (height - 2)).toFixed(1)}`).join(' ');
  const dir = color ?? (data[data.length - 1] >= data[0] ? 'up' : 'down');
  const stroke = { up: 'rgb(var(--up))', down: 'rgb(var(--down))', muted: 'rgb(var(--muted))', info: 'rgb(var(--info))', accent: 'rgb(var(--accent))' }[dir];
  const pct = ((data[data.length - 1] - data[0]) / Math.abs(data[0] || 1)) * 100;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('overflow-visible', className)} role="img" aria-label={label ?? `Trend ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(1)} percent`}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
