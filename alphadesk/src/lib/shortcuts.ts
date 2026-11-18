'use client';
import { useEffect, useRef } from 'react';

/** Global keyboard shortcut registry (shown in the `?` overlay). Add entries here; bind with useShortcut(). */
export interface Shortcut { id: string; keys: string[]; label: string; group: 'Global' | 'Navigation' | 'Page' }

export const SHORTCUTS: Shortcut[] = [
  { id: 'search', keys: ['⌘', 'K'], label: 'Search tickers & commands', group: 'Global' },
  { id: 'chat', keys: ['⌘', 'J'], label: 'Toggle AI research chat', group: 'Global' },
  { id: 'help', keys: ['?'], label: 'Show keyboard shortcuts', group: 'Global' },
  { id: 'sidebar', keys: ['⌘', 'B'], label: 'Collapse / expand sidebar', group: 'Global' },
  { id: 'rail', keys: ['Esc'], label: 'Close panels / right rail', group: 'Global' },
  { id: 'go-dashboard', keys: ['G', 'D'], label: 'Go to Dashboard', group: 'Navigation' },
  { id: 'go-research', keys: ['G', 'R'], label: 'Go to Research', group: 'Navigation' },
  { id: 'go-screener', keys: ['G', 'S'], label: 'Go to Screener', group: 'Navigation' },
  { id: 'go-portfolios', keys: ['G', 'P'], label: 'Go to Portfolios', group: 'Navigation' },
  { id: 'go-baskets', keys: ['G', 'B'], label: 'Go to Baskets', group: 'Navigation' },
  { id: 'go-shared', keys: ['G', 'H'], label: 'Go to Shared', group: 'Navigation' },
  { id: 'go-settings', keys: ['G', ','], label: 'Go to Settings', group: 'Navigation' },
];

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Bind a shortcut. combo examples: 'mod+k' (⌘ on mac / Ctrl elsewhere), 'shift+/', '?', 'escape', 'g d' (sequence).
 * Ignored while typing in inputs unless `allowInInputs`.
 */
export function useShortcut(combo: string, handler: (e: KeyboardEvent) => void, opts: { allowInInputs?: boolean; enabled?: boolean } = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (opts.enabled === false) return;
    const seq = combo.toLowerCase().split(' ');
    let idx = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const matches = (part: string, e: KeyboardEvent) => {
      const keys = part.split('+');
      const key = keys[keys.length - 1];
      const mod = keys.includes('mod');
      const shift = keys.includes('shift');
      if (mod !== (e.metaKey || e.ctrlKey)) return false;
      if (keys.includes('shift') && !e.shiftKey) return false;
      if (!shift && key.length > 1 && e.shiftKey && key !== '?') return false;
      return e.key.toLowerCase() === key;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!opts.allowInInputs && isTypingTarget(e.target) && !combo.includes('mod+') && combo !== 'escape') return;
      if (matches(seq[idx], e)) {
        idx++;
        if (idx === seq.length) {
          idx = 0;
          e.preventDefault();
          ref.current(e);
        } else {
          clearTimeout(timer);
          timer = setTimeout(() => (idx = 0), 900);
        }
      } else {
        idx = matches(seq[0], e) ? 1 : 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer); };
  }, [combo, opts.allowInInputs, opts.enabled]);
}
