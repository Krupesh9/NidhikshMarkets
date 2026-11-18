/** Helpers for JSON-in-String columns (SQLite). */
export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (s == null || s === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
export function toJson(v: unknown): string {
  return JSON.stringify(v ?? null);
}
