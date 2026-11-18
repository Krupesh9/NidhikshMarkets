import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { canAccessSettings } from '@/lib/owner';
import { getUsage } from '@/lib/usage';
import { getDataMode } from '@/lib/data/mode';
import { AppShell } from '@/components/shell/AppShell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const usage = await getUsage(user);
  return (
    <AppShell
      user={{ ...user, canSettings: canAccessSettings(user) }}
      usage={{ period: usage.period, aiQueries: usage.aiQueries, deepDivesToday: usage.deepDivesToday }}
      dataMode={getDataMode()}
      ownerEmail={process.env.PULSE_OWNER_EMAIL?.trim() || null}
    >
      {children}
    </AppShell>
  );
}
