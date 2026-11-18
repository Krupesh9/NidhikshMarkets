import { describe, expect, it } from 'vitest';
import { checkLoginRate, clientIp, LOGIN_LIMITS, maskEmail } from '../auth-guard';
import { getLimiter } from '../rate-limit';
import { loginErrorMessage } from '../../app/login/errors';

const fresh = (tag: string) => ({ ip: getLimiter(`t-ip-${tag}`, LOGIN_LIMITS.ip), email: getLimiter(`t-email-${tag}`, LOGIN_LIMITS.email) });

describe('clientIp', () => {
  const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'x-real-ip': '198.51.100.2' });
  it('ignores forwarding headers unless TRUST_PROXY', () => {
    expect(clientIp(h, '127.0.0.1', false)).toBe('127.0.0.1');
    expect(clientIp(h, undefined, false)).toBe('unknown');
  });
  it('uses the first X-Forwarded-For hop behind a trusted proxy, then X-Real-IP', () => {
    expect(clientIp(h, '127.0.0.1', true)).toBe('203.0.113.9');
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }), null, true)).toBe('198.51.100.2');
    expect(clientIp(new Headers(), '127.0.0.1', true)).toBe('127.0.0.1');
  });
});

describe('maskEmail', () => {
  it('never contains the full address', () => {
    const m = maskEmail('Owner.Name@Example.com');
    expect(m).not.toContain('owner.name');
    expect(m).toMatch(/^o\*\*\*@example\.com#[0-9a-f]{10}$/);
    expect(maskEmail('owner.name@example.com')).toBe(m);
  });
});

describe('checkLoginRate', () => {
  it('allows 5 attempts per email then blocks with a retry-after', () => {
    const l = fresh('email');
    for (let i = 0; i < LOGIN_LIMITS.email.capacity; i++) expect(checkLoginRate('a@x.com', '1.1.1.1', l).allowed).toBe(true);
    const r = checkLoginRate('A@x.com ', '1.1.1.1', l);
    expect(r).toMatchObject({ allowed: false, scope: 'email' });
    expect(r.retryAfterSec).toBeGreaterThan(0);
    // a different email from the same IP is still fine
    expect(checkLoginRate('b@x.com', '1.1.1.1', l).allowed).toBe(true);
  });
  it('blocks an IP spraying many emails after 20 attempts', () => {
    const l = fresh('ip');
    for (let i = 0; i < LOGIN_LIMITS.ip.capacity; i++) expect(checkLoginRate(`u${i}@x.com`, '9.9.9.9', l).allowed).toBe(true);
    expect(checkLoginRate('new@x.com', '9.9.9.9', l)).toMatchObject({ allowed: false, scope: 'ip' });
    expect(checkLoginRate('new@x.com', '8.8.8.8', l).allowed).toBe(true);
  });
  it('does not share one global bucket when the IP is unknown', () => {
    const l = fresh('unknown');
    for (let i = 0; i < 30; i++) expect(checkLoginRate(`v${i}@x.com`, 'unknown', l).allowed).toBe(true);
  });
});

describe('loginErrorMessage', () => {
  it('maps codes to copy', () => {
    expect(loginErrorMessage(undefined)).toBeUndefined();
    expect(loginErrorMessage('RateLimited', 600)).toBe('Too many sign-in attempts. Try again in 10 min.');
    expect(loginErrorMessage('RateLimited')).toMatch(/few minutes/);
    expect(loginErrorMessage('CredentialsSignin')).toBe('Email or password is incorrect.');
    expect(loginErrorMessage('OAuthCallback')).toMatch(/Google/);
  });
});
