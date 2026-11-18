'use client';
import * as React from 'react';
import { Bookmark, BookmarkCheck, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SavedPreset } from '@/lib/fundamentals/defaults';

const fmtSaved = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

/** "Save my assumptions" button + "Saved · Nov 18, 10:42 PM" status. */
export function SaveAssumptionsButton({ saved, dirty, busy, onSave }: { saved: SavedPreset | null; dirty: boolean; busy: boolean; onSave: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {saved && (
        <span className="text-[11px] text-muted" aria-live="polite">
          {dirty ? <span className="font-medium text-warn">Unsaved changes · </span> : null}Saved · {fmtSaved(saved.updatedAt)}
        </span>
      )}
      <Button size="sm" variant={saved && !dirty ? 'outline' : 'default'} onClick={onSave} disabled={busy || (!!saved && !dirty)}>
        {saved && !dirty ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />}
        {busy ? 'Saving…' : saved ? (dirty ? 'Update my assumptions' : 'Saved') : 'Save my assumptions'}
      </Button>
    </div>
  );
}

/** Chip shown when the user's saved assumptions for this ticker override the defaults. */
export function SavedAssumptionsChip({ busy, onReset }: { busy: boolean; onReset: () => void }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5 rounded-full border border-info/40 bg-info/10 px-3 py-1 text-[11px]" role="status">
      <BookmarkCheck className="h-3.5 w-3.5 text-info" aria-hidden />
      <span>Using your saved assumptions</span>
      <span className="text-muted" aria-hidden>·</span>
      <button type="button" onClick={onReset} disabled={busy} className="inline-flex items-center gap-1 font-medium text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:opacity-50">
        <RotateCcw className="h-3 w-3" aria-hidden /> Reset to defaults
      </button>
    </div>
  );
}
