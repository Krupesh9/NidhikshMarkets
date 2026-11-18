'use client';
import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'default' | 'success' | 'error' | 'info';
export interface ToastInput { title: string; description?: string; variant?: ToastVariant; durationMs?: number; action?: { label: string; onClick: () => void } }
interface ToastItem extends ToastInput { id: number }

let listeners: ((t: ToastItem[]) => void)[] = [];
let items: ToastItem[] = [];
let seq = 0;
const emit = () => listeners.forEach((l) => l(items));

/** Imperative toast: toast({ title: 'Saved', variant: 'success' }) — call from any client component. */
export function toast(t: ToastInput) {
  const item = { ...t, id: ++seq };
  items = [...items, item].slice(-4);
  emit();
  return item.id;
}
export function dismissToast(id: number) {
  items = items.filter((x) => x.id !== id);
  emit();
}
export function useToast() {
  return { toast, dismiss: dismissToast };
}

const border: Record<ToastVariant, string> = { default: 'border-border', success: 'border-up/50', error: 'border-down/50', info: 'border-info/50' };

export function Toaster() {
  const [list, setList] = React.useState<ToastItem[]>([]);
  React.useEffect(() => {
    listeners.push(setList);
    return () => { listeners = listeners.filter((l) => l !== setList); };
  }, []);
  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {list.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          duration={t.durationMs ?? 4000}
          onOpenChange={(o) => !o && dismissToast(t.id)}
          className={cn('pointer-events-auto relative flex w-full items-start gap-3 rounded-md border bg-panel p-3 pr-8 shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0', border[t.variant ?? 'default'])}
        >
          <div className="grid gap-0.5">
            <ToastPrimitive.Title className="text-sm font-medium">{t.title}</ToastPrimitive.Title>
            {t.description && <ToastPrimitive.Description className="text-xs text-muted">{t.description}</ToastPrimitive.Description>}
          </div>
          {t.action && (
            <ToastPrimitive.Action altText={t.action.label} onClick={t.action.onClick} className="ml-auto rounded border border-border px-2 py-1 text-xs hover:bg-panel-2">
              {t.action.label}
            </ToastPrimitive.Action>
          )}
          <ToastPrimitive.Close className="absolute right-2 top-2 text-muted hover:text-text" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-16 right-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none md:bottom-4" />
    </ToastPrimitive.Provider>
  );
}
