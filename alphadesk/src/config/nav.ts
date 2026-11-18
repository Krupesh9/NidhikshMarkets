import { Building2, CalendarDays, FlaskConical, LayoutDashboard, Settings, SlidersHorizontal, Star, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** shown in mobile bottom tab bar */
  mobile?: boolean;
  /** 'g x' navigation shortcut */
  shortcut?: string;
  /** additional path prefixes that mark this item active */
  match?: string[];
}

/** Portfolios, Baskets and Shared are hidden from navigation (routes still work by URL). */
export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, mobile: true, shortcut: 'g d' },
  { href: '/research', label: 'Research', icon: FlaskConical, mobile: true, shortcut: 'g r' },
  { href: '/company/NVDA', label: 'Company', icon: Building2, match: ['/company'] },
  { href: '/watchlist', label: 'Watchlist', icon: Star, mobile: true, shortcut: 'g w' },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays, shortcut: 'g c' },
  { href: '/screener', label: 'Screener', icon: SlidersHorizontal, mobile: true, shortcut: 'g s' },
  { href: '/settings', label: 'Settings', icon: Settings, mobile: true, shortcut: 'g ,' },
];

export function isActive(item: NavItem, pathname: string): boolean {
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
