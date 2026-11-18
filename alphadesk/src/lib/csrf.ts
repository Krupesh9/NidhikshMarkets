/** Same-origin check for state-changing requests (defense in depth on top of SameSite=Lax cookies). */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSameOrigin(req: Request): boolean {
  if (SAFE.has(req.method.toUpperCase())) return true;
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin) {
    // Non-browser clients (curl, server-to-server) send no Origin; browsers always do on cross-site POST.
    const site = req.headers.get('sec-fetch-site');
    return !site || site === 'same-origin' || site === 'none';
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
