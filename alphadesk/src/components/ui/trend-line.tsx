import { cn } from '@/lib/utils';

/** Small SVG trend line with a soft fill. Works in server and client components. */
export function TrendLine({ values, width = 120, height = 36, className, label }: { values: number[]; width?: number; height?: number; className?: string; label?: string }) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return <span className={cn('block', className)} style={{ width, height }} aria-hidden />;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((c, i) => [(i / (v.length - 1)) * width, height - 2 - ((c - lo) / span) * (height - 4)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const up = v[v.length - 1] >= v[0];
  const color = up ? 'rgb(var(--up))' : 'rgb(var(--down))';
  const id = `sl-${Math.round(v[0] * 1000)}-${v.length}-${up ? 'u' : 'd'}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('block', className)} role="img" aria-label={label ? `${label}: ${up ? 'up' : 'down'} over the period` : undefined} aria-hidden={label ? undefined : true} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
