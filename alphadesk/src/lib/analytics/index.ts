/**
 * Portfolio analytics — pure, deterministic, client- and server-safe.
 *   import { analyzePortfolio, valuePortfolio, monteCarloVaR, runStressTests, brinsonAttribution, suggestRebalance } from '@/lib/analytics';
 * Server-side loaders that fetch market data live in '@/lib/analytics/server' (getPortfolioAnalytics, getBasketRebalance).
 */
export * from './prng';
export * from './stats';
export * from './exposure';
export * from './risk';
export * from './stress';
export * from './attribution';
export * from './performance';
export * from './rebalance';
export * from './benchmarks';
export * from './csv';
export * from './limits';
export * from './portfolio';
