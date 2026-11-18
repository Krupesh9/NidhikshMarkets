'use client';
import Link from 'next/link';
import { Sparkles, SlidersHorizontal, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { useShell } from '@/components/shell/AppShell';
import { useCurrentUser } from '@/components/shell/UserContext';
import { assertFeature } from '@/lib/plans';

export function QuickActions() {
  const { openChat } = useShell();
  const { user } = useCurrentUser();
  const ai = assertFeature(user, 'ai');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={openChat} title={ai.allowed ? 'Ask the AI research assistant' : ai.reason}>
        <Sparkles aria-hidden /> Ask AI <Kbd className="ml-1 hidden sm:inline-flex">⌘J</Kbd>
      </Button>
      <Button asChild size="sm" variant="secondary"><Link href="/screener"><SlidersHorizontal aria-hidden /> New screen</Link></Button>
      <Button asChild size="sm" variant="secondary"><Link href="/portfolios?import=1"><Upload aria-hidden /> Import portfolio</Link></Button>
    </div>
  );
}
