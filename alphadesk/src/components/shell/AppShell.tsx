'use client';
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toast';
import { ChatPanel } from '@/components/ai/ChatPanel';
import { NAV } from '@/config/nav';
import { useShortcut } from '@/lib/shortcuts';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { RightRail, RightRailProvider } from './RightRail';
import { CommandMenu } from './CommandMenu';
import { ShortcutOverlay } from './ShortcutOverlay';
import { MobileTabBar } from './MobileTabBar';
import { UserProvider, type ClientUsage, type ClientUser, type DataMode } from './UserContext';

interface ShellUI { openChat: () => void; openSearch: () => void; chatOpen: boolean }
const ShellCtx = React.createContext<ShellUI>({ openChat: () => {}, openSearch: () => {}, chatOpen: false });
/** Open the global chat or search from any page: const { openChat } = useShell(); */
export const useShell = () => React.useContext(ShellCtx);

function NavShortcut({ combo, href }: { combo: string; href: string }) {
  const router = useRouter();
  useShortcut(combo, () => router.push(href));
  return null;
}

export function AppShell({ user, usage, dataMode, children }: {
  user: ClientUser; usage: ClientUsage; dataMode: DataMode; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  React.useEffect(() => {
    try { setCollapsed(localStorage.getItem('nd.sidebar') === '1'); } catch { /* ignore */ }
  }, []);
  const toggleSidebar = React.useCallback(() => {
    setCollapsed((c) => {
      try { localStorage.setItem('nd.sidebar', c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  }, []);

  useShortcut('mod+k', () => setSearchOpen((o) => !o), { allowInInputs: true });
  useShortcut('mod+j', () => setChatOpen((o) => !o), { allowInInputs: true });
  useShortcut('mod+b', toggleSidebar, { allowInInputs: true });
  useShortcut('?', () => setHelpOpen(true));

  const value = React.useMemo(() => ({ user, usage, dataMode }), [user, usage, dataMode]);
  const shell = React.useMemo(() => ({ openChat: () => setChatOpen(true), openSearch: () => setSearchOpen(true), chatOpen }), [chatOpen]);

  return (
    <UserProvider value={value}>
      <ShellCtx.Provider value={shell}>
        <TooltipProvider delayDuration={250}>
          <RightRailProvider>
            <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[200] focus:rounded focus:bg-info focus:px-3 focus:py-1 focus:text-white">Skip to content</a>
            <div className="flex min-h-screen">
              {/* On /watchlist the watchlist pane acts as the left navigation, so the main nav shrinks to an icon rail. */}
              <Sidebar collapsed={collapsed || pathname.startsWith('/watchlist')} locked={pathname.startsWith('/watchlist')} onToggle={toggleSidebar} />
              <div className="flex min-w-0 flex-1 flex-col">
                <Topbar onSearch={() => setSearchOpen(true)} onChat={() => setChatOpen(true)} onShortcuts={() => setHelpOpen(true)} />
                <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-12 md:pt-8">
                  <div key={pathname.split('/').slice(0, 2).join('/')} className="page-enter mx-auto w-full max-w-[1440px]">{children}</div>
                </main>
              </div>
              <RightRail />
            </div>
            <MobileTabBar />
            <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />
            <ShortcutOverlay open={helpOpen} onOpenChange={setHelpOpen} />
            <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
            {NAV.filter((n) => n.shortcut).map((n) => <NavShortcut key={n.href} combo={n.shortcut!} href={n.href} />)}
            <Toaster />
          </RightRailProvider>
        </TooltipProvider>
      </ShellCtx.Provider>
    </UserProvider>
  );
}
