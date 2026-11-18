/** Structured JSON logging with correlation ids. Never pass secrets in `fields`. */
type Level = 'debug' | 'info' | 'warn' | 'error';

const SECRET_KEYS = /(key|secret|token|password|authorization|cookie|ciphertext)/i;

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== 'object') return v;
  if (v instanceof Error) return { name: v.name, message: v.message };
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : scrub(val, depth + 1);
  return out;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(scrub(fields ?? {}) as object) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, f?: Record<string, unknown>): void;
  info(msg: string, f?: Record<string, unknown>): void;
  warn(msg: string, f?: Record<string, unknown>): void;
  error(msg: string, f?: Record<string, unknown>): void;
  child(f: Record<string, unknown>): Logger;
}

function make(base: Record<string, unknown>): Logger {
  return {
    debug: (m, f) => emit('debug', m, { ...base, ...f }),
    info: (m, f) => emit('info', m, { ...base, ...f }),
    warn: (m, f) => emit('warn', m, { ...base, ...f }),
    error: (m, f) => emit('error', m, { ...base, ...f }),
    child: (f) => make({ ...base, ...f }),
  };
}

export const log: Logger = make({ app: 'nidhikshdesk' });

export const CORRELATION_HEADER = 'x-correlation-id';
export function newCorrelationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
export function getCorrelationId(headers: Headers): string {
  const v = headers.get(CORRELATION_HEADER);
  return v && /^[\w-]{6,80}$/.test(v) ? v : newCorrelationId();
}
