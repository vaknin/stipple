/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { COLS_MAX, COLS_MIN } from './layout';
import {
  anyMotion, cleanMotion, COLUMN_CELLS_MAX, columnFrameAt, columnKeyframes, columnPlan, columnRate, columnStart, defaultMotion,
  motionFps, type Motion,
} from './motion';

const with_ = (patch: (m: Motion) => void): Motion => {
  const m = defaultMotion();
  patch(m);
  return m;
};

describe('settings', () => {
  test('still by default', () => {
    expect(motionFps(defaultMotion())).toBe(0);
    expect(anyMotion(defaultMotion())).toBe(false);
  });

  test('an older sidecar keeps only Columns', () => {
    // removed effects (Twinkle, Colour over the day, Shimmer, Pan) and Twinkle's seed are dropped
    const old = cleanMotion({
      twinkle: { on: true, amount: 0.1, rate: 6 }, seed: 7, day: { on: true }, shimmer: { on: true }, pan: { on: true },
      windows: 'keep', columns: { on: true, from: 20 },
    });
    expect(Object.keys(old)).toEqual(['columns']);
    expect(old.columns).toEqual({ ...defaultMotion().columns, on: true, from: 20 });
    // an old Dots wallpaper with only Twinkle on is still
    expect(anyMotion(cleanMotion({ twinkle: { on: true } }))).toBe(false);
  });
});

describe('columns', () => {
  test('keyframes: geometric, deduped, in range, with the saved count', () => {
    const k = columnKeyframes(10, 500, 40, 125);
    expect(k[0]).toBe(10);
    expect(k[k.length - 1]).toBe(500);
    expect(k).toContain(125);
    expect(new Set(k).size).toBe(k.length);
    for (let i = 1; i < k.length; i++) expect(k[i]!).toBeGreaterThan(k[i - 1]!);
    // from > to is the same range; a saved count outside it is not added
    expect(columnKeyframes(500, 10, 40, 1000)).toEqual(columnKeyframes(10, 500, 40, 1000));
    expect(columnKeyframes(10, 500, 40, 1000)).not.toContain(1000);
    expect(columnKeyframes(1, 99999, 2, 0)).toEqual([COLS_MIN, COLS_MAX]);
    expect(columnKeyframes(10, 12, 40, 11)).toEqual([10, 11, 12]);
  });

  test('the sweep starts on the saved frame and goes there and back', () => {
    const k = columnKeyframes(10, 500, 40, 125), s = columnStart(k, 125);
    expect(k[s]).toBe(125);
    expect(columnStart(k, 5)).toBe(0);
    expect(columnStart(k, 9000)).toBe(k.length - 1);
    const n = k.length, P = 20;
    expect(columnFrameAt(0, n, P, s)).toBe(s);
    expect(columnFrameAt(0, n, P, 0)).toBe(0);
    expect(columnFrameAt(P / 2, n, P, 0)).toBe(n - 1);
    expect(columnFrameAt(P, n, P, 0)).toBe(0);
    expect(columnFrameAt(-P, n, P, 0)).toBe(0);
    // an even pace: every keyframe but the two ends shows for the same time
    const time = new Map<number, number>();
    for (let t = 0; t < P; t += 0.001) { const i = columnFrameAt(t, n, P, s); time.set(i, (time.get(i) ?? 0) + 0.001); }
    expect(time.size).toBe(n);
    const each = P / (2 * (n - 1));
    for (let i = 1; i < n - 1; i++) expect(Math.abs(time.get(i)! - 2 * each)).toBeLessThan(0.01);
    expect(columnFrameAt(3, 1, P, 0)).toBe(0);
  });

  test('frame rate', () => {
    const m = with_(x => { x.columns.on = true; x.columns.frames = 121; x.columns.period = 20; });
    expect(motionFps(m)).toBe(12);
    expect(columnRate(1, 20)).toBe(0);
    expect(cleanMotion({ twinkle: { on: true } }).columns).toEqual(defaultMotion().columns);
  });

  test('a plan makes the frames asked for, capped by the cells', () => {
    const rows = (k: number) => Math.round(k * 0.46);
    for (const frames of [2, 50, 130, 400]) {
      const p = columnPlan({ from: 10, to: 500, frames }, 156, rows);
      expect(p.capped).toBe(false);
      // the saved count may add one
      expect(p.cols.length - frames).toBeGreaterThanOrEqual(0);
      expect(p.cols.length - frames).toBeLessThanOrEqual(1);
      expect(p.cols[0]).toBe(10);
      expect(p.cols[p.cols.length - 1]).toBe(500);
    }
    // a range with fewer whole numbers than asked for: all of them
    expect(columnPlan({ from: 10, to: 12, frames: 50 }, 11, rows).cols).toEqual([10, 11, 12]);
    const big = columnPlan({ from: 10, to: 4096, frames: 600 }, 156, rows);
    expect(big.capped).toBe(true);
    expect(big.cells).toBeLessThanOrEqual(COLUMN_CELLS_MAX);
  });
});
