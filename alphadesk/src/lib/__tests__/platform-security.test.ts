/** Critical path: AES-256-GCM key sealing, CSRF same-origin, token-bucket rate limiting, sanitizers. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decrypt, encrypt, mask } from '@/lib/crypto';
import { isSameOrigin } from '@/lib/csrf';
import { RATE_PRESETS, getLimiter } from '@/lib/rate-limit';
import { csvSafe, escapeHtml, sanitizeMarkdown, sanitizeText, sanitizeTicker } from '@/lib/sanitize';

describe('crypto (AES-256-GCM)', () => {
  const secret = 'sk-ant-api03-EXAMPLE-not-a-real-key-9f2c';
  const flip = (b64: string) => {
    const b = Buffer.from(b64, 'base64');
    b[0] ^= 0x01;
    return b.toString('base64');
  };

  it('round-trips and never stores plaintext', () => {
    const s = encrypt(secret);
    expect(decrypt(s)).toBe(secret);
    expect(s.ciphertext).not.toContain('sk-ant');
    expect(Buffer.from(s.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(s.tag, 'base64')).toHaveLength(16);
  });

  it('uses a fresh IV per encryption', () => {
    const a = encrypt(secret);
    const b = encrypt(secret);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('detects tampering of ciphertext, tag or IV', () => {
    const s = encrypt(secret);
    expect(() => decrypt({ ...s, ciphertext: flip(s.ciphertext) })).toThrow();
    expect(() => decrypt({ ...s, tag: flip(s.tag) })).toThrow();
    expect(() => decrypt({ ...s, iv: flip(s.iv) })).toThrow();
  });

  it('fails closed on a different key', () => {
    const s = encrypt(secret);
    const prev = process.env.ENCRYPTION_KEY;
    try {
      process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
      expect(() => decrypt(s)).toThrow();
    } finally {
      process.env.ENCRYPTION_KEY = prev;
    }
  });

  it('rejects missing or wrong-length ENCRYPTION_KEY', () => {
    const prev = process.env.ENCRYPTION_KEY;
    try {
      delete process.env.ENCRYPTION_KEY;
      expect(() => encrypt('x')).toThrow(/not set/);
      process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
      expect(() => encrypt('x')).toThrow(/32 bytes/);
    } finally {
      process.env.ENCRYPTION_KEY = prev;
    }
  });

  it('masks to last 4 only', () => {
    const s = encrypt(secret);
    expect(s.last4).toBe('9f2c');
    expect(mask(s.last4)).toBe('••••••••9f2c');
    expect(mask(s.last4)).not.toContain('sk-');
  });
});

describe('csrf same-origin', () => {
  const req = (method: string, headers: Record<string, string>) => new Request('http://127.0.0.1:4200/api/x', { method, headers });

  it('always allows safe methods', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(isSameOrigin(req(m, { origin: 'https://evil.example', host: '127.0.0.1:4200' }))).toBe(true);
  });
  it('allows same-origin mutations', () => {
    expect(isSameOrigin(req('POST', { origin: 'http://127.0.0.1:4200', host: '127.0.0.1:4200' }))).toBe(true);
    expect(isSameOrigin(req('DELETE', { origin: 'https://desk.example.com', host: 'internal:4200', 'x-forwarded-host': 'desk.example.com' }))).toBe(true);
  });
  it('blocks cross-origin mutations', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(isSameOrigin(req(m, { origin: 'https://evil.example', host: '127.0.0.1:4200' }))).toBe(false);
    expect(isSameOrigin(req('POST', { origin: 'http://127.0.0.1:4201', host: '127.0.0.1:4200' }))).toBe(false);
    expect(isSameOrigin(req('POST', { origin: 'null', host: '127.0.0.1:4200' }))).toBe(false);
  });
  it('without Origin: trusts non-browser clients, blocks cross-site fetch metadata', () => {
    expect(isSameOrigin(req('POST', { host: '127.0.0.1:4200' }))).toBe(true);
    expect(isSameOrigin(req('POST', { host: '127.0.0.1:4200', 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOrigin(req('POST', { host: '127.0.0.1:4200', 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isSameOrigin(req('POST', { host: '127.0.0.1:4200', 'sec-fetch-site': 'same-site' }))).toBe(false);
  });
});

describe('rate limiter (token bucket)', () => {
  afterEach(() => vi.useRealTimers());

  it('allows a burst up to capacity, then refills over time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const l = getLimiter(`test-${Math.random()}`, { capacity: 3, refillPerSec: 1 });
    expect([1, 2, 3].map(() => l.take('k').allowed)).toEqual([true, true, true]);
    const denied = l.take('k');
    expect(denied).toMatchObject({ allowed: false, remaining: 0 });
    expect(denied.retryAfterSec).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(l.take('k').allowed).toBe(true);
    expect(l.take('k').allowed).toBe(false);
    vi.advanceTimersByTime(60_000); // refill never exceeds capacity
    expect([1, 2, 3, 4].map(() => l.take('k').allowed)).toEqual([true, true, true, false]);
  });

  it('isolates keys', () => {
    const l = getLimiter(`test-${Math.random()}`, { capacity: 1, refillPerSec: 0.001 });
    expect(l.take('user-a').allowed).toBe(true);
    expect(l.take('user-a').allowed).toBe(false);
    expect(l.take('user-b').allowed).toBe(true);
  });

  it('returns the same limiter instance per name; ai preset is burst 5 at 10/min', () => {
    expect(getLimiter('default')).toBe(getLimiter('default'));
    expect(RATE_PRESETS.ai).toEqual({ capacity: 5, refillPerSec: 10 / 60 });
    const name = `ai-like-${Math.random()}`;
    const l = getLimiter(name, RATE_PRESETS.ai);
    const res = Array.from({ length: 6 }, () => l.take('u'));
    expect(res.filter((r) => r.allowed)).toHaveLength(5);
    expect(res[5].retryAfterSec).toBeGreaterThanOrEqual(5);
  });
});

describe('sanitize', () => {
  it('sanitizeText strips control chars, normalises CRLF, trims and caps length', () => {
    expect(sanitizeText('  a\u0000b\u0007c\r\nd  ')).toBe('abc\nd');
    expect(sanitizeText('x'.repeat(50), 10)).toHaveLength(10);
    expect(sanitizeText(42)).toBe('');
    expect(sanitizeText('tab\tkept')).toBe('tab\tkept');
  });
  it('sanitizeMarkdown removes tags, handlers and dangerous link schemes', () => {
    expect(sanitizeMarkdown('<img src=x onerror=alert(1)>hi')).toBe('hi');
    expect(sanitizeMarkdown('<iframe src="//evil"></iframe>ok')).toBe('ok');
    expect(sanitizeMarkdown('[x](data:text/html;base64,AAA)')).toBe('[x](#)');
    expect(sanitizeMarkdown('[x](JavaScript:alert(1))')).toBe('[x](#)');
    expect(sanitizeMarkdown('[10-K](https://www.sec.gov/x) **bold**')).toBe('[10-K](https://www.sec.gov/x) **bold**');
  });
  it('escapeHtml', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
  it('sanitizeTicker accepts real symbols only', () => {
    expect(sanitizeTicker('brk.b')).toBe('BRK.B');
    expect(sanitizeTicker('BF-B')).toBe('BF-B');
    for (const bad of ['', '1ABC', 'A B', "AAPL'--", 'TOOLONGTICKER', null, 5]) expect(sanitizeTicker(bad)).toBeNull();
  });
  it('csvSafe neutralises formula injection', () => {
    for (const s of ['=HYPERLINK("x")', '+1', '@SUM(A1)', '\tcmd']) expect(csvSafe(s).startsWith("'")).toBe(true);
    expect(csvSafe('Apple Inc.')).toBe('Apple Inc.');
    expect(csvSafe(null)).toBe('');
  });
});
