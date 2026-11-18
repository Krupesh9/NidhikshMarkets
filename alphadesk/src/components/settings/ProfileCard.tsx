import { UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PLAN_INFO, type Plan, type Role } from '@/lib/plans';

export function initials(name: string | null | undefined, email: string): string {
  const src = (name || email.split('@')[0]).trim();
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function ProfileCard({ name, email, role, plan, orgName, owner }: { name: string; email: string; role: Role; plan: Plan; orgName: string | null; owner: boolean }) {
  return (
    <Card id="profile" className="scroll-mt-28">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4 text-muted" aria-hidden /> Profile</CardTitle>
        <CardDescription>Your identity comes from your sign-in provider.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-4">
          <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-full border border-accent/40 bg-accent/15 font-mono text-lg font-semibold text-accent">{initials(name, email)}</span>
          <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted">Name</dt><dd className="font-medium">{name}</dd>
            <dt className="text-muted">Email</dt><dd className="font-mono text-xs leading-5">{email}</dd>
            <dt className="text-muted">Workspace</dt><dd>{orgName ?? '—'}</dd>
            <dt className="text-muted">Role</dt>
            <dd className="flex flex-wrap gap-1.5">
              <Badge variant={role === 'ADMIN' ? 'accent' : 'outline'}>{role.charAt(0) + role.slice(1).toLowerCase()}</Badge>
              {owner && <Badge variant="info">Owner</Badge>}
            </dd>
            <dt className="text-muted">Plan</dt><dd>{PLAN_INFO[plan].priceLabel}</dd>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
