import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-none border', {
  variants: {
    variant: {
      default: 'border-border bg-panel-2 text-text',
      accent: 'border-accent/40 bg-accent/15 text-accent',
      info: 'border-info/40 bg-info/15 text-info',
      up: 'border-up/40 bg-up/15 text-up',
      down: 'border-down/40 bg-down/15 text-down',
      warn: 'border-warn/40 bg-warn/15 text-warn',
      outline: 'border-border text-muted bg-transparent',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}
export function Badge({ className, variant, ...p }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...p} />;
}
