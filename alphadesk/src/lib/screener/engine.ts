/**
 * Smart Screener filter engine. Pure (no server deps) — safe to import from client and tests.
 *
 *   const state = parseFilters(json);              // zod-validated, defaults filled
 *   const { rows, total } = runScreen(allRows, state, sort, { maxFilters: 3, maxRows: 25, today });
 */
import { z } from 'zod';
import type { CatalystType, ScreenRow } from '@/lib/data/types';

// ───────────────────────────── schema ─────────────────────────────

export const rangeSchema = z
  .object({ min: z.number().finite().nullable().optional(), max: z.number().finite().nullable().optional() })
  .strict();
export type Range = z.infer<typeof rangeSchema>;

export const MARKET_CAP_BUCKETS = ['mega', 'large', 'mid', 'small', 'micro'] as const;
export type MarketCapBucket = (typeof MARKET_CAP_BUCKETS)[number];
/** [min inclusive, max exclusive] in USD */
export const MARKET_CAP_BOUNDS: Record<MarketCapBucket, { label: string; min: number; max: number }> = {
  mega: { label: 'Mega (≥ $200B)', min: 200e9, max: Infinity },
  large: { label: 'Large ($10B–200B)', min: 10e9, max: 200e9 },
  mid: { label: 'Mid ($2B–10B)', min: 2e9, max: 10e9 },
  small: { label: 'Small ($300M–2B)', min: 300e6, max: 2e9 },
  micro: { label: 'Micro (< $300M)', min: 0, max: 300e6 },
};

export const CATALYST_FILTERS = ['fda', 'investor_day', 'product', 'dividend', 'conference', 'macro', 'earnings'] as const satisfies readonly CatalystType[];

/** Numeric range filters: key → ScreenRow field. */
export const RANGE_FIELDS = {
  pe: 'pe',
  evEbitda: 'evEbitda',
  revenueGrowth: 'revenueGrowth',
  epsRevision30d: 'epsRevision30d',
  shortInterestPct: 'shortInterestPct',
  esgScore: 'esgScore',
  changePct: 'changePct',
  price: 'price',
} as const satisfies Record<string, keyof ScreenRow>;
export type RangeKey = keyof typeof RANGE_FIELDS;
export const RANGE_KEYS = Object.keys(RANGE_FIELDS) as RangeKey[];

export const filterStateSchema = z.object({
  q: z.string().trim().max(80).optional(),
  marketCap: z.array(z.enum(MARKET_CAP_BUCKETS)).max(5).optional(),
  sector: z.array(z.string().max(60)).max(20).optional(),
  industry: z.array(z.string().max(80)).max(60).optional(),
  country: z.array(z.string().max(40)).max(40).optional(),
  pe: rangeSchema.optional(),
  evEbitda: rangeSchema.optional(),
  revenueGrowth: rangeSchema.optional(),
  epsRevision30d: rangeSchema.optional(),
  shortInterestPct: rangeSchema.optional(),
  esgScore: rangeSchema.optional(),
  changePct: rangeSchema.optional(),
  price: rangeSchema.optional(),
  /** true = net insider buying > 0 over 90d; false = net selling (< 0) */
  insiderBuying: z.boolean().optional(),
  /** next earnings date within N calendar days of today */
  earningsWithinDays: z.number().int().min(0).max(365).optional(),
  /** row must carry ANY of these upcoming catalyst flags */
  catalysts: z.array(z.enum(CATALYST_FILTERS)).max(CATALYST_FILTERS.length).optional(),
});
export type FilterState = z.infer<typeof filterStateSchema>;
export type FilterKey = keyof FilterState;

export const SORTABLE_KEYS = [
  'ticker', 'name', 'sector', 'industry', 'country', 'marketCap', 'price', 'changePct', 'pe', 'evEbitda',
  'revenueGrowth', 'epsRevision30d', 'shortInterestPct', 'insiderBuying90d', 'esgScore', 'nextEarnings',
] as const satisfies readonly (keyof ScreenRow)[];
export type SortKey = (typeof SORTABLE_KEYS)[number];
export const sortSchema = z.array(z.object({ id: z.enum(SORTABLE_KEYS), desc: z.boolean() })).max(5);
export type SortSpec = z.infer<typeof sortSchema>;

export const DEFAULT_SORT: SortSpec = [{ id: 'marketCap', desc: true }];

