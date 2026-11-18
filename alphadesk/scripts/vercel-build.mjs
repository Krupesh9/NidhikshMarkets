#!/usr/bin/env node
/**
 * Vercel build: production uses Postgres (Supabase or Neon) instead of the local SQLite file.
 * Pulse's tables live in their own Postgres schema ("pulse" by default), so pointing DATABASE_URL at a database
 * that other apps use never touches their tables.
 * 1. Write prisma/postgres.generated.prisma = prisma/schema.prisma with the datasource switched to postgresql.
 * 2. prisma generate + prisma db push into the pulse schema only (refuses changes that would lose data).
 * 3. next build.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pulseDbUrl, pulseDirectUrl } from '../src/lib/db-url.mjs';

if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) {
  console.error('DATABASE_URL must be a Postgres URL on Vercel (Supabase or Neon).');
  process.exit(1);
}
const env = { ...process.env, DATABASE_URL: pulseDbUrl(process.env.DATABASE_URL) };
const direct = pulseDirectUrl();
if (direct) env.PULSE_DIRECT_URL = direct;
const schema = readFileSync('prisma/schema.prisma', 'utf8').replace(
  /datasource db \{[\s\S]*?\}/,
  `datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")${direct ? '\n  directUrl = env("PULSE_DIRECT_URL")' : ''}\n}`,
);
writeFileSync('prisma/postgres.generated.prisma', schema);
console.log(`Pulse database schema: ${new URL(env.DATABASE_URL).searchParams.get('schema')} (other schemas are never modified)`);
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env });
run('npx prisma generate --schema prisma/postgres.generated.prisma');
run('npx prisma db push --schema prisma/postgres.generated.prisma --skip-generate');
run('npx next build');
