import os from 'node:os';
import path from 'node:path';

/**
 * Writable folder for on-disk caches. Locally: <app>/.cache (git-ignored). On Vercel the app folder is read-only,
 * so caches go to the function's temp dir (per instance, cleared on cold start).
 */
export function cacheDir(...parts: string[]): string {
  const base = process.env.VERCEL ? path.join(os.tmpdir(), 'pulse-cache') : path.join(process.cwd(), '.cache');
  return path.join(base, ...parts);
}
