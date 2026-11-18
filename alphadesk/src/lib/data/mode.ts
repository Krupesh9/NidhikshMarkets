import 'server-only';
import fs from 'node:fs';
import { massiveEnabled } from './massive';
import { alpacaEnabled } from './alpaca';
import { alphaVantageEnabled } from './alphavantage';
import { secEnabled } from './sec';
import { mockAllowed } from './mock-policy';

/** Which providers are active — drives the topbar data indicator. */
export function getDataMode(): { label: string; isMock: boolean; providers: string[] } {
  if (process.env.ALPHADESK_FORCE_MOCK === '1') return { label: 'Mock data', isMock: true, providers: ['Mock'] };
  const providers: string[] = [];
  if (alpacaEnabled()) providers.push('Alpaca');
  if (massiveEnabled()) providers.push('Massive (Polygon)');
  const nid = process.env.NIDHIKSH_DB_PATH || '/Users/krupeshpatel/Documents/ChatGPT/Nidhiksh Markets/runtime/market.sqlite';
  if (fs.existsSync(nid)) providers.push('Nidhiksh local cache');
  if (secEnabled()) providers.push('SEC EDGAR');
  if (alphaVantageEnabled()) providers.push('Alpha Vantage');
  if (!mockAllowed()) {
    // Production: no simulated fallback. Sections without a real source show empty states.
    return { label: alpacaEnabled() || massiveEnabled() ? 'Live data' : providers.length ? 'Local data' : 'No data source', isMock: false, providers };
  }
  providers.push('Mock');
  if (providers.length === 1) return { label: 'Mock data', isMock: true, providers };
  if (alpacaEnabled() || massiveEnabled()) return { label: 'Live data', isMock: false, providers };
  return { label: 'Mixed: local + mock', isMock: true, providers };
}