/** Re-apply the key order of the raw input (zod emits schema order) so "first N filters" means first added. */
function keepOrder(parsed: FilterState, raw: unknown): FilterState {
  if (!raw || typeof raw !== 'object') return parsed;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (k in parsed) out[k] = parsed[k as FilterKey];
  for (const k of Object.keys(parsed)) if (!(k in out)) out[k] = parsed[k as FilterKey];
  return out as FilterState;
}

/**
 * Map legacy/seeded filter shapes onto the current schema (key order preserved):
 *   insiderBuying90d: { min: 0 }        → insiderBuying: true   ({ max: 0 } → false)
 *   catalystFlags: { any: [...] } | [...] → catalysts: [...]
 */
export function migrateLegacyFilters(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (k === 'insiderBuying90d' && v && typeof v === 'object') {
      const r = v as Range;
      if (r.min != null && r.min >= 0) out.insiderBuying = true;
      else if (r.max != null && r.max <= 0) out.insiderBuying = false;
    } else if (k === 'catalystFlags') {
      const list = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as { any?: unknown }).any) ? (v as { any: unknown[] }).any : [];
      const valid = list.filter((x): x is (typeof CATALYST_FILTERS)[number] => (CATALYST_FILTERS as readonly unknown[]).includes(x));
      if (valid.length) out.catalysts = valid;
    } else out[k] = v;
  }
  return out;
}

/** Validate filters, preserving the caller's key order. Returns zod issues on failure. */
export function safeParseFilters(raw: unknown): { ok: true; filters: FilterState } | { ok: false; issues: unknown } {
  const input = migrateLegacyFilters(raw);
  const r = filterStateSchema.safeParse(input ?? {});
  return r.success ? { ok: true, filters: normalizeFilters(keepOrder(r.data, input)) } : { ok: false, issues: r.error.issues };
}

/** Parse unknown JSON into a FilterState; invalid input → empty filters (never throws). */
export function parseFilters(input: unknown): FilterState {
  const r = safeParseFilters(input);
  return r.ok ? r.filters : {};
}
export function parseSort(input: unknown): SortSpec {
  const r = sortSchema.safeParse(input ?? []);
  return r.success && r.data.length ? r.data : DEFAULT_SORT;
}

/** Drop empty/no-op entries so key counting and cache keys are stable. Preserves insertion order. */
export function normalizeFilters(f: FilterState): FilterState {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const r = v as Range;
      const min = r.min ?? null;
      const max = r.max ?? null;
      if (min === null && max === null) continue;
      out[k] = { ...(min !== null ? { min } : {}), ...(max !== null ? { max } : {}) };
      continue;
    }
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out as FilterState;
}

/** Active filter keys in insertion order. Text search counts as a filter. */
export function activeFilterKeys(f: FilterState): FilterKey[] {
  return Object.keys(normalizeFilters(f)) as FilterKey[];
}

/** Keep only the first `max` active filters (insertion order). Returns what was dropped so the UI can explain. */
export function capFilters(f: FilterState, max: number): { applied: FilterState; dropped: FilterKey[] } {
  const n = normalizeFilters(f);
  const keys = Object.keys(n) as FilterKey[];
  if (keys.length <= max) return { applied: n, dropped: [] };
  const applied: Record<string, unknown> = {};
  keys.slice(0, max).forEach((k) => (applied[k] = n[k]));
  return { applied: applied as FilterState, dropped: keys.slice(max) };
}

// ───────────────────────────── predicates ─────────────────────────────

export function inRange(v: number | null | undefined, r: Range | undefined): boolean {
  if (!r) return true;
  if (v == null || !Number.isFinite(v)) return r.min == null && r.max == null;
  if (r.min != null && v < r.min) return false;
  if (r.max != null && v > r.max) return false;
  return true;
}

export function marketCapBucket(cap: number): MarketCapBucket {
  for (const b of MARKET_CAP_BUCKETS) {
    const { min, max } = MARKET_CAP_BOUNDS[b];
    if (cap >= min && cap < max) return b;
  }
  return 'micro';
}

const DAY = 86_400_000;
/** Whole days from `today` (UTC date) to ISO date `d`; NaN when unparsable. */
export function daysUntil(d: string, today: Date): number {
  if (!d) return NaN;
  const t = Date.parse(d.length === 10 ? `${d}T00:00:00Z` : d);
  if (Number.isNaN(t)) return NaN;
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((t - base) / DAY);
}

const lc = (s: string) => s.toLowerCase();
const inSet = (v: string, set: string[] | undefined) => !set?.length || set.some((x) => lc(x) === lc(v));

