#!/usr/bin/env node
/**
 * Get a session cookie for API testing against the local dev server.
 *   node scripts/dev-login.mjs pm@nidhikshdesk.dev            -> prints "Cookie: next-auth.session-token=..."
 *   node scripts/dev-login.mjs analyst@nidhikshdesk.dev --raw  -> prints only the cookie pair (for curl -b)
 * Usage with curl:
 *   curl -s -H "$(node scripts/dev-login.mjs pm@nidhikshdesk.dev)" http://127.0.0.1:4200/api/me
 * Flow: GET /api/auth/csrf -> POST /api/auth/callback/credentials (NextAuth credentials provider).
 */
const email = process.argv[2] ?? 'pm@nidhikshdesk.dev';
const raw = process.argv.includes('--raw');
const base = process.env.ND_BASE_URL ?? 'http://127.0.0.1:4200';

const cookies = new Map();
const keep = (res) => {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of list) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1));
  }
};
const header = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

const csrfRes = await fetch(`${base}/api/auth/csrf`);
if (!csrfRes.ok) { console.error(`csrf failed: HTTP ${csrfRes.status}. Is the dev server running on ${base}?`); process.exit(1); }
keep(csrfRes);
const { csrfToken } = await csrfRes.json();

const res = await fetch(`${base}/api/auth/callback/credentials`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: header() },
  body: new URLSearchParams({ csrfToken, email, json: 'true', callbackUrl: `${base}/dashboard` }),
});
keep(res);
const name = [...cookies.keys()].find((k) => k.endsWith('next-auth.session-token'));
if (!name) { console.error(`login failed for ${email} (HTTP ${res.status}). Is the user seeded? (npm run db:seed)`); process.exit(1); }
const pair = `${name}=${cookies.get(name)}`;
console.log(raw ? pair : `Cookie: ${pair}`);
