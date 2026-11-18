#!/usr/bin/env node
/**
 * Export the local Pulse workspace (SQLite prisma/dev.db) to JSON so it can be carried into production.
 *   node scripts/export-data.mjs [--db prisma/dev.db] [--out data-export]
 * Writes data-export/pulse-export-<YYYY-MM-DD>.json (git-ignored — the repo is public, never commit it).
 * Included: organizations, users (id/email/name/role/plan/orgId/image/createdAt only), watchlists, saved screens,
 * portfolios + positions, baskets + holdings, research notes, chat threads + messages, shares + comments.
 * Excluded: sessions, OAuth accounts, verification tokens, API credentials, audit logs, usage counters.
 * Read-only: nothing is written to the database. Prints counts only.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { EXPORT_MODELS, EXPORT_VERSION, USER_FIELDS, countsOf } from './lib/portability.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const dbPath = path.resolve(root, arg('--db', 'prisma/dev.db'));
const outDir = path.resolve(root, arg('--out', 'data-export'));
if (!existsSync(dbPath)) { console.error(`No database at ${path.relative(root, dbPath)}`); process.exit(1); }

const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
const data = { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), source: 'sqlite' };
try {
  for (const [key, model] of EXPORT_MODELS) {
    const args = model === 'user' ? { select: Object.fromEntries(USER_FIELDS.map((f) => [f, true])) } : {};
    data[key] = await db[model].findMany({ ...args, orderBy: { createdAt: 'asc' } });
  }
} finally {
  await db.$disconnect();
}
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `pulse-export-${data.exportedAt.slice(0, 10)}.json`);
writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
console.log(`Wrote ${path.relative(root, file)}`);
for (const [k, n] of Object.entries(countsOf(data))) console.log(`  ${k.padEnd(16)} ${n}`);
