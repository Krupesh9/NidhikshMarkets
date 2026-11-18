#!/usr/bin/env node
/**
 * Vercel build: production uses Postgres (Neon) instead of the local SQLite file.
 * 1. Write prisma/postgres.generated.prisma = prisma/schema.prisma with the datasource switched to postgresql
 *    (same models and column types, so the app code is unchanged).
 * 2. prisma generate + prisma db push (creates/updates tables; no data loss for additive changes).
 * 3. next build.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
if (!process.env.DATABASE_URL?.startsWith('postgres')) {
  console.error('DATABASE_URL must be a Postgres URL on Vercel (add Neon from the Vercel Storage tab).');
  process.exit(1);
}
const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
const schema = readFileSync('prisma/schema.prisma', 'utf8').replace(
  /datasource db \{[\s\S]*?\}/,
  `datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")${direct ? '\n  directUrl = env("' + (process.env.DATABASE_URL_UNPOOLED ? 'DATABASE_URL_UNPOOLED' : 'POSTGRES_URL_NON_POOLING') + '")' : ''}\n}`,
);
writeFileSync('prisma/postgres.generated.prisma', schema);
run('npx prisma generate --schema prisma/postgres.generated.prisma');
run('npx prisma db push --schema prisma/postgres.generated.prisma --skip-generate');
run('npx next build');
