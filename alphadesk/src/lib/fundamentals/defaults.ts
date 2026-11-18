// Owner-editable valuation model defaults (Settings → Valuation defaults). Client-safe: shared by the server
// (build/load, settings API) and the Settings form (same zod schema validates on both sides).
// All rates and growth figures are PERCENT numbers (8.5 = 8.5%) unless noted.
import { z } from 'zod';
import { DCF_YEARS, DEFAULT_ERP, GRAHAM_CONSTANTS, GROWTH_CAP, PEG_THRESHOLDS } from './formulas';

/** AppSetting.key for the org-wide valuation defaults. */
export const VALUATION_SETTING_KEY = 'valuation.defaults';

/**
 * Sane bounds for every editable default (inclusive). Documented here once; the schema and the Settings form both
 * read them. `null` in a nullable field means "use the live value" (FRED).
 */
export const VALUATION_BOUNDS = {
  fixedGrowth: { min: -10, max: 30 },
  growthCapMin: { min: -50, max: 0 },
  growthCapMax: { min: 5, max: 60 },
  erp: { min: 2, max: 12 },
  riskFreeOverride: { min: 0, max: 15 },
  fixedDiscount: { min: 3, max: 25 },
  terminal: { min: -2, max: 5 },
  rangeGrowth: { min: -30, max: 60 },
  rangeDiscount: { min: 1, max: 30 },
  rangeTerminal: { min: -3, max: 6 },
  requiredMos: { min: 0, max: 90 },
  grahamFixedGrowth: { min: 0, max: 30 },
  basePe: { min: 0, max: 30 },
  growthMultiplier: { min: 0, max: 5 },
  baseYield: { min: 0.5, max: 15 },
  aaaOverride: { min: 0.5, max: 20 },
  pegFairFrom: { min: 0.1, max: 5 },
  pegRichAbove: { min: 0.5, max: 10 },
} as const;
export type BoundKey = keyof typeof VALUATION_BOUNDS;

const num = (k: BoundKey) => z.number({ error: 'Enter a number' }).finite().min(VALUATION_BOUNDS[k].min).max(VALUATION_BOUNDS[k].max);
const range = (k: BoundKey) => z.tuple([num(k), num(k)]).refine(([a, b]) => a < b, 'The range minimum must be below its maximum');

export const valuationDefaultsSchema = z.object({
  dcf: z.object({
    /** model = consensus / historical growth estimate (capped); fixed = `fixedGrowth` for every company */
    growthMode: z.enum(['model', 'fixed']),
    fixedGrowth: num('fixedGrowth'),
    growthCapMin: num('growthCapMin'),
    growthCapMax: num('growthCapMax'),
    /** capm = risk-free + β × ERP; fixed = `fixedDiscount` for every company */
    discountMode: z.enum(['capm', 'fixed']),
    erp: num('erp'),
    /** null = live 10-year Treasury (FRED DGS10) */
    riskFreeOverride: num('riskFreeOverride').nullable(),
    fixedDiscount: num('fixedDiscount'),
    terminal: num('terminal'),
    /** slider ranges on the company page, [min, max] percent */
    ranges: z.object({ growth: range('rangeGrowth'), discount: range('rangeDiscount'), terminal: range('rangeTerminal') }).strict(),
  }).strict().superRefine((d, ctx) => {
    if (d.discountMode === 'fixed' && d.fixedDiscount <= d.terminal) ctx.addIssue({ code: 'custom', path: ['fixedDiscount'], message: 'Fixed discount rate must exceed terminal growth (otherwise the terminal value is infinite)' });
  }),
  graham: z.object({
    requiredMos: num('requiredMos'),
    /** model = g from consensus / history (capped, floored at 0); fixed = `fixedGrowth` */
    growthMode: z.enum(['model', 'fixed']),
    fixedGrowth: num('grahamFixedGrowth'),
    /** P/E for a no-growth company (Graham: 8.5) */
    basePe: num('basePe'),
    /** multiplier on g (Graham: 2) */
    growthMultiplier: num('growthMultiplier'),
    /** AAA yield when Graham published (4.4) */
    baseYield: num('baseYield'),
    /** null = live Moody's Aaa yield (FRED DAAA) */
    aaaOverride: num('aaaOverride').nullable(),
  }).strict(),
  peg: z.object({
    /** PEG below this = "below 1" band */
    fairFrom: num('pegFairFrom'),
    /** PEG above this = "rich" band */
    richAbove: num('pegRichAbove'),
  }).strict().refine((p) => p.fairFrom < p.richAbove, { message: 'The "rich above" threshold must exceed the "fair from" threshold', path: ['richAbove'] }),
}).strict();

