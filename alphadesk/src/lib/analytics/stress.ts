/**
 * Deterministic stress tests. Each scenario maps a position (sector, beta) to an instantaneous return shock;
 * P&L = market value × shock (shorts gain when shocks are negative). Sensitivities are illustrative house
 * assumptions, documented in SCENARIO_ASSUMPTIONS — not forecasts.
 */

export interface StressPositionInput { ticker: string; sector: string; marketValue: number; beta: number }
export interface StressPositionResult { ticker: string; sector: string; marketValue: number; beta: number; shock: number; pnl: number }
export interface StressScenario {
  id: string;
  name: string;
  description: string;
  /** return shock for one position */
  shock: (p: { sector: string; beta: number }) => number;
  /** table of sector shocks shown in the UI (fraction, e.g. −0.08 = −8%) */
  sectorTable?: Record<string, number>;
}
export interface StressResult {
  id: string;
  name: string;
  description: string;
  pnl: number;
  /** P&L / NAV */
  pnlPct: number;
  positions: StressPositionResult[];
  sectorTable?: Record<string, number>;
  worst: StressPositionResult | null;
  best: StressPositionResult | null;
}

/**
 * Equity price sensitivity per +100bp parallel shift in rates, by GICS sector (equity-duration proxies).
 * Long-duration / bond-proxy sectors fall more; banks/insurers benefit from higher net interest margins.
 */
export const RATE_SENSITIVITY_PER_100BP: Record<string, number> = {
  'Real Estate': -0.065,
  Utilities: -0.055,
  'Information Technology': -0.045,
  'Communication Services': -0.035,
  'Consumer Discretionary': -0.035,
  'Health Care': -0.02,
  'Consumer Staples': -0.025,
  Industrials: -0.02,
  Materials: -0.015,
  Energy: 0.005,
  Financials: 0.015,
};

export const TECH_SELLOFF: Record<string, number> = {
  'Information Technology': -0.18,
  'Communication Services': -0.12,
  'Consumer Discretionary': -0.09,
  Industrials: -0.05,
  Financials: -0.04,
  Materials: -0.04,
  'Real Estate': -0.03,
  'Health Care': -0.02,
  Energy: -0.02,
  'Consumer Staples': 0.01,
  Utilities: 0.01,
};

/** Oil +40% supply shock. */
export const OIL_SPIKE: Record<string, number> = {
  Energy: 0.15,
  Materials: 0.02,
  Utilities: -0.01,
  Financials: -0.01,
  'Health Care': -0.01,
  'Information Technology': -0.02,
  'Communication Services': -0.02,
  'Consumer Staples': -0.02,
  'Real Estate': -0.02,
  Industrials: -0.04,
  'Consumer Discretionary': -0.05,
};

const fromTable = (t: Record<string, number>, fallback: (beta: number) => number) => (p: { sector: string; beta: number }) =>
  p.sector in t ? t[p.sector] : fallback(p.beta);

export const DEFAULT_SCENARIOS: StressScenario[] = [
  {
    id: 'rates_200bp', name: 'Rates +200bp', description: 'Instantaneous +200bp parallel shift in the Treasury curve; sector equity-duration sensitivities × 2.',
    shock: fromTable(Object.fromEntries(Object.entries(RATE_SENSITIVITY_PER_100BP).map(([k, v]) => [k, v * 2])), () => -0.04),
    sectorTable: Object.fromEntries(Object.entries(RATE_SENSITIVITY_PER_100BP).map(([k, v]) => [k, v * 2])),
  },
  {
    id: 'equity_down_20', name: 'Equity −20%', description: 'Broad market drawdown of 20%; each position moves beta × −20%.',
    shock: (p) => -0.2 * p.beta,
  },
  {
    id: 'tech_selloff', name: 'Tech selloff', description: 'Growth/tech de-rating: IT −18%, Comm. Services −12%, Discretionary −9%; defensives flat to up.',
    shock: fromTable(TECH_SELLOFF, (b) => -0.04 * b), sectorTable: TECH_SELLOFF,
  },
  {
    id: 'oil_spike', name: 'Oil spike (+40%)', description: 'Crude +40% supply shock: Energy +15%; transport, consumer and industrials hit by input costs.',
    shock: fromTable(OIL_SPIKE, () => -0.02), sectorTable: OIL_SPIKE,
  },
];

export function runStressTest(positions: StressPositionInput[], scenario: StressScenario, nav: number): StressResult {
  const rows = positions.map((p) => {
    const beta = isFinite(p.beta) ? p.beta : 1;
    const shock = scenario.shock({ sector: p.sector, beta });
    return { ticker: p.ticker, sector: p.sector, marketValue: p.marketValue, beta, shock, pnl: p.marketValue * shock };
  }).sort((a, b) => a.pnl - b.pnl);
  const pnl = rows.reduce((a, r) => a + r.pnl, 0);
  return {
    id: scenario.id, name: scenario.name, description: scenario.description, pnl, pnlPct: nav ? pnl / nav : 0, positions: rows,
    sectorTable: scenario.sectorTable, worst: rows[0] ?? null, best: rows[rows.length - 1] ?? null,
  };
}

export function runStressTests(positions: StressPositionInput[], nav: number, scenarios: StressScenario[] = DEFAULT_SCENARIOS): StressResult[] {
  return scenarios.map((s) => runStressTest(positions, s, nav));
}
