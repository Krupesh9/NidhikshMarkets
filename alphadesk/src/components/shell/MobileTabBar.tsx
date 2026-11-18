'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV, isActive } from '@/config/nav';
import { cn } from '@/lib/utils';

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary mobile" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {NAV.filter((n) => n.mobile).map((n) => {
        const active = isActive(n, pathname);
        return (
          <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={cn('flex flex-col items-center gap-0.5 py-2 text-[10px]', active ? 'text-accent' : 'text-muted')}>
            <n.icon className="h-5 w-5" aria-hidden />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
