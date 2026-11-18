'use client';
import * as React from 'react';
import * as S from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Select = S.Root;
export const SelectGroup = S.Group;
export const SelectValue = S.Value;

export const SelectTrigger = React.forwardRef<React.ElementRef<typeof S.Trigger>, React.ComponentPropsWithoutRef<typeof S.Trigger>>(({ className, children, ...p }, ref) => (
  <S.Trigger ref={ref} className={cn('flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-panel-2 px-3 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:opacity-50 [&>span]:truncate', className)} {...p}>
    {children}
    <S.Icon asChild><ChevronDown className="h-4 w-4 text-muted" /></S.Icon>
  </S.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = React.forwardRef<React.ElementRef<typeof S.Content>, React.ComponentPropsWithoutRef<typeof S.Content>>(({ className, children, position = 'popper', ...p }, ref) => (
  <S.Portal>
    <S.Content ref={ref} position={position} className={cn('relative z-50 max-h-80 min-w-[8rem] overflow-hidden rounded-md border border-border bg-panel shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0', position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)] translate-y-1', className)} {...p}>
      <S.Viewport className="p-1">{children}</S.Viewport>
    </S.Content>
  </S.Portal>
));
SelectContent.displayName = 'SelectContent';

export const SelectItem = React.forwardRef<React.ElementRef<typeof S.Item>, React.ComponentPropsWithoutRef<typeof S.Item>>(({ className, children, ...p }, ref) => (
  <S.Item ref={ref} className={cn('relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-panel-2 data-[disabled]:opacity-50', className)} {...p}>
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"><S.ItemIndicator><Check className="h-4 w-4" /></S.ItemIndicator></span>
    <S.ItemText>{children}</S.ItemText>
  </S.Item>
));
SelectItem.displayName = 'SelectItem';
export const SelectLabel = React.forwardRef<React.ElementRef<typeof S.Label>, React.ComponentPropsWithoutRef<typeof S.Label>>(({ className, ...p }, ref) => (
  <S.Label ref={ref} className={cn('px-2 py-1.5 text-xs text-muted', className)} {...p} />
));
SelectLabel.displayName = 'SelectLabel';
