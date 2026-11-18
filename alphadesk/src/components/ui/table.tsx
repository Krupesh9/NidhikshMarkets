import * as React from 'react';
import { cn } from '@/lib/utils';

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(({ className, ...p }, ref) => (
  <div className="relative w-full overflow-auto scrollbar-thin">
    <table ref={ref} className={cn('w-full caption-bottom border-collapse text-sm', className)} {...p} />
  </div>
));
Table.displayName = 'Table';
export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...p }, ref) => (
  <thead ref={ref} className={cn('sticky top-0 z-10 bg-panel [&_tr]:border-b', className)} {...p} />
));
TableHeader.displayName = 'TableHeader';
export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...p }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...p} />
));
TableBody.displayName = 'TableBody';
export const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...p }, ref) => (
  <tfoot ref={ref} className={cn('border-t bg-panel-2 font-medium', className)} {...p} />
));
TableFooter.displayName = 'TableFooter';
export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(({ className, ...p }, ref) => (
  <tr ref={ref} className={cn('border-b border-border transition-colors hover:bg-panel-2/60 data-[state=selected]:bg-panel-2', className)} {...p} />
));
TableRow.displayName = 'TableRow';
export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }>(({ className, numeric, ...p }, ref) => (
  <th ref={ref} className={cn('h-8 whitespace-nowrap px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wide text-muted', numeric && 'text-right', className)} {...p} />
));
TableHead.displayName = 'TableHead';
export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }>(({ className, numeric, ...p }, ref) => (
  <td ref={ref} className={cn('whitespace-nowrap px-2 py-1.5 align-middle', numeric && 'text-right font-mono tabular-nums', className)} {...p} />
));
TableCell.displayName = 'TableCell';
export const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(({ className, ...p }, ref) => (
  <caption ref={ref} className={cn('mt-3 text-xs text-muted', className)} {...p} />
));
TableCaption.displayName = 'TableCaption';
