'use client';
import * as React from 'react';
import { Bot } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Global AI research chat slide-over. STUB — Agent B replaces the internals.
 * Keep the export name and props: ChatPanel({ open, onOpenChange }).
 */
export function ChatPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Bot className="h-4 w-4 text-accent" /> AI research</SheetTitle>
          <SheetDescription>Ask about any company, screen or portfolio. Answers cite sources. Research only — not investment advice.</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <EmptyState icon={Bot} title="Research chat is coming online" description="The AI research assistant is being wired up. Try the Research page in the meantime." />
        </div>
      </SheetContent>
    </Sheet>
  );
}
