'use client';
import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RightRailState { title: string; content: React.ReactNode; key?: string }
interface RightRailApi {
  state: RightRailState | null;
  isOpen: boolean;
  /** open (or replace) rail content. `key` lets a page detect whether its content is showing. */
  open: (s: RightRailState) => void;
  close: () => void;
  toggle: (s: RightRailState) => void;
}

const Ctx = React.createContext<RightRailApi | null>(null);

export function RightRailProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<RightRailState | null>(null);
  const api = React.useMemo<RightRailApi>(
    () => ({
      state,
      isOpen: !!state,
      open: (s) => setState(s),
      close: () => setState(null),
      toggle: (s) => setState((cur) => (cur && cur.key && cur.key === s.key ? null : s)),
    }),
    [state],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** useRightRail().open({ title: 'Sources', content: <...> }) — push citations/context to the right column. */
export function useRightRail(): RightRailApi {
  const c = React.useContext(Ctx);
  if (!c) {
    // Outside the app shell (e.g. public share page): no-op API so components still render.
    return { state: null, isOpen: false, open: () => {}, close: () => {}, toggle: () => {} };
  }
  return c;
}

/** The rail itself (rendered by the app layout). Hidden when empty; overlay sheet on < xl screens. */
export function RightRail() {
  const { state, close } = useRightRail();
  React.useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, close]);
  if (!state) return null;
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40 xl:hidden" onClick={close} aria-hidden />
      <aside
        aria-label={state.title}
        className={cn('fixed inset-y-0 right-0 z-40 flex w-[min(380px,100vw)] flex-col border-l border-border bg-panel shadow-2xl xl:sticky xl:top-0 xl:z-0 xl:h-screen xl:w-[340px] xl:shrink-0 xl:shadow-none')}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-5">
          <h2 className="text-sm font-semibold">{state.title}</h2>
          <button onClick={close} className="rounded p-1 text-muted hover:bg-panel-2 hover:text-text" aria-label="Close context panel">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">{state.content}</div>
      </aside>
    </>
  );
}
