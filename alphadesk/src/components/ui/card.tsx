import * as React from 'react';
import { cn } from '@/lib/utils';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...p }, ref) => (
  <div ref={ref} className={cn('rounded-xl border border-border bg-panel text-text shadow-sm shadow-black/10', className)} {...p} />
));
Card.displayName = 'Card';
export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...p }, ref) => (
  <div ref={ref} className={cn('flex flex-col gap-1 px-5 pb-3 pt-5', className)} {...p} />
));
CardHeader.displayName = 'CardHeader';
export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...p }, ref) => (
  <h3 ref={ref} className={cn('text-[15px] font-semibold tracking-tight', className)} {...p} />
));
CardTitle.displayName = 'CardTitle';
export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(({ className, ...p }, ref) => (
  <p ref={ref} className={cn('text-xs text-muted', className)} {...p} />
));
CardDescription.displayName = 'CardDescription';
export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...p }, ref) => (
  <div ref={ref} className={cn('px-5 pb-5 pt-1', className)} {...p} />
));
CardContent.displayName = 'CardContent';
export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...p }, ref) => (
  <div ref={ref} className={cn('flex items-center gap-2 border-t border-border px-5 py-3.5', className)} {...p} />
));
CardFooter.displayName = 'CardFooter';
