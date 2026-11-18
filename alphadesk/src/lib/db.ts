import 'server-only';
import { PrismaClient } from '@prisma/client';

const g = globalThis as unknown as { __prisma?: PrismaClient };

/** Prisma singleton (survives Next.js dev HMR). */
export const db: PrismaClient =
  g.__prisma ?? new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
if (process.env.NODE_ENV !== 'production') g.__prisma = db;

export default db;
