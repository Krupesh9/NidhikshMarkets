/**
 * Pure helpers shared by scripts/export-data.mjs and scripts/import-data.mjs (unit-tested in
 * src/lib/__tests__/data-portability.test.ts). No I/O here.
 */

export const EXPORT_VERSION = 1;

/**
 * Prisma model delegates included in an export, in dependency order. Deliberately EXCLUDED: Account, Session,
 * VerificationToken, ApiCredential (secrets), AuditLog, UsageCounter, FeedItem, DocumentChunk.
 */
export const EXPORT_MODELS = [
  ['organizations', 'organization'],
  ['users', 'user'],
  ['watchlists', 'watchlist'],
  ['savedScreens', 'savedScreen'],
  ['portfolios', 'portfolio'],
  ['positions', 'position'],
  ['baskets', 'basket'],
  ['basketHoldings', 'basketHolding'],
  ['researchNotes', 'researchNote'],
  ['chatThreads', 'chatThread'],
  ['chatMessages', 'chatMessage'],
  ['shares', 'share'],
  ['comments', 'comment'],
];

/** User columns that are safe to export (never tokens/credentials). */
export const USER_FIELDS = ['id', 'orgId', 'email', 'name', 'role', 'plan', 'image', 'createdAt'];

/** Retired $50 "PRO" tier → the single paid plan. Anything unknown → FREE. */
export function normalizePlan(p) {
  return p === 'PRO_PLUS' || p === 'PRO' ? 'PRO_PLUS' : 'FREE';
}
export function normalizeRole(r) {
  return r === 'ADMIN' || r === 'VIEWER' ? r : r === 'ANALYST' ? 'ANALYST' : 'VIEWER';
}

/** Seeded demo accounts whose content is re-homed to the owner on import. */
export const isDemoEmail = (email) => /@nidhikshdesk\.dev$/i.test(String(email ?? '')) || /@example\.(com|org)$/i.test(String(email ?? ''));

/** Parse `email:PLAN:ROLE` (PLAN/ROLE optional; defaults FREE / VIEWER). */
export function parseAddUser(spec) {
  const [email, plan, role] = String(spec).split(':');
  const e = (email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error(`--add-user: invalid email in "${spec}"`);
  return { email: e, plan: normalizePlan((plan ?? 'FREE').toUpperCase()), role: normalizeRole((role ?? 'VIEWER').toUpperCase()) };
}

const parseArr = (v) => {
  if (Array.isArray(v)) return v;
  try { const x = JSON.parse(v ?? '[]'); return Array.isArray(x) ? x : []; } catch { return []; }
};

/** Union of symbols, upper-cased, order-preserving, deduped. */
export function mergeSymbols(...lists) {
  const out = [];
  const seen = new Set();
  for (const l of lists) for (const s of parseArr(l)) {
    const t = String(s).trim().toUpperCase();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

/**
 * Re-home exported content into the target org.
 *   - demo users' content → ownerId; real (non-demo) users keep their content and are imported themselves.
 *   - every row's orgId → targetOrgId.
 *   - watchlists with the same (user, name) are merged; symbols deduped.
 * Returns { users, rows: { watchlists, savedScreens, ... } } ready for upserts (ids preserved → idempotent).
 */
export function planImport(data, { targetOrgId, ownerId, ownerEmail }) {
  const owner = String(ownerEmail).toLowerCase();
  const userMap = new Map(); // exported user id → target user id
  const users = [];
  for (const u of data.users ?? []) {
    const email = String(u.email).toLowerCase();
    if (email === owner || isDemoEmail(email)) { userMap.set(u.id, ownerId); continue; }
    userMap.set(u.id, u.id);
    users.push({ id: u.id, email, name: u.name ?? null, image: u.image ?? null, role: normalizeRole(u.role), plan: normalizePlan(u.plan), orgId: targetOrgId });
  }
  const who = (id) => userMap.get(id) ?? ownerId;
  const org = (r) => ({ ...r, orgId: targetOrgId });

  const wl = new Map();
  for (const w of data.watchlists ?? []) {
    const userId = who(w.userId);
    const key = `${userId}::${w.name}`;
    const cur = wl.get(key);
    if (cur) cur.symbols = mergeSymbols(cur.symbols, w.symbols);
    else wl.set(key, { ...org(w), userId, symbols: mergeSymbols(w.symbols) });
  }

  return {
    users,
    rows: {
      watchlists: [...wl.values()],
      savedScreens: (data.savedScreens ?? []).map((r) => ({ ...org(r), userId: who(r.userId) })),
      portfolios: (data.portfolios ?? []).map((r) => ({ ...org(r), userId: who(r.userId) })),
      positions: (data.positions ?? []).map(org),
      baskets: (data.baskets ?? []).map((r) => ({ ...org(r), userId: who(r.userId) })),
      basketHoldings: (data.basketHoldings ?? []).map(org),
      researchNotes: (data.researchNotes ?? []).map((r) => ({ ...org(r), authorId: who(r.authorId) })),
      chatThreads: (data.chatThreads ?? []).map((r) => ({ ...org(r), userId: who(r.userId) })),
      chatMessages: (data.chatMessages ?? []).map(org),
      shares: (data.shares ?? []).map((r) => ({ ...org(r), createdById: who(r.createdById) })),
      comments: (data.comments ?? []).map((r) => ({ ...org(r), authorId: who(r.authorId) })),
    },
  };
}

/** Model delegate per planned row group (import order: parents before children). */
export const IMPORT_ORDER = [
  ['watchlists', 'watchlist'], ['savedScreens', 'savedScreen'], ['portfolios', 'portfolio'], ['positions', 'position'],
  ['baskets', 'basket'], ['basketHoldings', 'basketHolding'], ['researchNotes', 'researchNote'], ['chatThreads', 'chatThread'],
  ['chatMessages', 'chatMessage'], ['shares', 'share'], ['comments', 'comment'],
];

/**
 * Adapt a row to the target schema: JSON-ish string columns become native objects when the target field is `Json`
 * (prisma/postgres/schema.prisma), and stay strings when it is `String` (the Vercel build schema).
 * `fieldTypes` = { fieldName: 'String' | 'Json' | 'DateTime' | ... } for the model; unknown fields are dropped.
 */
export function adaptRow(row, fieldTypes) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const t = fieldTypes[k];
    if (!t) continue;
    if (t === 'Json' && typeof v === 'string') { try { out[k] = JSON.parse(v); } catch { out[k] = v; } }
    else if (t === 'String' && v !== null && typeof v === 'object') out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}

export function countsOf(data) {
  return Object.fromEntries(EXPORT_MODELS.map(([k]) => [k, (data[k] ?? []).length]));
}
