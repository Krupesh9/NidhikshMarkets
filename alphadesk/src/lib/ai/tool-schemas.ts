// Zod schemas for AI tools (pure). Every tool input from any model is validated against these before running.
import { z } from 'zod';
import { METRICS } from './intent';
import type { ToolSpec } from './types';

const ticker = z
  .string()
  .trim()
  .min(1)
  .max(10)
  .regex(/^[A-Za-z]{1,6}([.\-/][A-Za-z]{1,2})?$/, 'Ticker symbols only, e.g. AAPL or BRK.B')
  .transform((s) => s.toUpperCase().replace('/', '.'));

const metric = z.enum(METRICS as [string, ...string[]]);

export const TOOL_SCHEMAS = {
  get_company_snapshot: z.object({ ticker }).strict(),
  get_financials: z
    .object({
      ticker,
      period: z.enum(['annual', 'quarterly']).default('annual'),
      years: z.number().int().min(1).max(30).default(5),
    })
    .strict(),
  compare_companies: z
    .object({
      tickers: z.array(ticker).min(2).max(6),
      metrics: z.array(metric).min(1).max(8).default(['revenue_growth', 'gross_margin', 'operating_margin']),
      years: z.number().int().min(1).max(10).default(5),
    })
    .strict(),
  run_screen: z
    .object({
      sector: z.string().max(40).optional(),
      minMarketCapB: z.number().min(0).optional(),
      maxPe: z.number().min(0).max(500).optional(),
      minRevenueGrowth: z.number().min(-100).max(500).optional(),
      minEpsRevision: z.number().min(-100).max(100).optional(),
      maxShortInterest: z.number().min(0).max(100).optional(),
      insiderBuying: z.boolean().optional(),
      sortBy: z.enum(['marketCap', 'revenueGrowth', 'pe', 'epsRevision30d', 'insiderBuying90d']).default('marketCap'),
      limit: z.number().int().min(1).max(25).default(10),
    })
    .strict(),
  get_news: z
    .object({
      ticker: ticker.optional(),
      limit: z.number().int().min(1).max(20).default(6),
      sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
    })
    .strict(),
  search_documents: z
    .object({
      query: z.string().trim().min(2).max(300),
      tickers: z.array(ticker).max(8).optional(),
      kinds: z.array(z.enum(['filing', 'transcript', 'news', 'note'])).max(4).optional(),
      limit: z.number().int().min(1).max(12).default(6),
    })
    .strict(),
  portfolio_risk: z.object({ portfolioId: z.string().max(64).optional() }).strict(),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export type ToolInput<N extends ToolName> = z.output<(typeof TOOL_SCHEMAS)[N]>;
export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[];

export function isToolName(n: string): n is ToolName {
  return n in TOOL_SCHEMAS;
}

export type ValidationResult<N extends ToolName> = { ok: true; input: ToolInput<N> } | { ok: false; error: string };

/** Validate untrusted model-supplied tool input. */
export function validateToolInput<N extends ToolName>(name: N, input: unknown): ValidationResult<N> {
  const r = TOOL_SCHEMAS[name].safeParse(input ?? {});
  if (r.success) return { ok: true, input: r.data as ToolInput<N> };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') };
}

const DESCRIPTIONS: Record<ToolName, string> = {
  get_company_snapshot:
    'Company profile, live/delayed quote, valuation multiples and consensus estimates for one ticker. Use first when a question is about a single company.',
  get_financials:
    'Annual or quarterly income statement / cash-flow history (revenue, growth, gross/operating/net margin, FCF) for one ticker, newest last.',
  compare_companies:
    'Side-by-side comparison of 2-6 tickers on chosen metrics over N fiscal years. Returns a structured comparison table and chart that are shown to the user automatically, plus per-year series.',
  run_screen:
    'Filter the coverage universe (sector, market cap in $B, max P/E, min revenue growth %, EPS revisions, short interest, insider buying) and return the top matches.',
  get_news: 'Recent news headlines (with publisher, date, sentiment) for a ticker, or market-wide when ticker is omitted.',
  search_documents:
    'Search filings (10-K/10-Q/8-K excerpts), earnings-call transcripts and news for passages relevant to a query. Use for qualitative claims (risks, guidance, AI exposure, management commentary). Returns passages with sources.',
  portfolio_risk: "Risk summary (concentration, sector weights, beta, volatility where available) for one of the user's portfolios.",
};

/** JSON-schema tool specs for providers (generated from the zod schemas). */
export function toolSpecs(): ToolSpec[] {
  return TOOL_NAMES.map((name) => {
    const js = z.toJSONSchema(TOOL_SCHEMAS[name], { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    delete js.$schema;
    return { name, description: DESCRIPTIONS[name], inputSchema: js };
  });
}
