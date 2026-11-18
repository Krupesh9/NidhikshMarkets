import { describe, expect, it } from 'vitest';
import { crossovers, ema, macd, rsi, sma } from '../indicators';

const range = (n: number, start = 1) => Array.from({ length: n }, (_, i) => start + i);

describe('sma', () => {
  it('computes trailing means aligned to input', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it('returns all null when not enough values', () => {
    expect(sma([1, 2], 3)).toEqual([null, null]);
  });
  it('restarts the window after a gap', () => {
    expect(sma([1, 2, null, 3, 4], 2)).toEqual([null, 1.5, null, null, 3.5]);
  });
});

describe('ema', () => {
  it('seeds with SMA then applies k = 2/(n+1)', () => {
    // k = 0.5; seed = mean(1,2,3) = 2; then 4*.5+2*.5 = 3; 5*.5+3*.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it('known value: 10-period EMA', () => {
    const v = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29, 22.15, 22.39];
    const e = ema(v, 10);
    expect(e[8]).toBeNull();
    expect(e[9]).toBeCloseTo(22.221, 3);
    expect(e[10]).toBeCloseTo(22.2081, 3);
    expect(e[11]).toBeCloseTo(22.2412, 3);
  });
  it('skips leading nulls', () => {
    expect(ema([null, null, 2, 4], 2)).toEqual([null, null, null, 3]);
  });
});

describe('rsi', () => {
  it('Wilder smoothing on a hand-computed series', () => {
    // changes +1,-1,+1,+1 with n=2: 50, 75, 87.5
    expect(rsi([1, 2, 1, 2, 3], 2)).toEqual([null, null, 50, 75, 87.5]);
  });
  it('is 100 for monotonic gains and 0 for monotonic losses', () => {
    expect(rsi(range(20), 14)[19]).toBe(100);
    expect(rsi(range(20).reverse(), 14)[19]).toBe(0);
    expect(rsi(range(20), 14)[13]).toBeNull();
    expect(rsi(range(20), 14)[14]).toBe(100);
  });
  it('is bounded 0..100', () => {
    const v = range(200).map((i) => 100 + 10 * Math.sin(i / 5));
    for (const x of rsi(v, 14)) if (x != null) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100); }
  });
});

describe('macd', () => {
  it('is zero for a flat series and respects warm-up', () => {
    const { macd: m, signal, hist } = macd(new Array(50).fill(10));
    expect(m[24]).toBeNull();
    expect(m[25]).toBe(0);
    expect(signal[32]).toBeNull();
    expect(signal[33]).toBe(0);
    expect(hist[33]).toBe(0);
  });
  it('equals EMA12 − EMA26 and hist = macd − signal', () => {
    const v = range(80).map((i) => 50 + i * 0.7 + 3 * Math.sin(i / 3));
    const { macd: m, signal, hist } = macd(v, 12, 26, 9);
    const e12 = ema(v, 12);
    const e26 = ema(v, 26);
    expect(m[60]).toBeCloseTo((e12[60] as number) - (e26[60] as number), 10);
    expect(hist[60]).toBeCloseTo((m[60] as number) - (signal[60] as number), 10);
    expect(m[60]).toBeGreaterThan(0); // uptrend
  });
});

describe('crossovers', () => {
  it('detects up and down crosses', () => {
    const a = [1, 2, 3, 2, 1];
    const b = [2, 2, 2, 2, 2];
    expect(crossovers(a, b)).toEqual([{ index: 2, dir: 'up' }, { index: 4, dir: 'down' }]);
  });
  it('ignores touches that do not change side and null warm-up', () => {
    expect(crossovers([null, 1, 2, 1], [null, 2, 2, 2])).toEqual([]);
    expect(crossovers([3, 2, 3], [2, 2, 2])).toEqual([]);
  });
});