export type ValuationDefaults = z.infer<typeof valuationDefaultsSchema>;

/**
 * Factory defaults (set by the owner, Nov 2026): DCF growth fixed 10%, discount fixed 10%, terminal 2%, required
 * margin of safety 20%. The model-derived modes (consensus/history growth, CAPM discount) stay available in Settings.
 * Graham g stays model-derived. Formula constants (8.5 / 2 / 4.4, growth cap, PEG 1 / 2) are Graham's originals.
 */
export const FACTORY_VALUATION_DEFAULTS: ValuationDefaults = Object.freeze({
  dcf: {
    growthMode: 'fixed', fixedGrowth: 10, growthCapMin: GROWTH_CAP.min, growthCapMax: GROWTH_CAP.max,
    discountMode: 'fixed', erp: DEFAULT_ERP, riskFreeOverride: null, fixedDiscount: 10, terminal: 2,
    ranges: { growth: [0, 25], discount: [6, 14], terminal: [0, 4] },
  },
  graham: { requiredMos: 20, growthMode: 'model', fixedGrowth: 7, basePe: GRAHAM_CONSTANTS.basePe, growthMultiplier: GRAHAM_CONSTANTS.growthMultiplier, baseYield: GRAHAM_CONSTANTS.baseYield, aaaOverride: null },
  peg: { fairFrom: PEG_THRESHOLDS.fairFrom, richAbove: PEG_THRESHOLDS.richAbove },
}) as ValuationDefaults;

/** Read-only in Settings: the DCF projection horizon. */
export const PROJECTION_YEARS = DCF_YEARS;

export function factoryDefaults(): ValuationDefaults {
  return JSON.parse(JSON.stringify(FACTORY_VALUATION_DEFAULTS)) as ValuationDefaults;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merge `over` onto `base`, keeping only keys `base` knows (arrays/scalars replace). */
function mergeKnown(base: unknown, over: unknown): unknown {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(base)) out[k] = k in over ? mergeKnown(base[k], over[k]) : base[k];
  return out;
}

/**
 * Stored JSON (string or object) → ValuationDefaults. Missing keys fall back to factory values (so settings saved
 * before a new field was added keep working); anything invalid → factory defaults. Never throws.
 */
export function parseValuationDefaults(raw: unknown): { defaults: ValuationDefaults; valid: boolean } {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return { defaults: factoryDefaults(), valid: false }; } }
  if (!isObj(v)) return { defaults: factoryDefaults(), valid: false };
  const parsed = valuationDefaultsSchema.safeParse(mergeKnown(factoryDefaults(), v));
  return parsed.success ? { defaults: parsed.data, valid: true } : { defaults: factoryDefaults(), valid: false };
}

/** True when two defaults objects are equal (used for the "Factory defaults" badge / unsaved indicator). */
export function sameDefaults(a: ValuationDefaults, b: ValuationDefaults): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ------------------------------------------------------------------ user presets (per user, per ticker)

/** Bounds for a user's saved assumptions (wider than the slider ranges; the sliders widen to include saved values). */
export const PRESET_BOUNDS = {
  growth: { min: -50, max: 100 },
  discount: { min: 0.5, max: 50 },
  terminal: { min: -5, max: 10 },
  requiredMos: { min: 0, max: 90 },
} as const;
const pnum = (k: keyof typeof PRESET_BOUNDS) => z.number().finite().min(PRESET_BOUNDS[k].min).max(PRESET_BOUNDS[k].max);

export const presetBodySchema = z.object({
  growth: pnum('growth'),
  discount: pnum('discount'),
  terminal: pnum('terminal'),
  requiredMos: pnum('requiredMos'),
  note: z.string().trim().max(280).optional().nullable(),
}).strict().refine((p) => p.discount > p.terminal, { message: 'Discount rate must exceed terminal growth', path: ['discount'] });

export const preferencesBodySchema = z.object({ requiredMos: pnum('requiredMos') }).strict();

export interface SavedPreset {
  ticker: string;
  growth: number;
  discount: number;
  terminal: number;
  requiredMos: number;
  note: string | null;
  updatedAt: string;
}
