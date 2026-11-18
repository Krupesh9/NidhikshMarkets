import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { demoLoginEnabled, getSessionUser, googleEnabled, ownerLoginEnabled } from '@/lib/auth';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: { callbackUrl?: string; error?: string } }) {
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
  return <LoginForm googleEnabled={googleEnabled} ownerLogin={ownerLoginEnabled} demoLogin={demoLoginEnabled} next={next} initialError={searchParams.error ? 'Sign-in failed. Try again.' : undefined} />;
}
