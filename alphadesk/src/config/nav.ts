import type { Feature } from '@/lib/plans';
import { Building2, CalendarDays, FlaskConical, LayoutDashboard, Settings, SlidersHorizontal, Star, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** shown in mobile bottom tab bar */
  mobile?: boolean;
  /** 'g x' navigation shortcut */
  shortcut?: string;
  /** only shown to the owner (Settings) */
  ownerOnly?: boolean;
  /** additional path prefixes that mark this item active */
  match?: string[];
  /** plan feature required; locked items show a Pro chip and open the upgrade dialog */
  feature?: Feature;
}

/** Portfolios, Baskets and Shared are hidden from navigation (routes still work by URL). */
export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, mobile: true, shortcut: 'g d' },
  { href: '/research', label: 'Research', icon: FlaskConical, mobile: true, shortcut: 'g r', feature: 'ai' },
  { href: '/company/NVDA', label: 'Company', icon: Building2, match: ['/company'] },
  { href: '/watchlist', label: 'Watchlist', icon: Star, mobile: true, shortcut: 'g w' },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays, shortcut: 'g c' },
  { href: '/screener', label: 'Screener', icon: SlidersHorizontal, mobile: true, shortcut: 'g s' },
  { href: '/settings', label: 'Settings', icon: Settings, mobile: true, shortcut: 'g ,', ownerOnly: true },
];

export function isActive(item: NavItem, pathname: string): boolean {
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** Navigation items visible to this user (Settings only for the owner). */
export function visibleNav(canSettings: boolean | undefined): NavItem[] {
  return NAV.filter((n) => !n.ownerOnly || canSettings);
}
