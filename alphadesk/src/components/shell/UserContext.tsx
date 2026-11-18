'use client';
import * as React from 'react';
import type { Plan, Role } from '@/lib/plans';

export interface ClientUser { id: string; orgId: string; email: string; name: string; role: Role; plan: Plan; image?: string | null }
export interface ClientUsage { period: string; aiQueries: number; deepDivesToday: number }
export interface DataMode { label: string; isMock: boolean; providers: string[] }

interface Ctx { user: ClientUser; usage: ClientUsage; dataMode: DataMode; refresh: () => void }
const UserCtx = React.createContext<Ctx | null>(null);

export function UserProvider({ value, children }: { value: Omit<Ctx, 'refresh'>; children: React.ReactNode }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  const refresh = React.useCallback(async () => {
    try {
      const r = await fetch('/api/me', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setV((cur) => ({ ...cur, user: j.user, usage: j.usage }));
      }
    } catch { /* ignore */ }
  }, []);
  return <UserCtx.Provider value={{ ...v, refresh }}>{children}</UserCtx.Provider>;
}

/** Current user/plan/usage on the client. `refresh()` after plan toggle or AI query to update the meter. */
export function useCurrentUser(): Ctx {
  const c = React.useContext(UserCtx);
  if (!c) throw new Error('useCurrentUser must be used inside the (app) layout');
  return c;
}
