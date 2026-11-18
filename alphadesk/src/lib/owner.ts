/**
 * Who may open Settings (plans, team, API keys, data sources, audit, data export).
 * When PULSE_OWNER_EMAIL is set (production), ONLY that account. Without it (local development), any ADMIN.
 * Always evaluated on the server from the DB-backed session user — never from client input.
 */
export function canAccessSettings(user: { email?: string | null; role?: string | null } | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!user) return false;
  const owner = env.PULSE_OWNER_EMAIL?.trim().toLowerCase();
  if (owner) return !!user.email && user.email.trim().toLowerCase() === owner;
  return user.role === 'ADMIN';
}
