import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireSessionUser } from '@/lib/auth';
import { canAccessSettings } from '@/lib/owner';
import { getUsage } from '@/lib/usage';
import { auditRepo, usageRepo } from '@/lib/repos';
import { db } from '@/lib/db';
import { PLAN_INFO } from '@/lib/plans';
import { getDataMode } from '@/lib/data/mode';
import { mockAllowed } from '@/lib/data/mock-policy';
import { getProviderStatus } from '@/lib/data/providers-status';
import { fmpUsage } from '@/lib/data/fmp';
import { PageHeader } from '@/components/shell/PageHeader';
import { SettingsNav, type SettingsSection } from '@/components/settings/SettingsNav';
import { ProfileCard } from '@/components/settings/ProfileCard';
import { PlanBilling } from '@/components/settings/PlanBilling';
import { DataSources } from '@/components/settings/DataSources';
import { UsageCard } from '@/components/settings/UsageCard';
import { ApiKeys } from '@/components/settings/ApiKeys';
import { TeamCard } from '@/components/settings/TeamCard';
import { AuditLog } from '@/components/settings/AuditLog';
import { DataExport } from '@/components/settings/DataExport';
import { ValuationDefaultsCard } from '@/components/settings/ValuationDefaults';
import { readValuationSetting } from '@/lib/fundamentals/settings.server';
import { listKeys } from '@/components/settings/keys.server';
import { teamPayload } from '@/components/settings/team.server';
import { isOwner } from '@/components/settings/plan-admin.server';
import { nextResetDate } from '@/components/settings/billing';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

const lim = (n: number) => (n === Infinity ? null : n);

export default async function Page() {
  const user = await requireSessionUser();
  if (!canAccessSettings(user)) notFound(); // Settings exist only for the owner
  const isAdmin = user.role === 'ADMIN';
  const owner = isOwner(user.email);
  const [u, keys, team, org, audit, valuation] = await Promise.all([
    getUsage(user),
    listKeys(user.id),
    teamPayload(user),
    isAdmin ? usageRepo.orgTotals(user.orgId, new Date().toISOString().slice(0, 7)) : Promise.resolve(null),
    isAdmin ? auditRepo.list(user.orgId, { take: 100 }) : Promise.resolve([]),
    readValuationSetting(user.orgId),
  ]);
  const valuationBy = valuation.updatedById ? (await db.user.findUnique({ where: { id: valuation.updatedById }, select: { name: true, email: true } })) : null;
  const names = isAdmin ? Object.fromEntries((await db.user.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true, email: true } })).map((x) => [x.id, x.name ?? x.email])) : {};
  const l = PLAN_INFO[user.plan].limits;
  const mode = getDataMode();
  const sections: SettingsSection[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'plan', label: 'Plan & billing' },
    { id: 'data-sources', label: 'Data sources' },
    { id: 'valuation', label: 'Valuation defaults' },
    { id: 'keys', label: 'AI keys' },
    { id: 'usage', label: 'Usage' },
    { id: 'team', label: 'Team' },
    ...(isAdmin ? [{ id: 'audit', label: 'Audit log' }] : []),
    { id: 'data', label: 'Your data' },
  ];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Settings" description="Profile, plan, data sources, valuation defaults, keys, usage and team." />
      <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
        <aside className="md:self-start md:sticky md:top-[116px]"><SettingsNav sections={sections} /></aside>
        <div className="min-w-0 space-y-5">
          <ProfileCard name={user.name} email={user.email} role={user.role} plan={user.plan} orgName={team.org?.name ?? null} owner={owner} />
          <PlanBilling plan={user.plan} userEmail={user.email} ownerEmail={process.env.PULSE_OWNER_EMAIL?.trim() || null} isAdmin={isAdmin} />
          <DataSources providers={getProviderStatus()} mockAllowed={mockAllowed()} dataLabel={mode.label} fmp={fmpUsage()} />
          <ValuationDefaultsCard initial={{ defaults: valuation.defaults, updatedAt: valuation.updatedAt, updatedByName: valuationBy ? valuationBy.name ?? valuationBy.email : null }} />
          <ApiKeys initial={keys} />
          <UsageCard
            plan={user.plan}
            usage={{ period: u.period, aiQueries: u.aiQueries, aiLimit: lim(l.aiQueriesPerMonth), deepDivesToday: u.deepDivesToday, deepDiveLimit: lim(l.deepDivesPerDay), resetsAt: nextResetDate().toISOString(), org: org ? { users: org.users, aiQueries: org.aiQueries } : null }}
          />
          <TeamCard data={team} meId={user.id} myRole={user.role} isOwner={owner} />
          {isAdmin && (
            <AuditLog initial={audit.map((a) => ({ id: a.id, action: a.action, target: a.target, userName: a.userId ? names[a.userId] ?? 'Unknown' : 'System', meta: a.meta, correlationId: a.correlationId, createdAt: a.createdAt.toISOString() }))} />
          )}
          <DataExport />
        </div>
      </div>
    </div>
  );
}
