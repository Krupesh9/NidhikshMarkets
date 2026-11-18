'use client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { SHORTCUTS } from '@/lib/shortcuts';

export function ShortcutOverlay({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const groups = Array.from(new Set(SHORTCUTS.map((s) => s.group)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press <Kbd>?</Kbd> anytime to show this list.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g}>
              <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{g}</h3>
              <ul className="space-y-1">
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-sm">
                    <span>{s.label}</span>
                    <span className="flex gap-1">{s.keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
