/** Keyboard UX: the `?` overlay registry must stay in sync with what the shell actually binds. */
import { describe, expect, it } from 'vitest';
import { SHORTCUTS, isTypingTarget } from '@/lib/shortcuts';
import { NAV } from '@/config/nav';

describe('shortcut registry', () => {
  it('has unique ids', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });

  it('documents the global shortcuts bound in AppShell (⌘K, ⌘J, ⌘B, ?, Esc)', () => {
    const keys = SHORTCUTS.filter((s) => s.group === 'Global').map((s) => s.keys.join('+'));
    expect(keys).toEqual(expect.arrayContaining(['⌘+K', '⌘+J', '⌘+B', '?', 'Esc']));
  });

  it('every nav item with a `g x` shortcut appears in the overlay with the same keys', () => {
    for (const item of NAV.filter((n) => n.shortcut)) {
      const keys = item.shortcut!.split(' ').map((k) => k.toUpperCase());
      const entry = SHORTCUTS.find((s) => s.group === 'Navigation' && s.keys.join(' ') === keys.join(' '));
      expect(entry, `${item.label} (${item.shortcut})`).toBeDefined();
      expect(entry!.label).toContain(item.label);
    }
  });

  it('no two navigation shortcuts collide', () => {
    const seqs = SHORTCUTS.filter((s) => s.group === 'Navigation').map((s) => s.keys.join(' '));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('isTypingTarget recognises inputs and contenteditable', () => {
    const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
    expect(isTypingTarget(el('DIV', true))).toBe(true);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