export function matchesRow(row: ScreenRow, f: FilterState, today: Date = new Date()): boolean {
  if (f.q) {
    const q = lc(f.q);
    const hay = `${row.ticker} ${row.name} ${row.industry} ${row.sector} ${row.whyNow?.headline ?? ''}`;
    if (!lc(hay).includes(q)) return false;
  }
  if (f.marketCap?.length && !f.marketCap.includes(marketCapBucket(row.marketCap))) return false;
  if (!inSet(row.sector, f.sector)) return false;
  if (!inSet(row.industry, f.industry)) return false;
  if (!inSet(row.country, f.country)) return false;
  for (const k of RANGE_KEYS) {
    const r = f[k];
    if (r && !inRange(row[RANGE_FIELDS[k]] as number, r)) return false;
  }
  if (f.insiderBuying === true && !(row.insiderBuying90d > 0)) return false;
  if (f.insiderBuying === false && !(row.insiderBuying90d < 0)) return false;
  if (f.earningsWithinDays != null) {
    const d = daysUntil(row.nextEarnings, today);
    if (!(d >= 0 && d <= f.earningsWithinDays)) return false;
  }
  if (f.catalysts?.length && !f.catalysts.some((c) => row.catalystFlags?.includes(c))) return false;
  return true;
}

// ───────────────────────────── sorting ─────────────────────────────

function cmp(a: unknown, b: unknown): number {
  const an = a == null || (typeof a === 'number' && !Number.isFinite(a)) || a === '';
  const bn = b == null || (typeof b === 'number' && !Number.isFinite(b)) || b === '';
  if (an && bn) return 0;
  if (an) return 1; // nulls last regardless of direction (handled by caller)
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/** Stable multi-key sort; missing values always sort last. Ticker is the final tiebreaker. */
export function sortRows<T extends ScreenRow>(rows: T[], sort: SortSpec): T[] {
  const keys = [...sort, { id: 'ticker' as SortKey, desc: false }];
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      for (const { id, desc } of keys) {
        const a = x.r[id];
        const b = y.r[id];
        const aMissing = a == null || a === '' || (typeof a === 'number' && !Number.isFinite(a));
        const bMissing = b == null || b === '' || (typeof b === 'number' && !Number.isFinite(b));
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        const c = cmp(a, b);
        if (c !== 0) return desc ? -c : c;
      }
      return x.i - y.i;
    })
    .map((x) => x.r);
}

// ───────────────────────────── run + plan caps ─────────────────────────────

export interface ScreenerLimits { maxFilters: number; maxRows: number }
export const SCREENER_LIMITS: Record<'FREE' | 'PRO' | 'PRO_PLUS', ScreenerLimits> = {
  FREE: { maxFilters: 3, maxRows: 25 },
  PRO: { maxFilters: Infinity, maxRows: 500 },
  PRO_PLUS: { maxFilters: Infinity, maxRows: 1000 },
};
export function screenerLimits(plan: string | null | undefined): ScreenerLimits {
  return plan === 'PRO' || plan === 'PRO_PLUS' ? SCREENER_LIMITS[plan] : SCREENER_LIMITS.FREE;
}

export interface RunOptions extends Partial<ScreenerLimits> { limit?: number; today?: Date }
export interface RunResult<T> {
  rows: T[];
  /** rows matching the applied filters (before row cap) */
  matched: number;
  /** universe size */
  universe: number;
  applied: FilterState;
  droppedFilters: FilterKey[];
  /** true when the plan's row cap cut the result */
  rowCapped: boolean;
}

export function runScreen<T extends ScreenRow>(all: T[], filters: FilterState, sort: SortSpec = DEFAULT_SORT, opts: RunOptions = {}): RunResult<T> {
  const maxFilters = opts.maxFilters ?? Infinity;
  const maxRows = opts.maxRows ?? Infinity;
  const { applied, dropped } = capFilters(filters, maxFilters);
  const today = opts.today ?? new Date();
  const matched = sortRows(all.filter((r) => matchesRow(r, applied, today)), sort);
  const requested = opts.limit ?? Infinity;
  const take = Math.min(requested, maxRows);
  return {
    rows: matched.slice(0, take),
    matched: matched.length,
    universe: all.length,
    applied,
    droppedFilters: dropped,
    rowCapped: matched.length > maxRows && requested > maxRows,
  };
}

// ───────────────────────────── saved screens ─────────────────────────────

export interface ScreenDefinition { filters: FilterState; columns: string[]; sort: SortSpec }

