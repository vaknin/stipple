/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { createConverter, type DotField } from '$typist/convert.js';
import { ditherDots, encodeBraille } from '$typist/dither.js';
import { COLS_MAX, COLS_MIN } from './layout';
import {
  cleanMotion, COLUMN_CELLS_MAX, columnFrameAt, columnKeyframes, columnPlan, columnRate, columnStart, defaultMotion, frameDots, frameGrid, hash, motionFor, motionFps, packField,
  type Motion,
} from './motion';

/** wall.frag's hash in exact uint32 arithmetic. */
function glslHash(x: number, y: number, z: number): number {
  const M = 0xffffffffn;
  let h = (BigInt(x) * 374761393n + BigInt(y) * 668265263n + BigInt(z) * 2246822519n) & M;
  h = ((h ^ (h >> 13n)) * 1274126177n) & M;
  h ^= h >> 16n;
  return Number(h >> 8n) / 16777216;
}

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function field(W: number, H: number, seed: number): DotField {
  const r = rng(seed);
  const L = new Float32Array(W * H);
  for (let i = 0; i < L.length; i++) L[i] = r();
  return { width: W, height: H, L, dots: ditherDots(L, W, H, 'atkinson'), forced: new Uint8Array(W * H) };
}

const with_ = (patch: (m: Motion) => void): Motion => {
  const m = defaultMotion();
  patch(m);
  return m;
};

describe('shader mirror', () => {
  test('hash is the shader hash', () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const x = Math.floor(r() * 5000), y = Math.floor(r() * 5000), z = Math.floor(r() * 4294967295);
      expect(hash(x, y, z)).toBe(glslHash(x, y, z));
    }
  });

  test('without Twinkle the saved dots are drawn as they are', () => {
    const f = field(120, 80, 4);
    const p = packField(f);
    expect(Array.from(frameDots(p, 120, 80, defaultMotion(), 3))).toEqual(Array.from(f.dots));
  });

  test('twinkle flips one dot in about `amount` of the cells, the same at the same time', () => {
    const W = 400, H = 260, f = field(W, H, 5);
    const p = packField(f);
    const m = with_(m => { m.twinkle.on = true; m.twinkle.amount = 0.05; });
    const a = frameDots(p, W, H, m, 1.3);
    const b = frameDots(p, W, H, m, 1.3);
    expect(Array.from(a)).toEqual(Array.from(b));
    let flipped = 0;
    const cells = (W / 2) * (H / 4);
    for (let r = 0; r < H / 4; r++) {
      for (let c = 0; c < W / 2; c++) {
        let n = 0;
        for (let k = 0; k < 8; k++) {
          const i = (r * 4 + (k >> 1)) * W + c * 2 + (k & 1);
          if (a[i] !== f.dots[i]) n++;
        }
        expect(n).toBeLessThanOrEqual(1);
        flipped += n;
      }
    }
    expect(flipped / cells).toBeGreaterThan(0.035);
    expect(flipped / cells).toBeLessThan(0.065);
    // another tick picks other cells
    expect(Array.from(frameDots(p, W, H, m, 1.3 + 1 / m.twinkle.rate))).not.toEqual(Array.from(a));
  });

  test('the night dots ride in G and twinkle as the day’s do', () => {
    const W = 200, H = 120, day = field(W, H, 4), night = field(W, H, 9);
    const p = packField(day, night);
    expect(Array.from(frameDots(p, W, H, defaultMotion(), 3))).toEqual(Array.from(day.dots));
    expect(Array.from(frameDots(p, W, H, defaultMotion(), 3, undefined, 1))).toEqual(Array.from(night.dots));
    expect(Array.from(packField(day)).filter((_, i) => i % 3 === 1).every(v => v === 0)).toBe(true);
    // the same cells flip on both sides
    const m = with_(m => { m.twinkle.on = true; m.twinkle.amount = 0.05; });
    const a = frameDots(p, W, H, m, 1.3), n = frameDots(p, W, H, m, 1.3, undefined, 1);
    for (let i = 0; i < W * H; i++) expect(a[i] !== day.dots[i]).toBe(n[i] !== night.dots[i]);
    expect(() => packField(day, field(W, H + 4, 1))).toThrow();
  });

  test('frameGrid encodes the frame as Braille', () => {
    const f = field(40, 16, 8);
    const g = frameGrid(packField(f), 40, 16, defaultMotion(), 0);
    expect(Array.from(g.cp)).toEqual(Array.from(encodeBraille(f.dots, 40, 16).cp));
    expect([g.cols, g.rows, g.mode]).toEqual([20, 4, 'braille']);
  });

  test('the converter field: the saved dots, drawn as they are', () => {
    const w = 300, h = 300, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p += 4) {
        const v = Math.round(255 * (0.5 + 0.5 * Math.sin(x / 17) * Math.cos(y / 23)));
        data[p] = data[p + 1] = data[p + 2] = v;
        data[p + 3] = 255;
      }
    }
    const conv = createConverter();
    conv.setSource({ width: w, height: h, data });
    const g = conv.run({}, { mode: 'braille', cols: 60, rows: 35, dither: 'atkinson', field: true });
    const f = g.field!;
    expect([f.width, f.height]).toEqual([120, 140]);
    expect(Array.from(encodeBraille(f.dots, f.width, f.height).cp)).toEqual(Array.from(g.cp));
    expect(Array.from(frameDots(packField(f), f.width, f.height, defaultMotion(), 7))).toEqual(Array.from(f.dots));
    expect(conv.run({}, { mode: 'ascii', cols: 20, rows: 10 }).field).toBeNull();
  });
});

describe('settings', () => {
  test('frame rate', () => {
    expect(motionFps(defaultMotion())).toBe(0);
    expect(motionFps(with_(m => { m.twinkle.on = true; m.twinkle.rate = 6; }))).toBe(6);
  });

  test('motionFor keeps only what the style can play', () => {
    const all = with_(m => { m.twinkle.on = m.columns.on = true; });
    const on = (m: Motion) => [m.twinkle.on, m.columns.on];
    expect(on(motionFor(all, { dots: true, letters: false }))).toEqual([true, false]);
    expect(on(motionFor(all, { dots: false, letters: true }))).toEqual([false, true]);
    // an older sidecar's removed effects (Colour over the day, Shimmer, Pan) are dropped
    const old = cleanMotion({ day: { on: true }, shimmer: { on: true }, pan: { on: true }, windows: 'keep' });
    expect(Object.keys(old).sort()).toEqual(['columns', 'seed', 'twinkle']);
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

  test('frame rate and style support', () => {
    const m = with_(x => { x.columns.on = true; x.columns.frames = 121; x.columns.period = 20; });
    expect(motionFps(m)).toBe(12);
    expect(columnRate(1, 20)).toBe(0);
    expect(motionFor(m, { dots: false, letters: true }).columns.on).toBe(true);
    expect(motionFor(m, { dots: true, letters: false }).columns.on).toBe(false);
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
