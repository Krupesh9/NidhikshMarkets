'use client';
import * as React from 'react';
import * as SA from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/utils';

export const ScrollArea = React.forwardRef<React.ElementRef<typeof SA.Root>, React.ComponentPropsWithoutRef<typeof SA.Root>>(({ className, children, ...p }, ref) => (
  <SA.Root ref={ref} className={cn('relative overflow-hidden', className)} {...p}>
    <SA.Viewport className="h-full w-full rounded-[inherit]">{children}</SA.Viewport>
    <ScrollBar />
    <SA.Corner />
  </SA.Root>
));
ScrollArea.displayName = 'ScrollArea';

export const ScrollBar = React.forwardRef<React.ElementRef<typeof SA.ScrollAreaScrollbar>, React.ComponentPropsWithoutRef<typeof SA.ScrollAreaScrollbar>>(({ className, orientation = 'vertical', ...p }, ref) => (
  <SA.ScrollAreaScrollbar ref={ref} orientation={orientation} className={cn('flex touch-none select-none transition-colors', orientation === 'vertical' ? 'h-full w-2 border-l border-l-transparent p-px' : 'h-2 flex-col border-t border-t-transparent p-px', className)} {...p}>
    <SA.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </SA.ScrollAreaScrollbar>
));
ScrollBar.displayName = 'ScrollBar';
