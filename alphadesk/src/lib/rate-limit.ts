/** In-memory token bucket behind an interface (Redis later). */
export interface RateLimiter {
  /** consume 1 token for key; returns allowed + retryAfter seconds */
  take(key: string): { allowed: boolean; remaining: number; retryAfterSec: number };
}

export interface RateLimitOptions { capacity: number; refillPerSec: number }

class TokenBucket implements RateLimiter {
  private buckets = new Map<string, { tokens: number; ts: number }>();
  constructor(private o: RateLimitOptions) {}
  take(key: string) {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.o.capacity, ts: now };
    b.tokens = Math.min(this.o.capacity, b.tokens + ((now - b.ts) / 1000) * this.o.refillPerSec);
    b.ts = now;
    if (this.buckets.size > 10_000) {
      // Evict the oldest 10% instead of resetting everyone's limits.
      let n = 1_000;
      for (const k of this.buckets.keys()) { if (n-- <= 0) break; this.buckets.delete(k); }
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(key, b);
      return { allowed: true, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
    }
    this.buckets.set(key, b);
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil((1 - b.tokens) / this.o.refillPerSec) };
  }
}

const g = globalThis as unknown as { __ndLimiters?: Map<string, RateLimiter> };
const registry = g.__ndLimiters ?? (g.__ndLimiters = new Map());

/** Presets: 'default' 60/min, 'ai' 10/min burst 5, 'auth' 10/min, 'mutation' 30/min. */
export const RATE_PRESETS: Record<string, RateLimitOptions> = {
  default: { capacity: 60, refillPerSec: 1 },
  ai: { capacity: 5, refillPerSec: 10 / 60 },
  auth: { capacity: 10, refillPerSec: 10 / 60 },
  mutation: { capacity: 30, refillPerSec: 0.5 },
};

export function getLimiter(name: string, opts?: RateLimitOptions): RateLimiter {
  let l = registry.get(name);
  if (!l) {
    l = new TokenBucket(opts ?? RATE_PRESETS[name] ?? RATE_PRESETS.default);
    registry.set(name, l);
  }
  return l;
}
