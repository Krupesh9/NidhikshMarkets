#!/usr/bin/env node
/**
 * Import a Pulse export (scripts/export-data.mjs) into a target database. Idempotent: rows keep their ids and are
 * upserted, watchlists are merged by (user, name) with symbols deduped, so running it twice changes nothing.
 *
 *   DATABASE_URL=postgresql://… DIRECT_URL=postgresql://… \
 *     node scripts/import-data.mjs --file data-export/pulse-export-2026-11-18.json --owner you@example.com [--dry-run]
 *
 * Options
 *   --file <json>              export file (required unless only --add-user is used)
 *   --owner <email>            owner account; created as ADMIN / Pro in the first org if missing. All demo users'
 *                              (…@nidhikshdesk.dev) content is re-homed to this account. Defaults to PULSE_OWNER_EMAIL.
 *   --add-user email:PLAN:ROLE upsert an extra user into the owner's org (repeatable). PLAN FREE|PRO_PLUS (PRO → PRO_PLUS),
 *                              ROLE ADMIN|ANALYST|VIEWER. e.g. --add-user analyst@fund.com:FREE:VIEWER
 *   --dry-run                  print what would happen; write nothing
 *
 * Target database
 *   - Postgres (Supabase / Neon): tables are created by the Vercel build (`scripts/vercel-build.mjs` → prisma db push into
 *     the `pulse` schema). Deploy once before importing. This script generates its own Prisma client for Postgres into
 *     .cache/prisma-import/ (it never overwrites the app's local SQLite client) and pins the `pulse` schema like the app.
 *   - SQLite (local testing, e.g. DATABASE_URL=file:./prod.db): uses the app's default Prisma client.
 * Plans: the retired PRO tier is mapped to PRO_PLUS ("Pro · $100/mo").
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pulseDbUrl, pulseDirectUrl } from '../src/lib/db-url.mjs';
import { IMPORT_ORDER, adaptRow, parseAddUser, planImport } from './lib/portability.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const vals = (n) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]] : []));

const dry = flag('--dry-run');
const file = val('--file');
const ownerEmail = (val('--owner') ?? process.env.PULSE_OWNER_EMAIL ?? '').trim().toLowerCase();
const addUsers = vals('--add-user').map(parseAddUser);
if (!ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) { console.error('Pass --owner you@example.com (or set PULSE_OWNER_EMAIL).'); process.exit(1); }
if (!file && !addUsers.length) { console.error('Pass --file <export.json> and/or --add-user email:PLAN:ROLE.'); process.exit(1); }
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) { console.error('Set DATABASE_URL to the target database (and DIRECT_URL for Supabase).'); process.exit(1); }
const isPg = /^postgres(ql)?:\/\//.test(rawUrl);

// ---------------------------------------------------------------- Prisma client for the target
async function loadClient() {
  if (!isPg) {
    const { PrismaClient, Prisma } = await import('@prisma/client');
    return { PrismaClient, Prisma, env: {} };
  }
  const dir = path.join(root, '.cache', 'prisma-import');
  const out = path.join(dir, 'client');
  const direct = pulseDirectUrl();
  const schema = readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8')
    .replace(/generator client \{[\s\S]*?\}/, `generator client {\n  provider = "prisma-client-js"\n  output   = ${JSON.stringify(out)}\n}`)
    .replace(/datasource db \{[\s\S]*?\}/, `datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")${direct ? '\n  directUrl = env("PULSE_DIRECT_URL")' : ''}\n}`);
  mkdirSync(dir, { recursive: true });
  const schemaFile = path.join(dir, 'schema.prisma');
  const prev = existsSync(schemaFile) ? readFileSync(schemaFile, 'utf8') : '';
  if (prev !== schema || !existsSync(path.join(out, 'index.js'))) {
    writeFileSync(schemaFile, schema);
    console.log('Generating a Postgres Prisma client in .cache/prisma-import (the app client is untouched)…');
    execSync(`npx prisma generate --schema ${JSON.stringify(schemaFile)}`, { stdio: ['ignore', 'ignore', 'inherit'], cwd: root });
  }
  const require = createRequire(import.meta.url);
  const mod = require(path.join(out, 'index.js'));
  return { PrismaClient: mod.PrismaClient, Prisma: mod.Prisma, env: {} };
}

const { PrismaClient, Prisma } = await loadClient();
const url = isPg ? pulseDbUrl(rawUrl) : rawUrl;
const db = new PrismaClient({ datasources: { db: { url } } });

/** scalar field types per model from the client's DMMF (so Json vs String columns are handled automatically) */
const fieldTypes = Object.fromEntries(
  Prisma.dmmf.datamodel.models.map((m) => [m.name.charAt(0).toLowerCase() + m.name.slice(1), Object.fromEntries(m.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => [f.name, f.type]))]),
);

const log = (...a) => console.log(dry ? '[dry-run]' : '', ...a);

