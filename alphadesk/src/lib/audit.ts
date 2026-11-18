import 'server-only';
import { db } from './db';
import { log } from './log';

export interface AuditEvent {
  orgId: string;
  userId?: string | null;
  /** e.g. 'ai.query', 'data.company.view', 'share.create', 'settings.plan.change' */
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
  correlationId?: string | null;
}

/** Fire-and-forget audit write; never throws. Do not put secrets in meta. */
export function audit(e: AuditEvent): void {
  db.auditLog
    .create({ data: { orgId: e.orgId, userId: e.userId ?? null, action: e.action, target: e.target ?? null, meta: JSON.stringify(e.meta ?? {}), correlationId: e.correlationId ?? null } })
    .catch((err: Error) => log.warn('audit.write_failed', { action: e.action, err: err.message }));
}

export async function auditAsync(e: AuditEvent): Promise<void> {
  try {
    await db.auditLog.create({ data: { orgId: e.orgId, userId: e.userId ?? null, action: e.action, target: e.target ?? null, meta: JSON.stringify(e.meta ?? {}), correlationId: e.correlationId ?? null } });
  } catch (err) {
    log.warn('audit.write_failed', { action: e.action, err: (err as Error).message });
  }
}
