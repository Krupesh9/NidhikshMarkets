'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActive, visibleNav } from '@/config/nav';
import { cn } from '@/lib/utils';
import { hasFeature } from '@/lib/plans';
import { ProChip, useUpgrade } from '@/components/billing/UpgradeDialog';
import { useCurrentUser } from './UserContext';

export function MobileTabBar() {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const { openUpgrade } = useUpgrade();
  return (
    <nav aria-label="Primary mobile" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {visibleNav(user.canSettings).filter((n) => n.mobile).map((n) => {
        const active = isActive(n, pathname);
        const locked = !!n.feature && !hasFeature(user, n.feature);
        return (
          <Link key={n.href} href={n.href} onClick={locked ? (e) => { e.preventDefault(); openUpgrade(n.feature); } : undefined} aria-current={active ? 'page' : undefined} className={cn('flex flex-col items-center gap-0.5 py-2 text-[10px]', active ? 'text-accent' : 'text-muted')}>
            <n.icon className="h-5 w-5" aria-hidden />
            <span className="inline-flex items-center gap-0.5">{n.label}{locked && <ProChip className="px-0.5" />}</span>
          </Link>
        );
      })}
    </nav>
  );
}
