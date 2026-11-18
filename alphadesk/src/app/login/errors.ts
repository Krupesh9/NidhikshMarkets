/** Human copy for NextAuth `?error=` codes and our own RateLimited code (pure; client-safe). */
export function loginErrorMessage(code: string | null | undefined, retryAfterSec?: number | null): string | undefined {
  if (!code) return undefined;
  switch (code) {
    case 'RateLimited': {
      if (retryAfterSec == null || !Number.isFinite(retryAfterSec) || retryAfterSec <= 0) return 'Too many sign-in attempts. Try again in a few minutes.';
      const min = Math.max(1, Math.ceil(retryAfterSec / 60));
      return `Too many sign-in attempts. Try again in ${min} min.`;
    }
    case 'CredentialsSignin':
      return 'Email or password is incorrect.';
    case 'AccessDenied':
      return 'This account is not allowed to sign in. Ask the owner for access.';
    case 'OAuthAccountNotLinked':
      return 'That email is already linked to another sign-in method.';
    case 'OAuthSignin':
    case 'OAuthCallback':
    case 'OAuthCreateAccount':
    case 'Callback':
      return 'Google sign-in failed. Try again, or use email and password.';
    case 'SessionRequired':
      return 'Please sign in to continue.';
    default:
      return 'Sign-in failed. Try again.';
  }
}
