'use client';
import * as React from 'react';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, FileSearch, LineChart, Loader2, Lock, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { loginErrorMessage } from './errors';

const DEMO_USERS = [
  { email: 'pm@nidhikshdesk.dev', name: 'Priya Mehta', role: 'Admin · PM', plan: 'Pro' },
  { email: 'analyst@nidhikshdesk.dev', name: 'Alex Chen', role: 'Analyst', plan: 'Pro' },
  { email: 'intern@nidhikshdesk.dev', name: 'Jordan Lee', role: 'Viewer', plan: 'Free' },
];

const VALUE = [
  { icon: LineChart, title: 'Company deep dives', text: 'Prices, statements, estimates and ownership on one screen.' },
  { icon: FileSearch, title: 'Every number sourced', text: 'Click any figure to see the filing or feed it came from.' },
  { icon: Sparkles, title: 'AI research with citations', text: 'Ask questions across filings, news and your portfolios.' },
];

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}

export function LoginForm({ googleEnabled, ownerLogin = false, demoLogin = true, signupEnabled = true, mode = 'signin', next, initialError, initialEmail = '' }: {
  googleEnabled: boolean; ownerLogin?: boolean; demoLogin?: boolean; signupEnabled?: boolean; mode?: 'signin' | 'signup'; next: string; initialError?: string; initialEmail?: string;
}) {
  const signup = mode === 'signup';
  const [name, setName] = React.useState('');
  const router = useRouter();
  const [email, setEmail] = React.useState(initialEmail);
  const [password, setPassword] = React.useState('');
  const [showPw, setShowPw] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState(initialError);
  const [success, setSuccess] = React.useState(false);
  const needsPassword = ownerLogin || signupEnabled || signup;
  const noMethod = !ownerLogin && !demoLogin && !googleEnabled && !signupEnabled;
  const pwHint = password.length === 0 ? null : password.length < 10 ? 'At least 10 characters' : !/[A-Za-z]/.test(password) || !/\d/.test(password) ? 'Add a letter and a number' : null;

  async function login(addr: string, pw: string, key: string) {
    setBusy(key);
    setError(undefined);
    try {
      const r = await signIn('credentials', { email: addr, password: pw, redirect: false });
      if (r?.ok && !r.error) {
        setSuccess(true);
        router.replace(next);
        router.refresh();
        return;
      }
      if (r?.error === 'RateLimited') {
        setError(loginErrorMessage('RateLimited'));
      } else {
        setError(needsPassword ? 'Email or password is incorrect.' : 'No account found for that email.');
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
    setBusy(null);
  }

  async function register(addr: string) {
    setBusy('form');
    setError(undefined);
    try {
      const r = await fetch('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, email: addr, password }) });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
        setError(r.status === 429 ? loginErrorMessage('RateLimited') : j?.error?.message ?? 'Could not create the account. Try again.');
        setBusy(null);
        return;
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(null);
      return;
    }
    await login(addr, password, 'form'); // signed straight in
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!addr) return;
    if (signup) {
      if (pwHint) { setError(`Password: ${pwHint.toLowerCase()}.`); return; }
      register(addr);
      return;
    }
    login(addr, needsPassword ? password : '', 'form');
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-bg">
      {/* subtle brand glow */}
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-accent/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 right-0 h-[480px] w-[480px] rounded-full bg-info/10 blur-3xl" />

      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl lg:grid-cols-[1.1fr_1fr]">
        {/* Brand panel (desktop) */}
        <section aria-label="About Nidhiksh Pulse" className="hidden flex-col justify-between border-r border-border/60 px-12 py-12 lg:flex">
          <div className="flex items-center gap-3">
            <Image src="/nidhiksh-logo.png" alt="" width={40} height={40} className="rounded-lg" priority />
            <span className="text-lg font-semibold tracking-tight">Nidhiksh <span className="text-accent">Pulse</span></span>
          </div>
          <div className="max-w-md">
            <p className="eyebrow text-accent">Research workspace</p>
            <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-[-0.02em]">Equity research, sourced and in one place.</h2>
            <ul className="mt-10 space-y-6">
              {VALUE.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-panel text-accent"><Icon className="h-4 w-4" aria-hidden /></span>
                  <span>
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block text-sm text-muted">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted">Research only — not investment advice. No trading or order routing.</p>
        </section>

        {/* Form */}
        <section className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex flex-col items-center gap-3 text-center lg:items-start lg:text-left">
              <Image src="/nidhiksh-logo.png" alt="" width={56} height={56} className="rounded-xl lg:hidden" priority />
              <h1 className="text-2xl font-semibold tracking-tight">
                <span className="lg:hidden">Nidhiksh <span className="text-accent">Pulse</span></span>
                <span className="hidden lg:inline">{signup ? 'Create your account' : 'Sign in'}</span>
              </h1>
              <p className="text-sm text-muted">
                <span className="lg:hidden">Research &amp; decision workspace for PMs and analysts.</span>
                <span className="hidden lg:inline">{signup ? 'Start free. Upgrade to Pro any time.' : 'Welcome back. Sign in to your workspace.'}</span>
              </p>
            </div>

            <div className="rounded-xl border border-border bg-panel/90 p-6 shadow-2xl shadow-black/30 backdrop-blur">
              {error && (
                <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{error}</span>
                </div>
              )}

              {noMethod ? (
                <p className="text-sm text-muted">Sign-in is not configured on this deployment. Set <code className="font-mono text-xs">PULSE_OWNER_EMAIL</code> and <code className="font-mono text-xs">PULSE_OWNER_PASSWORD</code>, or Google OAuth.</p>
              ) : (
                <>
                  {(ownerLogin || demoLogin || signupEnabled) && (
                    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
                      {signup && (
                        <div className="space-y-1.5">
                          <Label htmlFor="name">Name</Label>
                          <Input id="name" name="name" autoComplete="name" required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} disabled={!!busy || success} />
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" name="email" type="email" autoComplete="username email" inputMode="email" required autoFocus={!signup}
                          placeholder="you@fund.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!busy || success}
                          aria-invalid={!!error || undefined} />
                      </div>
                      {needsPassword && (
                        <div className="space-y-1.5">
                          <Label htmlFor="password">Password</Label>
                          <div className="relative">
                            <Input id="password" name="password" type={showPw ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 10 : undefined}
                              value={password} onChange={(e) => setPassword(e.target.value)} disabled={!!busy || success} className="pr-10"
                              aria-invalid={!!error || undefined} />
                            <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}
                              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                              {showPw ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                            </button>
                          </div>
                          {signup && <p className={`text-[11px] ${pwHint ? 'text-warn' : 'text-muted'}`}>{pwHint ?? 'At least 10 characters, with a letter and a number.'}</p>}
                        </div>
                      )}
                      <Button type="submit" className="w-full font-semibold" disabled={!!busy || success} aria-busy={busy === 'form'}>
                        {busy === 'form' || success ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                        {success ? 'Signing you in…' : busy === 'form' ? (signup ? 'Creating account…' : 'Signing in…') : signup ? 'Create free account' : needsPassword ? 'Sign in' : 'Continue with email'}
                      </Button>
                    </form>
                  )}

                  {googleEnabled && (
                    <>
                      {(ownerLogin || demoLogin) && (
                        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
                      )}
                      <Button variant="secondary" className="w-full" disabled={!!busy || success} aria-busy={busy === 'google'}
                        onClick={() => { setBusy('google'); setError(undefined); signIn('google', { callbackUrl: next }); }}>
                        {busy === 'google' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <GoogleMark />} Continue with Google
                      </Button>
                    </>
                  )}

                  <p className="sr-only" role="status" aria-live="polite">{success ? 'Signed in. Redirecting.' : busy ? 'Signing in.' : ''}</p>
                </>
              )}
              <p className="mt-5 flex items-center gap-1.5 text-[11px] text-muted"><ShieldCheck className="h-3.5 w-3.5 text-up" aria-hidden /> Encrypted session · attempts are rate-limited</p>
            </div>

            {signupEnabled && (
              <p className="mt-4 text-center text-sm text-muted lg:text-left">
                {signup
                  ? <>Already have an account? <a href="/login" className="font-medium text-info hover:underline">Sign in</a></>
                  : <>New to Nidhiksh Pulse? <a href="/signup" className="font-medium text-info hover:underline">Create a free account</a></>}
              </p>
            )}

            {demoLogin && !signup && (
              <div className="mt-4 rounded-xl border border-dashed border-warn/40 bg-warn/[0.04] p-4">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-warn"><Wrench className="h-3.5 w-3.5" aria-hidden /> Development · demo sign-in</p>
                <p className="mb-3 text-[11px] text-muted">Passwordless demo users. Disabled in production unless <code className="font-mono">ALLOW_DEMO_LOGIN=1</code>.</p>
                <ul className="space-y-1.5">
                  {DEMO_USERS.map((u) => (
                    <li key={u.email}>
                      <button type="button" onClick={() => login(u.email, '', u.email)} disabled={!!busy || success}
                        className="flex w-full items-center justify-between rounded-md border border-border bg-panel px-3 py-2 text-left text-sm hover:border-info/50 hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:opacity-60">
                        <span>
                          <span className="block font-medium">{u.name}</span>
                          <span className="block text-[11px] text-muted">{u.email} · {u.role}</span>
                        </span>
                        {busy === u.email ? <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden /> : <Badge variant={u.plan === 'Pro' ? 'accent' : 'outline'}>{u.plan}</Badge>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <footer className="mt-8 space-y-2 text-center text-[11px] text-muted lg:text-left">
              <p className="lg:hidden">Research only — not investment advice.</p>
              <p className="flex flex-wrap justify-center gap-x-3 lg:justify-start">
                <span>© {new Date().getFullYear()} Nidhiksh</span>
                <span aria-hidden>·</span>
                <span>Privacy policy (coming soon)</span>
                <span aria-hidden>·</span>
                <span>Terms of use (coming soon)</span>
              </p>
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}
