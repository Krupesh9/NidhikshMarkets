import 'server-only';
import { PrismaClient } from '@prisma/client';
import { pulseDbUrl } from './db-url.mjs';

const g = globalThis as unknown as { __prisma?: PrismaClient };

/** Prisma singleton (survives Next.js dev HMR). */
export const db: PrismaClient =
  g.__prisma ?? new PrismaClient({ datasourceUrl: pulseDbUrl(process.env.DATABASE_URL), log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
if (process.env.NODE_ENV !== 'production') g.__prisma = db;

export default db;
