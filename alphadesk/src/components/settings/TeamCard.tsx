'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, UserPlus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { UpgradeHint } from '@/components/shell/UpgradeHint';
import { PLAN_INFO, type GateResult, type Plan, type Role } from '@/lib/plans';

export interface TeamMember { id: string; name: string | null; email: string; role: string; plan: string; createdAt: string }
export interface TeamData { org: { id: string; name: string } | null; members: TeamMember[]; seats: { used: number; limit: number | null }; canManage: boolean; gate: GateResult }

const ROLES: Role[] = ['ADMIN', 'ANALYST', 'VIEWER'];
const ROLE_HINT: Record<Role, string> = { ADMIN: 'Manage team, billing and audit log', ANALYST: 'Research, screens, portfolios', VIEWER: 'Read and comment' };

async function call(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.details?.[0]?.message ?? j?.error?.message ?? `HTTP ${r.status}`);
  return j;
}

export function TeamCard({ data, meId, myRole }: { data: TeamData; meId: string; myRole: Role }) {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<Role>('ANALYST');
  const [busy, setBusy] = React.useState<string | null>(null);
  const full = data.seats.limit != null && data.seats.used >= data.seats.limit;
  const isAdmin = myRole === 'ADMIN';

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('invite');
    try {
      await call('/api/team', { method: 'POST', body: JSON.stringify({ email, name: name || undefined, role }) });
      toast({ title: 'Invite sent (simulated)', description: `${email} was added to ${data.org?.name ?? 'your team'}. They can sign in with the dev magic link.`, variant: 'success' });
      setEmail(''); setName('');
      router.refresh();
    } catch (err) {
      toast({ title: 'Invite failed', description: (err as Error).message, variant: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const changeRole = async (id: string, r: Role) => {
    setBusy(id);
    try {
      await call(`/api/team/${id}`, { method: 'PATCH', body: JSON.stringify({ role: r }) });
      toast({ title: 'Role updated', variant: 'success' });
      router.refresh();
    } catch (err) {
      toast({ title: 'Role not changed', description: (err as Error).message, variant: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const remove = async (m: TeamMember) => {
    if (!window.confirm(`Remove ${m.name ?? m.email} from the team? Their seat is freed.`)) return;
    setBusy(m.id);
    try {
      await call(`/api/team/${m.id}`, { method: 'DELETE' });
      toast({ title: 'Member removed', variant: 'success' });
      router.refresh();
    } catch (err) {
      toast({ title: 'Remove failed', description: (err as Error).message, variant: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card id="team" className="scroll-mt-16">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-muted" aria-hidden /> Team{data.org ? ` · ${data.org.name}` : ''}</CardTitle>
          <CardDescription>Seats are set by the plan of the admin managing the team (Pro Plus: 5 seats).</CardDescription>
        </div>
        <Badge variant={full ? 'warn' : 'outline'} className="font-mono">{data.seats.used} / {data.seats.limit ?? '∞'} seats</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-panel-2 text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Member</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Role</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Plan</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Joined</th>
                {data.canManage && <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{m.name ?? m.email}{m.id === meId && <span className="ml-1 text-muted">(you)</span>}</div>
                    <div className="text-[11px] text-muted">{m.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    {data.canManage && m.id !== meId ? (
                      <Select value={m.role} onValueChange={(v) => changeRole(m.id, v as Role)} disabled={busy === m.id}>
                        <SelectTrigger className="h-8 w-32" aria-label={`Role for ${m.name ?? m.email}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={m.role === 'ADMIN' ? 'accent' : 'outline'}>{m.role.charAt(0) + m.role.slice(1).toLowerCase()}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">{PLAN_INFO[m.plan as Plan]?.label ?? m.plan}</td>
                  <td className="px-3 py-2 text-muted">{new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  {data.canManage && (
                    <td className="px-3 py-2 text-right">
                      {m.id !== meId && <Button size="icon-sm" variant="ghost" onClick={() => remove(m)} disabled={busy === m.id} aria-label={`Remove ${m.name ?? m.email}`}><Trash2 aria-hidden /></Button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isAdmin ? (
          <p className="text-xs text-muted">Only admins can invite members or change roles.</p>
        ) : !data.gate.allowed ? (
          <UpgradeHint gate={data.gate} />
        ) : full ? (
          <UpgradeHint reason={`All ${data.seats.limit} seats are in use. Remove a member to invite someone new.`} />
        ) : (
          <form onSubmit={invite} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
            <div>
              <Label htmlFor="invite-email" className="text-xs">Email</Label>
              <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@fund.com" />
            </div>
            <div>
              <Label htmlFor="invite-name" className="text-xs">Name (optional)</Label>
              <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Rivera" />
            </div>
            <div>
              <Label className="text-xs" id="invite-role-label">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="w-32" aria-labelledby="invite-role-label"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()} — {ROLE_HINT[r]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={busy === 'invite' || !email}><UserPlus aria-hidden /> {busy === 'invite' ? 'Inviting…' : 'Invite'}</Button>
            <p className="text-[11px] text-muted sm:col-span-4">Demo: creates the user record immediately (Free plan) and logs a simulated invite link to the server console.</p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
