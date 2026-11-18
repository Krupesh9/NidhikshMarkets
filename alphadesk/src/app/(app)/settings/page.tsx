import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSessionUser } from '@/lib/auth';
import { getUsage } from '@/lib/usage';
import { auditRepo, usageRepo } from '@/lib/repos';
import { db } from '@/lib/db';
import { PLAN_INFO } from '@/lib/plans';
import { PageHeader } from '@/components/shell/PageHeader';
import { PlanBilling } from '@/components/settings/PlanBilling';
import { UsageCard } from '@/components/settings/UsageCard';
import { ApiKeys } from '@/components/settings/ApiKeys';
import { TeamCard } from '@/components/settings/TeamCard';
import { AuditLog } from '@/components/settings/AuditLog';
import { listKeys } from '@/components/settings/keys.server';
import { teamPayload } from '@/components/settings/team.server';
import { nextResetDate } from '@/components/settings/billing';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

const lim = (n: number) => (n === Infinity ? null : n);

export default async function Page() {
  const user = await requireSessionUser();
  const isAdmin = user.role === 'ADMIN';
  const [u, keys, team, org, audit] = await Promise.all([
    getUsage(user),
    listKeys(user.id),
    teamPayload(user),
    isAdmin ? usageRepo.orgTotals(user.orgId, new Date().toISOString().slice(0, 7)) : Promise.resolve(null),
    isAdmin ? auditRepo.list(user.orgId, { take: 100 }) : Promise.resolve([]),
  ]);
  const names = isAdmin ? Object.fromEntries((await db.user.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true, email: true } })).map((x) => [x.id, x.name ?? x.email])) : {};
  const l = PLAN_INFO[user.plan].limits;
  const sections = [
    { href: '#plan', label: 'Plan & billing' }, { href: '#usage', label: 'Usage' }, { href: '#keys', label: 'API keys' }, { href: '#team', label: 'Team' },
    ...(isAdmin ? [{ href: '#audit', label: 'Audit log' }] : []),
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" description={`${user.name} · ${user.email} · ${user.role.charAt(0) + user.role.slice(1).toLowerCase()}`} />
      <nav aria-label="Settings sections" className="mb-4 flex flex-wrap gap-1 text-xs">
        {sections.map((s) => <Link key={s.href} href={s.href} className="rounded border border-border px-2 py-1 text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">{s.label}</Link>)}
      </nav>
      <div className="space-y-4">
        <PlanBilling />
        <UsageCard
          plan={user.plan}
          usage={{ period: u.period, aiQueries: u.aiQueries, aiLimit: lim(l.aiQueriesPerMonth), deepDivesToday: u.deepDivesToday, deepDiveLimit: lim(l.deepDivesPerDay), resetsAt: nextResetDate().toISOString(), org: org ? { users: org.users, aiQueries: org.aiQueries } : null }}
        />
        <ApiKeys initial={keys} />
        <TeamCard data={team} meId={user.id} myRole={user.role} />
        {isAdmin && (
          <AuditLog initial={audit.map((a) => ({ id: a.id, action: a.action, target: a.target, userName: a.userId ? names[a.userId] ?? 'Unknown' : 'System', meta: a.meta, correlationId: a.correlationId, createdAt: a.createdAt.toISOString() }))} />
        )}
      </div>
    </div>
  );
}
