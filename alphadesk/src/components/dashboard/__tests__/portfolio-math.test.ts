import { describe, expect, it } from 'vitest';
import { summarizePortfolio } from '../portfolio-math';

describe('summarizePortfolio', () => {
  it('computes long/short/gross/net, day and unrealized P&L', () => {
    const s = summarizePortfolio(
      [{ ticker: 'aaa', quantity: 100, costBasis: 10 }, { ticker: 'BBB', quantity: -50, costBasis: 20 }, { ticker: 'CCC', quantity: 10, costBasis: 5 }],
      { AAA: { price: 12, change: 1, changePct: 9.09 }, BBB: { price: 18, change: -2, changePct: -10 } },
    );
    expect(s.long).toBe(1200 + 50); // CCC valued at cost (no quote)
    expect(s.short).toBe(-900);
    expect(s.gross).toBe(2150);
    expect(s.net).toBe(350);
    expect(s.dayPnl).toBe(100 + 100); // long +1*100, short -50*-2
    expect(s.unrealized).toBe(200 + 100); // (12-10)*100 + (18-20)*-50
    expect(s.missingQuotes).toEqual(['CCC']);
    expect(s.rows[0].ticker).toBe('AAA');
    expect(s.rows.reduce((a, r) => a + Math.abs(r.weight), 0)).toBeCloseTo(1);
  });
  it('handles empty portfolios', () => {
    const s = summarizePortfolio([], {});
    expect(s.gross).toBe(0);
    expect(s.dayPnlPct).toBeNull();
  });
});
