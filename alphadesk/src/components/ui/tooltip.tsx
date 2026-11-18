'use client';
import * as React from 'react';
import * as T from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

export const TooltipProvider = T.Provider;
export const Tooltip = T.Root;
export const TooltipTrigger = T.Trigger;
export const TooltipContent = React.forwardRef<React.ElementRef<typeof T.Content>, React.ComponentPropsWithoutRef<typeof T.Content>>(({ className, sideOffset = 6, ...p }, ref) => (
  <T.Portal>
    <T.Content ref={ref} sideOffset={sideOffset} className={cn('z-50 max-w-xs rounded-md border border-border bg-panel-2 px-2 py-1 text-xs text-text shadow-lg data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0', className)} {...p} />
  </T.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/** Convenience: <Tip content="...">child</Tip> */
export function Tip({ content, children, side }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}
