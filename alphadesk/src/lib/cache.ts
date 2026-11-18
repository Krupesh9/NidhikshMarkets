/** In-memory TTL cache behind a small interface (swap for Redis in phase two). Server-side only. */
export interface Cache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs?: number): void;
  delete(key: string): void;
  clear(): void;
  /** Return cached value or compute + store it. Concurrent calls share one in-flight promise. */
  wrap<T>(key: string, fn: () => Promise<T>, ttlMs?: number): Promise<T>;
}

export const DEFAULT_TTL_MS = 5 * 60_000;

class MemoryCache implements Cache {
  private store = new Map<string, { v: unknown; exp: number }>();
  private inflight = new Map<string, Promise<unknown>>();
  constructor(private max = 5000) {}

  get<T>(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e.v as T;
  }
  set<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
    if (this.store.size >= this.max) {
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    this.store.set(key, { v: value, exp: Date.now() + ttlMs });
  }
  delete(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
  async wrap<T>(key: string, fn: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const p = fn()
      .then((v) => { this.set(key, v, ttlMs); return v; })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

const g = globalThis as unknown as { __ndCache?: Cache };
export const cache: Cache = g.__ndCache ?? (g.__ndCache = new MemoryCache());
export function createCache(max?: number): Cache { return new MemoryCache(max); }
