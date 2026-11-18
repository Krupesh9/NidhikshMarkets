'use client';
import * as React from 'react';
import { ListRestart, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { MAX_GROUP_LEN, MAX_LIST } from '@/lib/screener/list';

interface Props {
  count: number;
  isDefault: boolean;
  dirty: boolean;
  /** existing group names, offered as suggestions */
  groupNames: string[];
  /** returns an error/info message for the input, or null when everything was added */
  onAdd: (input: string, group: string) => string | null;
  onReset: () => void;
  className?: string;
}

/** "Add ticker" bar for the screener list: Enter adds one or many (comma/space separated), optional group. */
export function ListEditor({ count, isDefault, dirty, groupNames, onAdd, onReset, className }: Props) {
  const [value, setValue] = React.useState('');
  const [group, setGroup] = React.useState('');
  const [msg, setMsg] = React.useState<string | null>(null);
  const listId = React.useId();

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!value.trim()) return;
    const m = onAdd(value, group.trim());
    setMsg(m);
    setValue('');
  };

  return (
    <form onSubmit={submit} className={cn('flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2', className)} aria-label="Edit ticker list">
      <div className="flex items-baseline gap-1.5 text-xs">
        <span className="font-medium text-text">List</span>
        <span className="font-mono text-muted">{count}/{MAX_LIST}</span>
        <span className="text-muted">· {isDefault ? 'default (your watchlist)' : 'custom'}</span>
        {dirty && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent" role="status">Unsaved changes</span>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <Input
          value={value}
          onChange={(e) => { setValue(e.target.value.toUpperCase()); if (msg) setMsg(null); }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (/[\s,;]/.test(text.trim())) { e.preventDefault(); setMsg(onAdd(text, group.trim())); }
          }}
          placeholder="Add ticker(s): PLTR, AMD…"
          aria-label="Add ticker — press Enter; paste several separated by commas or spaces"
          className="h-7 w-48 font-mono text-xs"
          maxLength={400}
        />
        <Input
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="Group (optional)"
          aria-label="Group for added tickers (optional)"
          list={listId}
          className="h-7 w-36 text-xs"
          maxLength={MAX_GROUP_LEN}
        />
        <datalist id={listId}>{groupNames.map((g) => <option key={g} value={g} />)}</datalist>
        <Button type="submit" size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={!value.trim()}><Plus aria-hidden /> Add</Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { onReset(); setMsg(null); }} disabled={isDefault} title="Replace this list with your default list (watchlist)">
          <ListRestart aria-hidden /> Reset to default list
        </Button>
      </div>
      {msg && <p className="w-full text-[11px] text-warn" role="status">{msg}</p>}
    </form>
  );
}
