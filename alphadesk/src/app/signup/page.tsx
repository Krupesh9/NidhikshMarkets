import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { demoLoginEnabled, getSessionUser, googleEnabled, ownerLoginEnabled } from '@/lib/auth';
import { LoginForm } from '../login/LoginForm';

export const metadata: Metadata = { title: 'Create account' };
export const dynamic = 'force-dynamic';

/** Self-service sign-up: new accounts start on the Free plan (role VIEWER). */
export default async function SignupPage() {
  if (await getSessionUser()) redirect('/dashboard');
  return <LoginForm mode="signup" googleEnabled={googleEnabled} ownerLogin={ownerLoginEnabled} demoLogin={demoLoginEnabled} signupEnabled next="/dashboard" />;
}
