import { Briefcase, Building2, FlaskConical, LayoutDashboard, Layers, Settings, Share2, SlidersHorizontal, type LucideIcon } from 'lucide-react';

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

export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, mobile: true, shortcut: 'g d' },
  { href: '/research', label: 'Research', icon: FlaskConical, mobile: true, shortcut: 'g r' },
  { href: '/company/NVDA', label: 'Company', icon: Building2, match: ['/company'] },
  { href: '/screener', label: 'Screener', icon: SlidersHorizontal, mobile: true, shortcut: 'g s' },
  { href: '/portfolios', label: 'Portfolios', icon: Briefcase, mobile: true, shortcut: 'g p' },
  { href: '/baskets', label: 'Baskets', icon: Layers, shortcut: 'g b' },
  { href: '/shared', label: 'Shared', icon: Share2, mobile: true, shortcut: 'g h' },
  { href: '/settings', label: 'Settings', icon: Settings, shortcut: 'g ,' },
];

export function isActive(item: NavItem, pathname: string): boolean {
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