try {
  const target = isPg ? `Postgres ${new URL(url).hostname} (schema ${new URL(url).searchParams.get('schema')})` : 'SQLite';
  console.log(`Target: ${target}${dry ? ' — DRY RUN, nothing will be written' : ''}`);

  // ---------------------------------------------------------------- org + owner
  let owner = await db.user.findUnique({ where: { email: ownerEmail } });
  let orgId = owner?.orgId;
  if (!orgId) {
    const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    orgId = org?.id;
  }
  const data = file ? JSON.parse(readFileSync(path.resolve(file), 'utf8')) : null;
  if (data && data.version !== 1) throw new Error(`Unsupported export version ${data.version}`);
  if (!orgId) {
    const src = data?.organizations?.[0];
    const org = { id: src?.id ?? undefined, name: src?.name ?? 'Nidhiksh', slug: src?.slug ?? 'nidhiksh', seats: src?.seats ?? 5 };
    log(`create organization "${org.name}"`);
    if (!dry) orgId = (await db.organization.create({ data: org })).id;
    else orgId = org.id ?? 'new-org';
  }
  if (!owner) {
    log(`create owner ${ownerEmail} (ADMIN, Pro)`);
    if (!dry) owner = await db.user.create({ data: { email: ownerEmail, name: process.env.PULSE_OWNER_NAME || ownerEmail.split('@')[0], orgId, role: 'ADMIN', plan: 'PRO_PLUS' } });
  } else if (owner.plan !== 'PRO_PLUS' || owner.role !== 'ADMIN') {
    log(`owner ${ownerEmail}: set ADMIN / Pro`);
    if (!dry) owner = await db.user.update({ where: { id: owner.id }, data: { role: 'ADMIN', plan: 'PRO_PLUS' } });
  } else log(`owner ${ownerEmail} exists`);
  const ownerId = owner?.id ?? 'owner';

  // ---------------------------------------------------------------- extra users
  const upsertUser = async (u, what) => {
    const ex = await db.user.findUnique({ where: { email: u.email } });
    if (ex && ex.orgId !== orgId) { console.warn(`  skip ${what}: email belongs to another org`); return; }
    log(`${ex ? 'update' : 'create'} ${what} (${u.plan}/${u.role})`);
    if (dry) return;
    if (ex) await db.user.update({ where: { id: ex.id }, data: { plan: u.plan, role: u.role } });
    else await db.user.create({ data: { ...(u.id ? { id: u.id } : {}), email: u.email, name: u.name ?? u.email.split('@')[0], image: u.image ?? null, orgId, role: u.role, plan: u.plan } });
  };
  for (const u of addUsers) await upsertUser(u, 'user from --add-user');

  // ---------------------------------------------------------------- content
  if (data) {
    const plan = planImport(data, { targetOrgId: orgId, ownerId, ownerEmail });
    for (const u of plan.users) await upsertUser(u, 'exported (non-demo) user');
    const summary = {};
    for (const [key, model] of IMPORT_ORDER) {
      let created = 0, updated = 0, skipped = 0;
      for (const raw of plan.rows[key]) {
        const row = adaptRow(raw, fieldTypes[model]);
        if (model === 'watchlist') {
          // merge into an existing (user, name) list, deduping symbols
          const ex = await db.watchlist.findFirst({ where: { userId: row.userId, name: row.name } });
          if (ex) {
            const cur = typeof ex.symbols === 'string' ? JSON.parse(ex.symbols || '[]') : ex.symbols ?? [];
            const inc = typeof row.symbols === 'string' ? JSON.parse(row.symbols) : row.symbols;
            const merged = [...new Set([...cur, ...inc].map((s) => String(s).toUpperCase()))];
            if (merged.length === cur.length) { skipped++; continue; }
            if (!dry) await db.watchlist.update({ where: { id: ex.id }, data: { symbols: fieldTypes.watchlist.symbols === 'Json' ? merged : JSON.stringify(merged) } });
            updated++;
            continue;
          }
        }
        if (model === 'share') {
          const clash = await db.share.findUnique({ where: { token: row.token } });
          if (clash && clash.id !== row.id) { skipped++; continue; }
        }
        const ex = await db[model].findUnique({ where: { id: row.id }, select: { id: true } });
        if (!dry) await db[model].upsert({ where: { id: row.id }, create: row, update: row });
        ex ? updated++ : created++;
      }
      summary[key] = { rows: plan.rows[key].length, created, updated, skipped };
    }
    console.log(`${dry ? '[dry-run] ' : ''}Content (all demo users' items → ${ownerEmail}):`);
    for (const [k, s] of Object.entries(summary)) console.log(`  ${k.padEnd(16)} ${String(s.rows).padStart(4)} rows · ${s.created} new · ${s.updated} updated · ${s.skipped} skipped`);
  }
  console.log(dry ? 'Dry run complete — nothing was written.' : 'Import complete.');
} catch (e) {
  console.error(`Import failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
