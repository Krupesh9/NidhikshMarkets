'use client';
import * as React from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuGroup = DM.Group;
export const DropdownMenuSub = DM.Sub;
export const DropdownMenuRadioGroup = DM.RadioGroup;

export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof DM.Content>, React.ComponentPropsWithoutRef<typeof DM.Content>>(({ className, sideOffset = 6, ...p }, ref) => (
  <DM.Portal>
    <DM.Content ref={ref} sideOffset={sideOffset} className={cn('z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-panel p-1 text-sm shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95', className)} {...p} />
  </DM.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof DM.Item>, React.ComponentPropsWithoutRef<typeof DM.Item> & { inset?: boolean }>(({ className, inset, ...p }, ref) => (
  <DM.Item ref={ref} className={cn('relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-panel-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4', inset && 'pl-8', className)} {...p} />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuCheckboxItem = React.forwardRef<React.ElementRef<typeof DM.CheckboxItem>, React.ComponentPropsWithoutRef<typeof DM.CheckboxItem>>(({ className, children, ...p }, ref) => (
  <DM.CheckboxItem ref={ref} className={cn('relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 outline-none focus:bg-panel-2', className)} {...p}>
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"><DM.ItemIndicator><Check className="h-4 w-4" /></DM.ItemIndicator></span>
    {children}
  </DM.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

export const DropdownMenuRadioItem = React.forwardRef<React.ElementRef<typeof DM.RadioItem>, React.ComponentPropsWithoutRef<typeof DM.RadioItem>>(({ className, children, ...p }, ref) => (
  <DM.RadioItem ref={ref} className={cn('relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 outline-none focus:bg-panel-2', className)} {...p}>
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"><DM.ItemIndicator><Check className="h-4 w-4" /></DM.ItemIndicator></span>
    {children}
  </DM.RadioItem>
));
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';

export const DropdownMenuLabel = React.forwardRef<React.ElementRef<typeof DM.Label>, React.ComponentPropsWithoutRef<typeof DM.Label>>(({ className, ...p }, ref) => (
  <DM.Label ref={ref} className={cn('px-2 py-1.5 text-xs font-medium text-muted', className)} {...p} />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';
export const DropdownMenuSeparator = React.forwardRef<React.ElementRef<typeof DM.Separator>, React.ComponentPropsWithoutRef<typeof DM.Separator>>(({ className, ...p }, ref) => (
  <DM.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...p} />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';
