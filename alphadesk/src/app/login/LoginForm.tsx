'use client';
import * as React from 'react';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Mail, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

const DEMO_USERS = [
  { email: 'pm@nidhikshdesk.dev', name: 'Priya Mehta', role: 'Admin · PM', plan: 'Pro Plus' },
  { email: 'analyst@nidhikshdesk.dev', name: 'Alex Chen', role: 'Analyst', plan: 'Pro' },
  { email: 'intern@nidhikshdesk.dev', name: 'Jordan Lee', role: 'Viewer', plan: 'Free' },
];

export function LoginForm({ googleEnabled, ownerLogin = false, demoLogin = true, next, initialError }: { googleEnabled: boolean; ownerLogin?: boolean; demoLogin?: boolean; next: string; initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState(initialError);
  const [sent, setSent] = React.useState(false);

  async function login(addr: string) {
    setBusy(addr);
    setError(undefined);
    setSent(true);
    const r = await signIn('credentials', { email: addr, password: ownerLogin ? password : '', redirect: false });
    if (r?.ok && !r.error) {
      router.replace(next);
      router.refresh();
    } else {
      setBusy(null);
      setSent(false);
      setError(ownerLogin ? 'Email or password is incorrect.' : 'No account found for that email. Use one of the demo users below.');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image src="/nidhiksh-logo.png" alt="" width={64} height={64} className="rounded-lg" priority />
          <h1 className="text-2xl font-semibold tracking-tight">Nidhiksh <span className="text-accent">Pulse</span></h1>
          <p className="text-sm text-muted">Research &amp; decision platform for PMs and analysts.</p>
        </div>
        <div className="rounded-lg border border-border bg-panel p-5 shadow-xl">
          <form
            onSubmit={(e) => { e.preventDefault(); if (email) login(email.trim().toLowerCase()); }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" autoComplete="email" required placeholder="you@fund.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {ownerLogin && (
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            )}
            <Button type="submit" className="w-full" disabled={!!busy}>
              {busy === email && busy ? <Loader2 className="animate-spin" /> : <Mail />} {ownerLogin ? 'Sign in' : 'Send magic link'}
            </Button>
            {!ownerLogin && <p className="text-[11px] text-muted">Dev mode: the magic link is simulated (logged to the server console) and you are signed in immediately.</p>}
            {sent && !error && <p className="text-xs text-info" role="status">Signing you in…</p>}
            {error && <p className="text-xs text-down" role="alert">{error}</p>}
          </form>
          {googleEnabled && (
            <>
              <div className="my-4 flex items-center gap-3 text-[11px] text-muted"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
              <Button variant="secondary" className="w-full" onClick={() => signIn('google', { callbackUrl: next })}>Continue with Google</Button>
            </>
          )}
          {demoLogin && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Quick demo sign-in</p>
            <ul className="space-y-1.5">
              {DEMO_USERS.map((u) => (
                <li key={u.email}>
                  <button
                    onClick={() => login(u.email)}
                    disabled={!!busy}
                    className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:border-info/50 hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:opacity-60"
                  >
                    <span>
                      <span className="block font-medium">{u.name}</span>
                      <span className="block text-[11px] text-muted">{u.email} · {u.role}</span>
                    </span>
                    {busy === u.email ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : <Badge variant={u.plan === 'Pro Plus' ? 'accent' : u.plan === 'Pro' ? 'info' : 'outline'}>{u.plan}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          )}
        </div>
        <p className="mt-6 text-center text-[11px] text-muted">Research only — not investment advice. No trading or order routing.</p>
      </div>
    </main>
  );
}
