import 'server-only';
import type { MarketDataProvider } from './types';
import { compositeProvider } from './composite';

export * from './types';
export { resolveMockSource } from './mock';
export { getNidhikshSecFundamentals } from './nidhiksh';
export { secCompanyFacts } from './sec';

/**
 * The single entry point for market data on the server.
 *   const md = getMarketData();
 *   const { data, meta } = await md.getQuote('AAPL');   // meta.isMock / meta.provider / meta.source
 * Chain per method: Alpaca -> Massive (Polygon) -> Nidhiksh local cache -> SEC EDGAR -> Alpha Vantage -> Mock. Never throws for missing data.
 */
export function getMarketData(): MarketDataProvider {
  return compositeProvider;
}
