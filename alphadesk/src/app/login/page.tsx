import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { demoLoginEnabled, getSessionUser, googleEnabled, ownerLoginEnabled } from '@/lib/auth';
import { LoginForm } from './LoginForm';
import { loginErrorMessage } from './errors';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: { callbackUrl?: string; error?: string; retryAfter?: string; email?: string } }) {
  if (await getSessionUser()) redirect('/dashboard');
  const cb = searchParams.callbackUrl;
  // only allow relative callback paths
  let next = '/dashboard';
  if (cb) {
    try {
      const u = new URL(cb, 'http://x');
      if (u.pathname.startsWith('/') && !u.pathname.startsWith('//') && u.pathname !== '/login') next = u.pathname + u.search;
    } catch { /* ignore */ }
  }
  const retry = Number(searchParams.retryAfter);
  const email = typeof searchParams.email === 'string' && searchParams.email.length < 200 ? searchParams.email : '';
  return (
    <LoginForm
      googleEnabled={googleEnabled}
      ownerLogin={ownerLoginEnabled}
      demoLogin={demoLoginEnabled}
      next={next}
      initialEmail={email}
      initialError={loginErrorMessage(searchParams.error, Number.isFinite(retry) ? retry : null)}
    />
  );
}