/** Serialise to the SavedScreen repo input shape. */
export function toSavedScreen(name: string, def: ScreenDefinition, description?: string | null) {
  return {
    name: name.trim().slice(0, 80),
    description: description ?? null,
    filters: normalizeFilters(def.filters) as Record<string, unknown>,
    columns: def.columns.slice(0, 40),
    sort: def.sort,
  };
}
/** Parse a SavedScreen DTO (or share snapshot) back into a definition; tolerant of bad data. */
export function fromSavedScreen(s: { filters?: unknown; columns?: unknown; sort?: unknown }): ScreenDefinition {
  return {
    filters: parseFilters(s.filters),
    columns: Array.isArray(s.columns) ? s.columns.filter((c): c is string => typeof c === 'string') : [],
    sort: parseSort(s.sort),
  };
}

/** Deterministic key for caching identical queries. */
export function screenCacheKey(filters: FilterState, sort: SortSpec, limit: number): string {
  const f = normalizeFilters(filters);
  const ordered = Object.keys(f).sort().map((k) => [k, f[k as FilterKey]]);
  return JSON.stringify([ordered, sort, limit]);
}

// ───────────────────────────── presets + labels ─────────────────────────────

export interface Preset { id: string; label: string; description: string; filters: FilterState; sort: SortSpec }
export const PRESETS: Preset[] = [
  {
    id: 'quality-compounders',
    label: 'Quality compounders',
    description: 'Large/mega caps growing revenue > 8% with positive estimate revisions and reasonable P/E.',
    filters: { marketCap: ['mega', 'large'], revenueGrowth: { min: 8 }, epsRevision30d: { min: 0 }, pe: { max: 40 } },
    sort: [{ id: 'revenueGrowth', desc: true }],
  },
  {
    id: 'insider-catalyst',
    label: 'Insider buying + upcoming catalyst',
    description: 'Net insider buying over 90 days and earnings within 45 days.',
    filters: { insiderBuying: true, earningsWithinDays: 45 },
    sort: [{ id: 'insiderBuying90d', desc: true }],
  },
  {
    id: 'short-squeeze',
    label: 'Short squeeze watch',
    description: 'Highest short interest in the universe (≥ 1.5% of float) with upward EPS revisions.',
    filters: { shortInterestPct: { min: 1.5 }, epsRevision30d: { min: 0 } },
    sort: [{ id: 'shortInterestPct', desc: true }],
  },
  {
    id: 'cheap-growth',
    label: 'Cheap growth',
    description: 'P/E under 25 with revenue growing faster than 10%.',
    filters: { pe: { min: 0, max: 25 }, revenueGrowth: { min: 10 } },
    sort: [{ id: 'pe', desc: false }],
  },
];

export const FILTER_LABELS: Record<FilterKey, string> = {
  q: 'Search', marketCap: 'Market cap', sector: 'Sector', industry: 'Industry', country: 'Country',
  pe: 'P/E', evEbitda: 'EV/EBITDA', revenueGrowth: 'Revenue growth %', epsRevision30d: 'EPS revision 30d %',
  shortInterestPct: 'Short interest %', esgScore: 'ESG score', changePct: 'Day change %', price: 'Price',
  insiderBuying: 'Insider activity 90d', earningsWithinDays: 'Earnings within', catalysts: 'Catalysts',
};
export const CATALYST_LABELS: Record<(typeof CATALYST_FILTERS)[number], string> = {
  fda: 'FDA decision', investor_day: 'Investor day', product: 'Product launch', dividend: 'Dividend',
  conference: 'Conference', macro: 'Macro event', earnings: 'Earnings (45d)',
};

/** Short human summary of one filter value, e.g. "P/E ≤ 25". */
export function describeFilter(key: FilterKey, f: FilterState): string {
  const label = FILTER_LABELS[key];
  const v = f[key];
  if (v === undefined) return label;
  if (key === 'q') return `“${v as string}”`;
  if (key === 'marketCap') return `${label}: ${(v as string[]).join(', ')}`;
  if (key === 'insiderBuying') return v ? 'Insider net buying 90d' : 'Insider net selling 90d';
  if (key === 'earningsWithinDays') return `Earnings ≤ ${v}d`;
  if (key === 'catalysts') return (v as (keyof typeof CATALYST_LABELS)[]).map((c) => CATALYST_LABELS[c]).join(' or ');
  if (Array.isArray(v)) return v.length === 1 ? v[0] : `${label}: ${v.length} selected`;
  const r = v as Range;
  if (r.min != null && r.max != null) return `${label} ${r.min}–${r.max}`;
  if (r.min != null) return `${label} ≥ ${r.min}`;
  return `${label} ≤ ${r.max}`;
}
